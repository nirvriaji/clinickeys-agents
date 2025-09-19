// packages/core/src/application/services/AvailabilityService.ts

import {
  presentAndFilterAvailability,
  generarConsultasSQL,
  calcularDisponibilidad,
  ajustarDisponibilidad,
  AppError,
} from "@clinickeys-agents/core/infrastructure/availability";
import { ejecutarConReintento } from "@clinickeys-agents/core/infrastructure/helpers";
import { ITratamientoRepository } from "@clinickeys-agents/core/domain/tratamiento";
import { IEspacioRepository } from "@clinickeys-agents/core/domain/espacio";
import { IMedicoRepository } from "@clinickeys-agents/core/domain/medico";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import {
  TratamientoEntrada,
  MedicoEntrada,
  EspacioEntrada,
  SlotDisponibilidad,
} from "@clinickeys-agents/core/domain/availability";
import { EspacioBasicDTO } from "@clinickeys-agents/core/domain/espacio";
import { AvailabilityFilterExtractor } from "@clinickeys-agents/core/infrastructure/availability";
import { TratamientoSearchResultDTO } from "@clinickeys-agents/core/domain/tratamiento";

interface GetAvailabilityInfoInput {
  leadId?: number;
  subdomain: string;
  id_clinica: number;
  tiempo_actual: string;
  id_super_clinica: number;
  mensajeBotParlante: string;
  localTimeForPrompts: string;
  contextoDisponibilidades: string;
}

export interface GetTreatmentsDataInput {
  clinicId: number;
  tratamientosConsultados: string[];
}

export interface AppointmentAvailabilityInput {
  tratamientos: string[];
  medicos?: string[];
  espacios?: string[];
  fechas: { fecha: string }[];
  id_clinica: number;
  tiempo_actual: string;
}

export interface AppointmentAvailabilityResult {
  success: boolean;
  message: string | null;
  analisis_agenda: SlotDisponibilidad[];
}

export class AvailabilityService {
  private treatmentRepo: ITratamientoRepository;
  private doctorRepo: IMedicoRepository;
  private spaceRepo: IEspacioRepository;
  private readonly filterExtractor: AvailabilityFilterExtractor;

  constructor(
    treatmentRepo: ITratamientoRepository,
    doctorRepo: IMedicoRepository,
    spaceRepo: IEspacioRepository,
    filterExtractor: AvailabilityFilterExtractor
  ) {
    this.treatmentRepo = treatmentRepo;
    this.doctorRepo = doctorRepo;
    this.spaceRepo = spaceRepo;
    this.filterExtractor = filterExtractor;
  }

  async fetchTreatmentsWithDoctorsAndSpaces({
    clinicId,
    tratamientosConsultados,
  }: GetTreatmentsDataInput): Promise<TratamientoEntrada[]> {
    Logger.info("[AvailabilityService] Starting tratamiento search...");
    const treatmentsFound: TratamientoSearchResultDTO[] =
      await this.treatmentRepo.findTreatmentsByNamesWithRelevance(
        tratamientosConsultados,
        clinicId
      );

    if (!treatmentsFound.length) {
      Logger.warn("No treatments found in the database.");
      throw AppError.TRATAMIENTOS_NO_ENCONTRADOS(tratamientosConsultados);
    }

    const tratamientosExactos = treatmentsFound.filter(
      (t) => t.is_exact === 1
    );
    if (!tratamientosExactos.length) {
      Logger.warn("None of the treatments is an exact match.");
      throw AppError.TRATAMIENTOS_NO_EXACTOS(tratamientosConsultados);
    }

    const result: TratamientoEntrada[] = await Promise.all(
      tratamientosExactos.map(async (tratamiento) => {
        let medicos: MedicoEntrada[] = [];
        try {
          const medicosRaw = await this.doctorRepo.getMedicosByTratamiento(
            tratamiento.id_tratamiento,
            clinicId
          );
          medicos = await Promise.all(
            medicosRaw.map(async (medico) => {
              let espacios: EspacioBasicDTO[] = [];
              try {
                espacios = await this.spaceRepo.getEspaciosByMedicoAndTratamiento(
                  medico.id_medico,
                  tratamiento.id_tratamiento,
                  clinicId
                );
              } catch (error) {
                Logger.error(
                  `Error getting espacios for medico ${medico.nombre_completo}:`,
                  error
                );
                throw AppError.ERROR_CONSULTA_SQL(
                  error instanceof Error ? error : new Error(String(error))
                );
              }

              const espaciosMapped: EspacioEntrada[] = espacios.map((e) => ({
                id_espacio: e.id_espacio,
                nombre_espacio: e.nombre,
              }));

              return {
                id_medico: medico.id_medico,
                nombre_medico: medico.nombre_completo,
                espacios: espaciosMapped,
              };
            })
          );
        } catch (error) {
          Logger.error(
            `Error getting medicos for ${tratamiento.nombre_tratamiento}:`,
            error
          );
          throw AppError.ERROR_CONSULTA_SQL(
            error instanceof Error ? error : new Error(String(error))
          );
        }

        return {
          tratamiento: {
            id_tratamiento: tratamiento.id_tratamiento,
            nombre_tratamiento: tratamiento.nombre_tratamiento,
            duracion_tratamiento: tratamiento.duracion,
          },
          medicos,
        };
      })
    );

    return result;
  }

