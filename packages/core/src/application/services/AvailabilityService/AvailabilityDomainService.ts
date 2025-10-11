import { AvailabilityRequestExtractorService, AvailabilitySQLBuilder } from "@clinickeys-agents/core/application/services";
import { ITratamientoRepository, TratamientoSearchResultDTO } from "@clinickeys-agents/core/domain/tratamiento";
import { AvailabilityCalculator, AvailabilityAdjuster } from "@clinickeys-agents/core/domain/availability";
import { ejecutarConReintento } from "@clinickeys-agents/core/infrastructure/helpers";
import { IEspacioRepository, EspacioBasicDTO } from "@clinickeys-agents/core/domain/espacio";
import { IMedicoRepository } from "@clinickeys-agents/core/domain/medico";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import { AvailabilityEventCatalog } from "@clinickeys-agents/core/domain/availability/events";
import { AvailabilityEventLogger } from "@clinickeys-agents/core/infrastructure/logging/AvailabilityEventLogger";
import type {
  TratamientoEntrada,
  MedicoEntrada,
  EspacioEntrada,
  SlotDisponibilidad,
} from "@clinickeys-agents/core/domain/availability";

interface GetAvailabilityInfoInput {
  leadId?: number;
  subdomain: string;
  id_clinica: number;
  tiempo_actual: string;
  id_super_clinica: number;
  parametrosSolicitudCita: string;
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

    if (!treatmentsFound.length) {
      const event = AvailabilityEventCatalog.TRATAMIENTOS_NO_ENCONTRADOS(tratamientosConsultados);
      AvailabilityEventLogger.log(event);
      return [];
    }

