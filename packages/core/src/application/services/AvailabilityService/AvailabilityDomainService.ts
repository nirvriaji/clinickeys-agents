// packages/core/src/application/services/AvailabilityService/AvailabilityDomainService.ts

import { AvailabilityRequestExtractorService, AvailabilitySQLBuilder } from "@clinickeys-agents/core/application/services";
import { ITratamientoRepository, TratamientoSearchResultDTO } from "@clinickeys-agents/core/domain/tratamiento";
import { AvailabilityCalculator, AvailabilityAdjuster } from "@clinickeys-agents/core/domain/availability";
import { ejecutarConReintento } from "@clinickeys-agents/core/infrastructure/helpers";
import { IEspacioRepository, EspacioBasicDTO } from "@clinickeys-agents/core/domain/espacio";
import { IMedicoRepository } from "@clinickeys-agents/core/domain/medico";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { AvailabilityError } from "@clinickeys-agents/core/domain/errors";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import {
  pickAnchorsFromExtractorDates,
  orderAnchorsByCloseness,
  planBlocksAroundAnchor,
  expandRangeToFechas,
  type Block,
  type PlannerOptions,
} from "@clinickeys-agents/core/application/services";
import type {
  TratamientoEntrada,
  MedicoEntrada,
  EspacioEntrada,
  SlotDisponibilidad,
  HorarioEscogido,
} from "@clinickeys-agents/core/domain/availability";

// Nuevo pipeline (Compiler + Accumulator + Redactor v3)
import { AvailabilityResponseRedactorService, SlotAccumulator, AgendaConfigCompilerService } from "@clinickeys-agents/core/application/services";
import {  } from "@clinickeys-agents/core/application/services";
import type {
  AgendaPolicyResolved,
  SlotAccumulatorInput,
  SlotAccumulatorOutput,
} from "@clinickeys-agents/core/application/services";

interface GetAvailabilityInfoInput {
  leadId?: number;
  subdomain: string;
  id_clinica: number;
  tiempo_actual: string; // ISO local clinic time
  id_super_clinica: number;
  parametrosSolicitudCita: string; // texto libre o JSON serializado
  localTimeForPrompts: string; // string legible para prompts
  contextoDisponibilidades: string; // configuración textual
}

export interface GetTreatmentsDataInput {
  clinicId: number;
  tratamientosConsultados: string[];
}

export interface AppointmentAvailabilityInput {
  tratamientos: string[];
  medicos?: string[];
  espacios?: string[];
  fechas: { fecha: string }[]; // fechas concretas (YYYY-MM-DD)
  id_clinica: number;
  tiempo_actual: string;
}

export interface AppointmentAvailabilityResult {
  success: boolean;
  message: string | null;
  analisis_agenda: SlotDisponibilidad[];
}

export class AvailabilityDomainService {
  private treatmentRepo: ITratamientoRepository;
  private doctorRepo: IMedicoRepository;
  private spaceRepo: IEspacioRepository;
  private readonly availabilityRequestExtractorService: AvailabilityRequestExtractorService;
  private readonly openAIService: IOpenAIService;

  constructor(
    treatmentRepo: ITratamientoRepository,
    doctorRepo: IMedicoRepository,
    spaceRepo: IEspacioRepository,
    availabilityRequestExtractorService: AvailabilityRequestExtractorService,
    openAIService: IOpenAIService
  ) {
    this.treatmentRepo = treatmentRepo;
    this.doctorRepo = doctorRepo;
    this.spaceRepo = spaceRepo;
    this.availabilityRequestExtractorService = availabilityRequestExtractorService;
    this.openAIService = openAIService;
  }