  async getAppointmentAvailability(
    input: AppointmentAvailabilityInput
  ): Promise<AppointmentAvailabilityResult> {
    try {
      const {
        tratamientos: tratamientosConsultados,
        medicos: medicosConsultados = [],
        espacios: espaciosConsultados = [],
        fechas: fechasSeleccionadas,
        id_clinica: clinicId,
        tiempo_actual,
      } = input;

      if (!clinicId) throw AppError.FALTA_ID_CLINICA();
      if (!Array.isArray(tratamientosConsultados) || !tratamientosConsultados.length)
        throw AppError.NINGUN_TRATAMIENTO_SELECCIONADO();
      if (!Array.isArray(fechasSeleccionadas) || !fechasSeleccionadas.length)
        throw AppError.NINGUNA_FECHA_SELECCIONADA();
      Logger.info("[AvailabilityService] Input data processed correctly.");

      let datosTratamientos = await this.fetchTreatmentsWithDoctorsAndSpaces({
        clinicId,
        tratamientosConsultados,
      });
      Logger.debug("Treatments obtained:", JSON.stringify(datosTratamientos));

      let idsMedicosSolicitados: number[] = [];
      let tratamientosFiltrados = datosTratamientos;

      if (medicosConsultados.length > 0) {
        const rows = await this.doctorRepo.getIdsMedicosPorNombre(
          medicosConsultados,
          clinicId
        );
        idsMedicosSolicitados = rows.map((f) => f.id_medico);
        if (!idsMedicosSolicitados.length)
          throw AppError.MEDICOS_SOLICITADOS_NO_ENCONTRADOS(medicosConsultados);

        const setIds = new Set(idsMedicosSolicitados);
        tratamientosFiltrados = datosTratamientos
          .map((t) => ({
            ...t,
            medicos: t.medicos.filter((m) => setIds.has(m.id_medico)),
          }))
          .filter((t) => t.medicos.length > 0);

        if (!tratamientosFiltrados.length) {
          throw AppError.MEDICO_NO_ASOCIADO_A_TRATAMIENTO(
            medicosConsultados,
            tratamientosConsultados
          );
        }
      }

      if (espaciosConsultados.length > 0) {
        const setNombresEspacios = new Set(
          espaciosConsultados.map((n) => String(n).trim().toLowerCase())
        );
        tratamientosFiltrados = tratamientosFiltrados
          .map((t) => ({
            ...t,
            medicos: t.medicos
              .map((m) => ({
                ...m,
                espacios: (m.espacios || []).filter((e) =>
                  setNombresEspacios.has(
                    String(e.nombre_espacio).trim().toLowerCase()
                  )
                ),
              }))
              .filter((m) => m.espacios && m.espacios.length > 0),
          }))
          .filter((t) => t.medicos && t.medicos.length > 0);
      }

      const idsMedicos = idsMedicosSolicitados.length
        ? idsMedicosSolicitados
        : [
            ...new Set(
              tratamientosFiltrados.flatMap((t) =>
                t.medicos.map((m) => m.id_medico)
              )
            ),
          ];

      const idsEspacios = [
        ...new Set(
          tratamientosFiltrados.flatMap((t) =>
            t.medicos.flatMap((m) => m.espacios.map((e) => e.id_espacio))
          )
        ),
      ];

      if (!idsMedicos.length) {
        const treatmentNamesOut = datosTratamientos.map(
          (t) => t.tratamiento.nombre_tratamiento
        );
        if (medicosConsultados.length)
          throw AppError.MEDICO_NO_ASOCIADO_A_TRATAMIENTO(
            medicosConsultados,
            tratamientosConsultados
          );
        else throw AppError.NINGUN_MEDICO_ENCONTRADO(treatmentNamesOut);
      }

      if (!idsEspacios.length) {
        throw AppError.NINGUN_ESPACIO_ENCONTRADO(
          datosTratamientos.map((t) => t.tratamiento.nombre_tratamiento),
          idsMedicos.map(String)
        );
      }

      const consultasSQL = generarConsultasSQL({
        fechas: fechasSeleccionadas,
        id_medicos: idsMedicos,
        id_espacios: idsEspacios,
        id_clinica: clinicId,
      });

      let citas, progMedicos, progEspacios, progMedicoEspacio;
      try {
        citas = await ejecutarConReintento(
          consultasSQL.sql_citas.text,
          consultasSQL.sql_citas.params
        );
        progMedicos = await ejecutarConReintento(
          consultasSQL.sql_prog_medicos.text,
          consultasSQL.sql_prog_medicos.params
        );
        progEspacios = await ejecutarConReintento(
          consultasSQL.sql_prog_espacios.text,
          consultasSQL.sql_prog_espacios.params
        );
        progMedicoEspacio = await ejecutarConReintento(
          consultasSQL.sql_prog_medico_espacio.text,
          consultasSQL.sql_prog_medico_espacio.params
        );
      } catch (error) {
        Logger.error("Error executing SQL queries:", error);
        throw AppError.ERROR_CONSULTA_SQL(
          error instanceof Error ? error : new Error(String(error))
        );
      }

      if (!progMedicos?.length) {
        throw AppError.NO_PROG_MEDICOS(
          idsMedicos.map(String),
          fechasSeleccionadas.map((f) => f.fecha)
        );
      }
      if (!progEspacios?.length) {
        throw AppError.NO_PROG_ESPACIOS(
          idsEspacios.map(String),
          fechasSeleccionadas.map((f) => f.fecha)
        );
      }

      let availability = calcularDisponibilidad({
        tratamientos: tratamientosFiltrados,
        citas_programadas: citas,
        prog_medicos: progMedicos,
        prog_espacios: progEspacios,
        prog_medico_espacio: progMedicoEspacio,
      });

      const adjustedAvailability = ajustarDisponibilidad(
        availability,
        tiempo_actual
      );
      if (!adjustedAvailability.length) {
        throw AppError.SIN_HORARIOS_DISPONIBLES(
          tratamientosConsultados,
          fechasSeleccionadas
        );
      }

      Logger.info(
        "[AvailabilityService] Final adjusted availability:",
        adjustedAvailability
      );
      return {
        success: true,
        message: null,
        analisis_agenda: adjustedAvailability,
      };
    } catch (e) {
      Logger.error("Error in getAppointmentAvailability:", e);
      if (e instanceof AppError) {
        if (e.isLogOnly) {
          return {
            success: true,
            message: e.message,
            analisis_agenda: [],
          };
        }
        return {
          success: false,
          message: e.message,
          analisis_agenda: [],
        };
      }
      Logger.error("Unhandled error:", e);
      const ed = AppError.ERROR_DESCONOCIDO(e);
      return {
        success: false,
        message: ed.message,
        analisis_agenda: [],
      };
    }
  }