    const tratamientosExactos = treatmentsFound.filter((t) => t.is_exact === 1);
    if (!tratamientosExactos.length) {
      const event = AvailabilityEventCatalog.TRATAMIENTOS_NO_EXACTOS(tratamientosConsultados);
      AvailabilityEventLogger.log(event);
      return [];
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
              const espacios = await this.spaceRepo.getEspaciosByMedicoAndTratamiento(
                medico.id_medico,
                tratamiento.id_tratamiento,
                clinicId
              );

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
        } catch (error: any) {
          const event = AvailabilityEventCatalog.ERROR_CONSULTA_SQL(error.message);
          AvailabilityEventLogger.log(event);
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

      Logger.info("[AvailabilityDomainService] Inicio de cálculo de disponibilidad", {
        clinicId,
        tratamientosConsultados,
        medicosConsultados,
        espaciosConsultados,
      });

      if (!clinicId) {
        const event = AvailabilityEventCatalog.FALTA_ID_CLINICA();
        AvailabilityEventLogger.log(event);
        return { success: false, message: event.message, analisis_agenda: [] };
      }

      if (!Array.isArray(tratamientosConsultados) || !tratamientosConsultados.length) {
        const event = AvailabilityEventCatalog.NINGUN_TRATAMIENTO_SELECCIONADO();
        AvailabilityEventLogger.log(event);
        return { success: false, message: event.message, analisis_agenda: [] };
      }

      if (!Array.isArray(fechasSeleccionadas) || !fechasSeleccionadas.length) {
        const event = AvailabilityEventCatalog.NINGUNA_FECHA_SELECCIONADA();
        AvailabilityEventLogger.log(event);
        return { success: false, message: event.message, analisis_agenda: [] };
      }

      const datosTratamientos = await this.fetchTreatmentsWithDoctorsAndSpaces({
        clinicId,
        tratamientosConsultados,
      });

      if (!datosTratamientos.length) {
        const event = AvailabilityEventCatalog.TRATAMIENTOS_NO_ENCONTRADOS(tratamientosConsultados);
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      let idsMedicosSolicitados: number[] = [];
      let tratamientosFiltrados = datosTratamientos;

      if (medicosConsultados.length > 0) {
        const rows = await this.doctorRepo.getIdsMedicosPorNombre(medicosConsultados, clinicId);
        idsMedicosSolicitados = rows.map((f) => f.id_medico);

        if (!idsMedicosSolicitados.length) {
          const event = AvailabilityEventCatalog.MEDICOS_SOLICITADOS_NO_ENCONTRADOS(medicosConsultados);
          AvailabilityEventLogger.log(event);
          return { success: true, message: event.message, analisis_agenda: [] };
        }

        const setIds = new Set(idsMedicosSolicitados);
        tratamientosFiltrados = datosTratamientos
          .map((t) => ({
            ...t,
            medicos: t.medicos.filter((m) => setIds.has(m.id_medico)),
          }))
          .filter((t) => t.medicos.length > 0);

        if (!tratamientosFiltrados.length) {
          const event = AvailabilityEventCatalog.MEDICO_NO_ASOCIADO_A_TRATAMIENTO(
            medicosConsultados,
            tratamientosConsultados
          );
          AvailabilityEventLogger.log(event);
          return { success: true, message: event.message, analisis_agenda: [] };
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
                  setNombresEspacios.has(String(e.nombre_espacio).trim().toLowerCase())
                ),
              }))
              .filter((m) => m.espacios && m.espacios.length > 0),
          }))
          .filter((t) => t.medicos && t.medicos.length > 0);
      }

      const idsMedicos = idsMedicosSolicitados.length
        ? idsMedicosSolicitados
        : [...new Set(tratamientosFiltrados.flatMap((t) => t.medicos.map((m) => m.id_medico)))];

      const idsEspacios = [
        ...new Set(
          tratamientosFiltrados.flatMap((t) =>
            t.medicos.flatMap((m) => m.espacios.map((e) => e.id_espacio))
          )
        ),
      ];

      if (!idsMedicos.length) {
        const event = AvailabilityEventCatalog.NINGUN_MEDICO_ENCONTRADO(tratamientosConsultados);
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      if (!idsEspacios.length) {
        const event = AvailabilityEventCatalog.NINGUN_ESPACIO_ENCONTRADO(
          tratamientosConsultados,
          idsMedicos.map(String)
        );
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      const consultasSQL = AvailabilitySQLBuilder({
        fechas: fechasSeleccionadas,
        id_medicos: idsMedicos,
        id_espacios: idsEspacios,
        id_clinica: clinicId,
      });

      let citas: any[] = [];
      let progMedicos: any[] = [];
      let progEspacios: any[] = [];
      let progMedicoEspacio: any[] = [];

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
      } catch (error: any) {
        const event = AvailabilityEventCatalog.ERROR_CONSULTA_SQL(error.message);
        AvailabilityEventLogger.log(event);
        return { success: false, message: event.message, analisis_agenda: [] };
      }

      const noProgMedicos = !progMedicos?.length;
      const noProgEspacios = !progEspacios?.length;
      const noProgMedicoEspacio = !progMedicoEspacio?.length;

      if (noProgMedicos && noProgMedicoEspacio) {
        const event = AvailabilityEventCatalog.NO_PROG_MEDICOS(
          idsMedicos.map(String),
          fechasSeleccionadas.map((f) => f.fecha)
        );
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      if (noProgEspacios && noProgMedicoEspacio) {
        const event = AvailabilityEventCatalog.NO_PROG_ESPACIOS(
          idsEspacios.map(String),
          fechasSeleccionadas.map((f) => f.fecha)
        );
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      let availability = AvailabilityCalculator({
        tratamientos: tratamientosFiltrados,
        citas_programadas: citas,
        prog_medicos: progMedicos,
        prog_espacios: progEspacios,
        prog_medico_espacio: progMedicoEspacio,
      });

      const adjustedAvailability = AvailabilityAdjuster(availability, tiempo_actual);

      if (!adjustedAvailability.length) {
        const event = AvailabilityEventCatalog.SIN_HORARIOS_DISPONIBLES(
          tratamientosConsultados,
          fechasSeleccionadas
        );
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      return {
        success: true,
        message: null,
        analisis_agenda: adjustedAvailability,
      };
    } catch (error: any) {
      const event = AvailabilityEventCatalog.ERROR_DESCONOCIDO(error);
      AvailabilityEventLogger.log(event);
      return { success: false, message: event.message, analisis_agenda: [] };
    }
  }
}