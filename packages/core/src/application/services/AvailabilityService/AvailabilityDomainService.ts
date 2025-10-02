// packages/core/src/application/services/AvailabilityService/AvailabilityDomainService.ts

import { AvailabilityRequestExtractorService, AvailabilityResponsePresenterService, AvailabilityResponseRedactorService } from "@clinickeys-agents/core/application/services";
import { ITratamientoRepository, TratamientoSearchResultDTO } from "@clinickeys-agents/core/domain/tratamiento";
import { AvailabilityCalculator, AvailabilityAdjuster } from "@clinickeys-agents/core/domain/availability";
import { ejecutarConReintento } from "@clinickeys-agents/core/infrastructure/helpers";
import { AvailabilitySQLBuilder } from "@clinickeys-agents/core/application/services";
import { IEspacioRepository, EspacioBasicDTO } from "@clinickeys-agents/core/domain/espacio";
import { IMedicoRepository } from "@clinickeys-agents/core/domain/medico";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { AvailabilityError } from "@clinickeys-agents/core/domain/errors";
import {
  TratamientoEntrada,
  MedicoEntrada,
  EspacioEntrada,
  SlotDisponibilidad,
  HorarioEscogido,
} from "@clinickeys-agents/core/domain/availability";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";

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

    const tratamientosExactos = treatmentsFound.filter(
      (t) => t.is_exact === 1
    );
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

      // Corrección: sólo lanzar errores de "no hay programación" cuando
      // no exista programación ni general ni específica.
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

  public async getAvailabilityInfo(
    input: GetAvailabilityInfoInput
  ): Promise<{
    success: boolean;
    message: string | null;
    fechas_buscadas: string | null;
    horarios_escogidos: HorarioEscogido[];
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

    Logger.info("[AvailabilityDomainService] getAvailabilityInfo: inicio", {
      id_clinica,
      id_super_clinica,
      tiempo_actual,
      localTimeForPrompts,
      tieneContextoDisponibilidades: !!(contextoDisponibilidades && contextoDisponibilidades.trim() !== ""),
    });

    try {
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
      const espacios = await this.spaceRepo.findByClinica(id_clinica);
      const nombresEspacios = espacios.map((e) => e.nombre);

      Logger.info("[AvailabilityDomainService] Catálogos para extractor cargados", {
        tratamientos: nombresTratamientos.length,
        medicos: nombresMedicos.length,
        espacios: nombresEspacios.length,
      });

      const filters = await this.availabilityRequestExtractorService.extract(mensajeBotParlante, {
        id_clinica,
        id_super_clinica,
        tiempo_actual,
        localTimeForPrompts,
        tratamientosDisponibles: nombresTratamientos,
        medicosDisponibles: nombresMedicos,
        espaciosDisponibles: nombresEspacios,
      });

      Logger.info("[AvailabilityDomainService] Filtros extraídos por extractor", {
        totalFilters: (filters || []).length,
        primerFilter: filters && filters[0],
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
        Logger.warn("[AvailabilityDomainService] Ningún tratamiento disponible en clínica para filtros extraídos");
        return {
          success: false,
          message: "No se encontraron tratamientos disponibles en la clínica.",
          fechas_buscadas: null,
          horarios_escogidos: [],
          presentacion_disponibilidades: "",
        };
      }

      const baseResult = await this.getAppointmentAvailability(availabilityRequest);

      // Aunque no haya disponibilidad base, pasamos por Presenter/Redactor (tienen fallbacks)
      const slots: SlotDisponibilidad[] = Array.isArray(baseResult.analisis_agenda)
        ? baseResult.analisis_agenda
        : [];

      Logger.info("[AvailabilityDomainService] Enviando slots al presentador para generar horarios_escogidos", {
        slots: slots.length,
      });

      const selectorResult = await AvailabilityResponsePresenterService(
        this.openAIService,
        slots,
        contextoDisponibilidades || ""
      );

      const horariosSeleccionados = Array.isArray(selectorResult.horarios_escogidos)
        ? selectorResult.horarios_escogidos
        : [];

      Logger.info("[AvailabilityDomainService] Presentador retornó horarios_escogidos", {
        count: horariosSeleccionados.length,
      });

      const redactor = await AvailabilityResponseRedactorService(
        this.openAIService,
        horariosSeleccionados,
        contextoDisponibilidades || "",
        { ahoraISO: tiempo_actual }
      );

      Logger.info("[AvailabilityDomainService] Redactor generó mensaje", {
        mensaje_len: (redactor?.mensaje || "").length,
      });

      return {
        success: baseResult.success,
        message: baseResult.message ?? null,
        fechas_buscadas: JSON.stringify(availabilityRequest.fechas),
        horarios_escogidos: horariosSeleccionados,
        presentacion_disponibilidades: redactor?.mensaje || "",
      };
    } catch (e) {
      Logger.error("[AvailabilityDomainService] Error en getAvailabilityInfo", e);
      if (e instanceof AvailabilityError) {
        return {
          success: !e.isLogOnly ? false : true,
          message: e.message,
          fechas_buscadas: null,
          horarios_escogidos: [],
          presentacion_disponibilidades: "",
        };
      }
      const ed = AvailabilityError.ERROR_DESCONOCIDO(e);
      return {
        success: false,
        message: ed.message,
        fechas_buscadas: null,
        horarios_escogidos: [],
        presentacion_disponibilidades: "",
      };
    }
  }
}