  public async getAvailabilityInfo(
    input: GetAvailabilityInfoInput
  ): Promise<{
    success: boolean;
    message: string | null;
    fechas_buscadas: string | null;
    disponibilidades: SlotDisponibilidad[];
    presentacion_disponibilidades: string;
  }> {
    const {
      id_clinica,
      id_super_clinica,
      tiempo_actual,
      localTimeForPrompts,
      mensajeBotParlante,
      contextoDisponibilidades,
    } = input;

    const tratamientos = await this.treatmentRepo.getActiveTreatmentsForClinic(
      id_clinica,
      id_super_clinica
    );
    const nombresTratamientos = tratamientos.map((t) => t.nombre_tratamiento);
    const medicos = await this.doctorRepo.getMedicos(
      id_clinica,
      id_super_clinica
    );
    const nombresMedicos = medicos.map((m) => m.nombre_completo);

    const filters = await this.filterExtractor.extract(mensajeBotParlante, {
      id_clinica,
      id_super_clinica,
      tiempo_actual,
      localTimeForPrompts,
      tratamientosDisponibles: nombresTratamientos,
      medicosDisponibles: nombresMedicos,
    });

    const availabilityRequest: AppointmentAvailabilityInput = {
      tratamientos: filters[0]?.tratamientos ?? [],
      medicos: filters[0]?.medicos ?? [],
      espacios: filters[0]?.espacios ?? [],
      fechas: filters[0]?.fechas ?? [],
      id_clinica,
      tiempo_actual,
    };

    if (!availabilityRequest.tratamientos.length) {
      return {
        success: false,
        message: "No se encontraron tratamientos disponibles en la clínica.",
        fechas_buscadas: null,
        disponibilidades: [],
        presentacion_disponibilidades: "",
      };
    }

    const baseResult = await this.getAppointmentAvailability(availabilityRequest);

    if (!baseResult.success || !baseResult.analisis_agenda) {
      return {
        ...baseResult,
        fechas_buscadas: JSON.stringify(availabilityRequest.fechas),
        presentacion_disponibilidades: "",
        disponibilidades: [],
      };
    }

    if (contextoDisponibilidades && contextoDisponibilidades.trim() !== "") {
      const presenterSlots = baseResult.analisis_agenda.map((s) => ({
        ...s,
      }));

      const result = await presentAndFilterAvailability(
        this.filterExtractor["openAIService"],
        presenterSlots,
        contextoDisponibilidades
      );

      return {
        ...baseResult,
        fechas_buscadas: JSON.stringify(availabilityRequest.fechas),
        presentacion_disponibilidades: result.presentacion,
        disponibilidades: result.disponibilidades as SlotDisponibilidad[],
      };
    }

    return {
      ...baseResult,
      fechas_buscadas: JSON.stringify(availabilityRequest.fechas),
      presentacion_disponibilidades: "",
      disponibilidades: [],
    };
  }
}