  async fetchTreatmentsWithDoctorsAndSpaces({
    clinicId,
    tratamientosConsultados,
  }: GetTreatmentsDataInput): Promise<TratamientoEntrada[]> {
    Logger.info("[AvailabilityDomainService] Inicio búsqueda de tratamientos", {
      clinicId,
      tratamientosConsultados,
    });

    const treatmentsFound: TratamientoSearchResultDTO[] =
      await this.treatmentRepo.findTreatmentsByNamesWithRelevance(
        tratamientosConsultados,
        clinicId
      );

    Logger.info("[AvailabilityDomainService] Tratamientos encontrados (con relevancia)", {
      total: treatmentsFound.length,
      exactos: treatmentsFound.filter((t) => t.is_exact === 1).length,
      consultados: tratamientosConsultados,
    });

    if (!treatmentsFound.length) {
      Logger.warn("[AvailabilityDomainService] No se encontraron tratamientos en la base para los nombres consultados");
      throw AvailabilityError.TRATAMIENTOS_NO_ENCONTRADOS(tratamientosConsultados);
    }

    const tratamientosExactos = treatmentsFound.filter((t) => t.is_exact === 1);
    if (!tratamientosExactos.length) {
      Logger.warn("[AvailabilityDomainService] Ningún tratamiento es coincidencia exacta");
      throw AvailabilityError.TRATAMIENTOS_NO_EXACTOS(tratamientosConsultados);
    }

    const result: TratamientoEntrada[] = await Promise.all(
      tratamientosExactos.map(async (tratamiento) => {
        let medicos: MedicoEntrada[] = [];
        try {
          const medicosRaw = await this.doctorRepo.getMedicosByTratamiento(
            tratamiento.id_tratamiento,
            clinicId
          );
          Logger.info("[AvailabilityDomainService] Médicos por tratamiento", {
            tratamiento: tratamiento.nombre_tratamiento,
            medicos: medicosRaw.length,
          });

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
                  `Error obteniendo espacios para el médico ${medico.nombre_completo} (tratamiento: ${tratamiento.nombre_tratamiento})`,
                  error
                );
                throw AvailabilityError.ERROR_CONSULTA_SQL(
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
            `Error obteniendo médicos para el tratamiento ${tratamiento.nombre_tratamiento}`,
            error
          );
          throw AvailabilityError.ERROR_CONSULTA_SQL(
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

    Logger.info("[AvailabilityDomainService] Resultado armado de tratamientos + médicos + espacios", {
      tratamientos: result.length,
      totalMedicos: result.reduce((acc, t) => acc + t.medicos.length, 0),
    });

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

      Logger.info("[AvailabilityDomainService] Inicio de cálculo de disponibilidad", {
        clinicId,
        tratamientosConsultados,
        medicosConsultados,
        espaciosConsultados,
        fechasSeleccionadas: fechasSeleccionadas.map((f) => f.fecha),
        tiempo_actual,
      });

      if (!clinicId) throw AvailabilityError.FALTA_ID_CLINICA();
      if (!Array.isArray(tratamientosConsultados) || !tratamientosConsultados.length)
        throw AvailabilityError.NINGUN_TRATAMIENTO_SELECCIONADO();
      if (!Array.isArray(fechasSeleccionadas) || !fechasSeleccionadas.length)
        throw AvailabilityError.NINGUNA_FECHA_SELECCIONADA();
      Logger.info("[AvailabilityDomainService] Validaciones iniciales OK");

      let datosTratamientos = await this.fetchTreatmentsWithDoctorsAndSpaces({
        clinicId,
        tratamientosConsultados,
      });
      Logger.info("[AvailabilityDomainService] Tratamientos enriquecidos con médicos y espacios", {
        tratamientos: datosTratamientos.length,
      });

      let idsMedicosSolicitados: number[] = [];
      let tratamientosFiltrados = datosTratamientos;

      if (medicosConsultados.length > 0) {
        const rows = await this.doctorRepo.getIdsMedicosPorNombre(
          medicosConsultados,
          clinicId
        );
        idsMedicosSolicitados = rows.map((f) => f.id_medico);
        Logger.info("[AvailabilityDomainService] IDs de médicos solicitados resueltos", {
          medicosConsultados,
          idsMedicosSolicitados,
        });
        if (!idsMedicosSolicitados.length)
          throw AvailabilityError.MEDICOS_SOLICITADOS_NO_ENCONTRADOS(medicosConsultados);

        const setIds = new Set(idsMedicosSolicitados);
        tratamientosFiltrados = datosTratamientos
          .map((t) => ({
            ...t,
            medicos: t.medicos.filter((m) => setIds.has(m.id_medico)),
          }))
          .filter((t) => t.medicos.length > 0);

        if (!tratamientosFiltrados.length) {
          throw AvailabilityError.MEDICO_NO_ASOCIADO_A_TRATAMIENTO(
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
        Logger.info("[AvailabilityDomainService] Filtro por espacios aplicado", {
          espaciosConsultados,
        });
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

      Logger.info("[AvailabilityDomainService] IDs resueltos para cálculo", {
        idsMedicosCount: idsMedicos.length,
        idsEspaciosCount: idsEspacios.length,
      });

      if (!idsMedicos.length) {
        const treatmentNamesOut = datosTratamientos.map(
          (t) => t.tratamiento.nombre_tratamiento
        );
        if (medicosConsultados.length)
          throw AvailabilityError.MEDICO_NO_ASOCIADO_A_TRATAMIENTO(
            medicosConsultados,
            tratamientosConsultados
          );
        else throw AvailabilityError.NINGUN_MEDICO_ENCONTRADO(treatmentNamesOut);
      }

      if (!idsEspacios.length) {
        throw AvailabilityError.NINGUN_ESPACIO_ENCONTRADO(
          datosTratamientos.map((t) => t.tratamiento.nombre_tratamiento),
          idsMedicos.map(String)
        );
      }

      const consultasSQL = AvailabilitySQLBuilder({
        fechas: fechasSeleccionadas,
        id_medicos: idsMedicos,
        id_espacios: idsEspacios,
        id_clinica: clinicId,
      });

      Logger.info("[AvailabilityDomainService] Consultas SQL construidas", {
        fechas: fechasSeleccionadas.map((f) => f.fecha),
        idsMedicos,
        idsEspacios,
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
        Logger.error("[AvailabilityDomainService] Error ejecutando consultas SQL (con reintento)", error);
        throw AvailabilityError.ERROR_CONSULTA_SQL(
          error instanceof Error ? error : new Error(String(error))
        );
      }

      Logger.info("[AvailabilityDomainService] Resultados de base recibidos", {
        citas: (citas || []).length,
        progMedicos: (progMedicos || []).length,
        progEspacios: (progEspacios || []).length,
        progMedicoEspacio: (progMedicoEspacio || []).length,
      });

      // Solo lanzar errores de programación cuando no exista programación ni general ni específica.
      const noProgMedicos = !progMedicos?.length;
      const noProgEspacios = !progEspacios?.length;
      const noProgMedicoEspacio = !progMedicoEspacio?.length;

      if (noProgMedicos && noProgMedicoEspacio) {
        throw AvailabilityError.NO_PROG_MEDICOS(
          idsMedicos.map(String),
          fechasSeleccionadas.map((f) => f.fecha)
        );
      }
      if (noProgEspacios && noProgMedicoEspacio) {
        throw AvailabilityError.NO_PROG_ESPACIOS(
          idsEspacios.map(String),
          fechasSeleccionadas.map((f) => f.fecha)
        );
      }

      let availability = AvailabilityCalculator({
        tratamientos: tratamientosFiltrados,
        citas_programadas: citas,
        prog_medicos: progMedicos,
        prog_espacios: progEspacios,
        prog_medico_espacio: progMedicoEspacio,
      });

      Logger.info("[AvailabilityDomainService] Slots calculados (pre-ajuste)", {
        cantidad: availability.length,
      });

      const adjustedAvailability = AvailabilityAdjuster(
        availability,
        tiempo_actual
      );

      Logger.info("[AvailabilityDomainService] Slots ajustados (post-ajuste)", {
        cantidad: adjustedAvailability.length,
      });

      if (!adjustedAvailability.length) {
        throw AvailabilityError.SIN_HORARIOS_DISPONIBLES(
          tratamientosConsultados,
          fechasSeleccionadas
        );
      }

      Logger.info("[AvailabilityDomainService] Disponibilidad final lista para retornar", {
        total: adjustedAvailability.length,
      });

      return {
        success: true,
        message: null,
        analisis_agenda: adjustedAvailability,
      };
    } catch (e) {
      Logger.error("[AvailabilityDomainService] Error en getAppointmentAvailability", e);
      if (e instanceof AvailabilityError) {
        Logger.warn("[AvailabilityDomainService] Error de negocio controlado", { codigo: e.code, mensaje: e.message });
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
      Logger.error("[AvailabilityDomainService] Error no controlado", e);
      const ed = AvailabilityError.ERROR_DESCONOCIDO(e);
      return {
        success: false,
        message: ed.message,
        analisis_agenda: [],
      };
    }
  }
}