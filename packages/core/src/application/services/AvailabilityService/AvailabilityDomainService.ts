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
      parametrosSolicitudCita,
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

      const filters = await this.availabilityRequestExtractorService.extract(parametrosSolicitudCita, {
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

      // Configuración base alineada con CheckAvailability (rangos/ventanas intactos)
      const blockDays = 5;
      const maxOpciones = 10;
      const plannerBase: Pick<PlannerOptions, "blockDays"> = { blockDays };

      const analisisAgendaAcumulado: SlotDisponibilidad[] = [];
      const allFechasBuscadas: string[] = [];

      for (const filter of filters || []) {
        const tratamientosSel = filter?.tratamientos ?? [];
        const medicosSel = filter?.medicos ?? [];
        const espaciosSel = filter?.espacios ?? [];

        // Expandir date_ranges → fechas {fecha}
        const fechasExtractor: { fecha: string }[] = [];
        const drs = Array.isArray((filter as any).date_ranges) ? (filter as any).date_ranges : [];
        for (const r of drs) {
          const start = r?.start_date;
          const end = r?.end_date;
          if (typeof start === "string" && typeof end === "string") {
            const fechasRango = expandRangeToFechas({ start, end });
            fechasExtractor.push(...fechasRango);
          }
        }

        // Anclas ordenadas por cercanía
        const anchors = orderAnchorsByCloseness(
          pickAnchorsFromExtractorDates(fechasExtractor),
          tiempo_actual.substring(0, 10)
        );

        Logger.info("[AvailabilityDomainService] Anclas calculadas", { anchors });

        type StepTipo =
          | "original"
          | "intermedio_hasta_fecha"
          | "ampliada_mismo_medico"
          | "ampliada_sin_medico_rango_dias_original"
          | "ampliada_sin_medico_rango_dias_extendido";

        const hasMedico = (medicosSel || []).length > 0;

        const steps: {
          tipo: StepTipo;
          filtros: { con_medico: boolean; rango_dias_extra: number; backwardOnly?: boolean };
          medicos: string[];
          planner: PlannerOptions;
        }[] = [];

        // original → 5 días hacia adelante
        steps.push({
          tipo: "original",
          filtros: { con_medico: hasMedico, rango_dias_extra: 5 },
          medicos: medicosSel,
          planner: { ...plannerBase, forwardMaxDays: 5 },
        });

        // intermedio_hasta_fecha → backward only desde cada ancla hasta hoy
        steps.push({
          tipo: "intermedio_hasta_fecha",
          filtros: { con_medico: hasMedico, rango_dias_extra: 0, backwardOnly: true },
          medicos: medicosSel,
          planner: { ...plannerBase, forwardMaxDays: 5 },
        });

        // ampliada_mismo_medico → 45 días
        steps.push({
          tipo: "ampliada_mismo_medico",
          filtros: { con_medico: hasMedico, rango_dias_extra: 45 },
          medicos: medicosSel,
          planner: { ...plannerBase, forwardMaxDays: 45 },
        });

        // sin médico, rango original (5 días)
        steps.push({
          tipo: "ampliada_sin_medico_rango_dias_original",
          filtros: { con_medico: false, rango_dias_extra: 5 },
          medicos: [],
          planner: { ...plannerBase, forwardMaxDays: 5 },
        });

        // sin médico, extendido (45 días)
        steps.push({
          tipo: "ampliada_sin_medico_rango_dias_extendido",
          filtros: { con_medico: false, rango_dias_extra: 45 },
          medicos: [],
          planner: { ...plannerBase, forwardMaxDays: 45 },
        });

        for (const step of steps) {
          for (const anchor of anchors) {
            let blocks = planBlocksAroundAnchor(anchor, tiempo_actual.substring(0, 10), step.planner);
            if (step.filtros.backwardOnly) {
              blocks = blocks.filter((b) => b.direction === "backward");
            }

            for (const block of blocks) {
              const fechasBlock = expandRangeToFechas({ start: block.start, end: block.end });
              allFechasBuscadas.push(...fechasBlock.map((f) => f.fecha));

              const availabilityRequest: AppointmentAvailabilityInput = {
                tratamientos: tratamientosSel,
                medicos: step.medicos,
                espacios: espaciosSel,
                fechas: fechasBlock,
                id_clinica,
                tiempo_actual,
              };

              const baseResult = await this.getAppointmentAvailability(availabilityRequest);
              if (!baseResult.success || !Array.isArray(baseResult.analisis_agenda)) {
                continue;
              }

              const slots: SlotDisponibilidad[] = baseResult.analisis_agenda;
              analisisAgendaAcumulado.push(...slots);
            }
          }
        }
      }

      Logger.info("[AvailabilityDomainService] Ventanas recolectadas (analisis_agenda)", {
        total: analisisAgendaAcumulado.length,
      });

      // Compiler: resolver política desde el texto + nombres/IDs reales
      const policy: AgendaPolicyResolved = await AgendaConfigCompilerService(
        this.openAIService,
        contextoDisponibilidades || "",
        analisisAgendaAcumulado,
        {
          lista_sedes_clinica: [], // no disponible aquí; si lo tienes en config, puedes inyectarlo
          presentacion_override: { mostrar_medicos: "auto" },
        }
      );

      Logger.info("[AvailabilityDomainService] Policy compilada", {
        minutos_globales: policy?.minutos_globales?.length || 0,
        reglas_tratamiento: policy?.reglas_minutos_por_tratamiento_resueltas?.length || 0,
      });

      // Accumulator: generar top10 determinista a partir de la policy
      const accInput: SlotAccumulatorInput = {
        policy,
        filters: filters || [],
        windows: analisisAgendaAcumulado as any,
        contexto: {
          horas_preferencia_usuario: [],
          disclaimer_fechas: undefined,
          ahoraISO: tiempo_actual,
        },
      };
      const accResult: SlotAccumulatorOutput = await SlotAccumulator(accInput);

      const finalHorarios: HorarioEscogido[] = (accResult.opciones_top10 || []) as any;

      Logger.info("[AvailabilityDomainService] Selección final (Accumulator)", {
        finales: finalHorarios.length,
        dias_mostrados: accResult.dias_mostrados?.length || 0,
      });

      // Redactor v3: ahora recibe **policy** (JSON) en lugar de texto
      const redactor = await AvailabilityResponseRedactorService(
        this.openAIService,
        finalHorarios,
        { policy },
        { ahoraISO: tiempo_actual }
      );

      return {
        success: finalHorarios.length > 0,
        message: null,
        fechas_buscadas: JSON.stringify(Array.from(new Set(allFechasBuscadas)).sort()),
        horarios_escogidos: finalHorarios,
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