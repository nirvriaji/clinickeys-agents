// packages/core/src/application/services/AvailabilityService/AvailabilityDomainService.ts

import { AvailabilitySQLBuilder } from "@clinickeys-agents/core/application/services";
import { ITratamientoRepository, TratamientoSearchResultDTO } from "@clinickeys-agents/core/domain/tratamiento";
import { AvailabilityCalculator, AvailabilityAdjuster } from "@clinickeys-agents/core/domain/availability";
import { ejecutarConReintento } from "@clinickeys-agents/core/infrastructure/helpers";
import { IEspacioRepository } from "@clinickeys-agents/core/domain/espacio";
import { IMedicoRepository } from "@clinickeys-agents/core/domain/medico";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { AvailabilityEventCatalog } from "@clinickeys-agents/core/domain/availability/events";
import { AvailabilityEventLogger } from "@clinickeys-agents/core/infrastructure/logging";
import type {
  TratamientoEntrada,
  MedicoEntrada,
  EspacioEntrada,
  SlotDisponibilidad,
} from "@clinickeys-agents/core/domain/availability";

// =============================
// Tipos públicos (ID-first compatible)
// =============================
export interface GetTreatmentsDataInput {
  clinicId: number;
  tratamientosConsultados: string[]; // solo nombres; camino legacy
}

export interface AppointmentAvailabilityInput {
  // Preferidos (ID-first)
  tratamiento_ids?: number[];
  medico_ids?: number[];
  espacio_ids?: number[];

  // Soporte por nombre (fallback si faltan IDs)
  tratamientos?: string[];
  medicos?: string[];
  espacios?: string[];

  fechas: { fecha: string }[]; // YYYY-MM-DD locales (normalizadas por la app)
  id_clinica: number;
  tiempo_actual: string; // ISO local ya normalizado (no convertir)
}

export interface AppointmentAvailabilityResult {
  success: boolean;
  message: string | null;
  analisis_agenda: SlotDisponibilidad[];
}

// =============================
// Implementación del servicio de dominio (ID-first)
// =============================
export class AvailabilityDomainService {
  private treatmentRepo: ITratamientoRepository;
  private doctorRepo: IMedicoRepository;
  private spaceRepo: IEspacioRepository;

  constructor(
    treatmentRepo: ITratamientoRepository,
    doctorRepo: IMedicoRepository,
    spaceRepo: IEspacioRepository,
  ) {
    this.treatmentRepo = treatmentRepo;
    this.doctorRepo = doctorRepo;
    this.spaceRepo = spaceRepo;
  }

  // =============================
  // Carga tratamientos → médicos → espacios (por NOMBRES)
  // =============================
  async fetchTreatmentsWithDoctorsAndSpaces({
    clinicId,
    tratamientosConsultados,
  }: GetTreatmentsDataInput): Promise<TratamientoEntrada[]> {
    Logger.info("[AvailabilityDomainService] Inicio búsqueda de tratamientos (nombres)", {
      clinicId,
      tratamientosConsultados,
    });

    const qNames = (tratamientosConsultados || []).map((s) => String(s).trim()).filter(Boolean);

    const treatmentsFound: TratamientoSearchResultDTO[] =
      await this.treatmentRepo.findTreatmentsByNamesWithRelevance(qNames, clinicId);

    if (!treatmentsFound.length) {
      const event = AvailabilityEventCatalog.TRATAMIENTOS_NO_ENCONTRADOS(qNames);
      AvailabilityEventLogger.log(event);
      return [];
    }

    const tratamientosExactos = treatmentsFound.filter((t) => t.is_exact === 1);
    if (!tratamientosExactos.length) {
      const event = AvailabilityEventCatalog.TRATAMIENTOS_NO_EXACTOS(qNames);
      AvailabilityEventLogger.log(event);
      return [];
    }

    const result: TratamientoEntrada[] = await Promise.all(
      tratamientosExactos.map(async (tratamiento) => {
        let medicos: MedicoEntrada[] = [];
        try {
          const medicosRaw = await this.doctorRepo.getMedicosByTratamiento(
            tratamiento.id_tratamiento,
            clinicId,
          );

          medicos = await Promise.all(
            medicosRaw.map(async (medico) => {
              const espacios = await this.spaceRepo.getEspaciosByMedicoAndTratamiento(
                medico.id_medico,
                tratamiento.id_tratamiento,
                clinicId,
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
            }),
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
      }),
    );

    return result;
  }

  // =============================
  // Carga tratamientos → médicos → espacios (por IDS)
  // =============================
  private async fetchTreatmentsByIdsWithDoctorsAndSpaces(
    clinicId: number,
    tratamientoIds: number[],
  ): Promise<TratamientoEntrada[]> {
    const ids = Array.from(new Set((tratamientoIds || []).filter((n) => Number.isInteger(n)))) as number[];
    if (!ids.length) return [];

    Logger.info("[AvailabilityDomainService] Inicio búsqueda de tratamientos (IDs)", {
      clinicId,
      ids,
    });

    // Preferimos bulk para detalles (duración/nombre). Si no existe, se podría degradar a getTreatmentDetailsById.
    const tratamientos = await this.treatmentRepo.findTreatmentsByIds(ids);

    if (!tratamientos.length) {
      const event = AvailabilityEventCatalog.TRATAMIENTOS_NO_ENCONTRADOS(ids.map(String));
      AvailabilityEventLogger.log(event);
      return [];
    }

    const result: TratamientoEntrada[] = await Promise.all(
      tratamientos.map(async (t) => {
        let medicos: MedicoEntrada[] = [];
        try {
          const medicosRaw = await this.doctorRepo.getMedicosByTratamiento(t.id_tratamiento, clinicId);

          medicos = await Promise.all(
            medicosRaw.map(async (medico) => {
              const espacios = await this.spaceRepo.getEspaciosByMedicoAndTratamiento(
                medico.id_medico,
                t.id_tratamiento,
                clinicId,
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
            }),
          );
        } catch (error: any) {
          const event = AvailabilityEventCatalog.ERROR_CONSULTA_SQL(error.message);
          AvailabilityEventLogger.log(event);
        }

        return {
          tratamiento: {
            id_tratamiento: t.id_tratamiento,
            nombre_tratamiento: t.nombre_tratamiento,
            duracion_tratamiento: t.duracion,
          },
          medicos,
        };
      }),
    );

    return result;
  }

  // =============================
  // Cálculo de disponibilidad para fechas dadas (ID-first)
  // =============================
  async getAppointmentAvailability(
    input: AppointmentAvailabilityInput,
  ): Promise<AppointmentAvailabilityResult> {
    try {
      const {
        tratamiento_ids: tratamientoIdsIn = [],
        tratamientos: tratamientosConsultadosIn = [],
        medico_ids: medicoIdsIn = [],
        medicos: medicosConsultadosIn = [],
        espacio_ids: espacioIdsIn = [],
        espacios: espaciosConsultadosIn = [],
        fechas: fechasSeleccionadas,
        id_clinica: clinicId,
        tiempo_actual,
      } = input;

      const tratamientosConsultados = (tratamientosConsultadosIn || []).filter(Boolean);
      const medicosConsultados = (medicosConsultadosIn || []).filter(Boolean);
      const espaciosConsultados = (espaciosConsultadosIn || []).filter(Boolean);

      Logger.info("[AvailabilityDomainService] Inicio de cálculo de disponibilidad (ID-first)", {
        clinicId,
        tratamientoIds: tratamientoIdsIn,
        tratamientosConsultados,
        medicoIds: medicoIdsIn,
        medicosConsultados,
        espacioIds: espacioIdsIn,
        espaciosConsultados,
        fechas: (fechasSeleccionadas || []).map((f) => f.fecha).slice(0, 6),
      });

      // Validaciones de negocio
      if (!clinicId) {
        const event = AvailabilityEventCatalog.FALTA_ID_CLINICA();
        AvailabilityEventLogger.log(event);
        return { success: false, message: event.message, analisis_agenda: [] };
      }

      if (!Array.isArray(fechasSeleccionadas) || !fechasSeleccionadas.length) {
        const event = AvailabilityEventCatalog.NINGUNA_FECHA_SELECCIONADA();
        AvailabilityEventLogger.log(event);
        return { success: false, message: event.message, analisis_agenda: [] };
      }

      // Normalizar fechas (defensivo)
      const fechasValidas = (fechasSeleccionadas || [])
        .map((f) => ({ fecha: String(f?.fecha || "").slice(0, 10) }))
        .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.fecha));

      if (!fechasValidas.length) {
        const event = AvailabilityEventCatalog.NINGUNA_FECHA_SELECCIONADA();
        AvailabilityEventLogger.log(event);
        return { success: false, message: event.message, analisis_agenda: [] };
      }

      // =============================
      // 1) Catálogo: tratamientos → médicos → espacios (IDs primero)
      // =============================
      let datosTratamientos: TratamientoEntrada[] = [];
      const tratamientoIds = Array.from(new Set((tratamientoIdsIn || []).filter((n) => Number.isInteger(n)))) as number[];

      if (tratamientoIds.length) {
        datosTratamientos = await this.fetchTreatmentsByIdsWithDoctorsAndSpaces(clinicId, tratamientoIds);
      } else if (tratamientosConsultados.length) {
        datosTratamientos = await this.fetchTreatmentsWithDoctorsAndSpaces({
          clinicId,
          tratamientosConsultados,
        });
      }

      if (!datosTratamientos.length) {
        const event = tratamientoIds.length
          ? AvailabilityEventCatalog.TRATAMIENTOS_NO_ENCONTRADOS(tratamientoIds.map(String))
          : AvailabilityEventCatalog.TRATAMIENTOS_NO_ENCONTRADOS(tratamientosConsultados);
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      // =============================
      // 2) Filtros por médico/espacio (IDs tienen prioridad)
      // =============================
      let tratamientosFiltrados = datosTratamientos;

      // Médicos
      let idsMedicosSolicitados: number[] = [];
      if (medicoIdsIn && medicoIdsIn.length) {
        idsMedicosSolicitados = Array.from(new Set(medicoIdsIn.filter((n) => Number.isInteger(n)))) as number[];
      } else if (medicosConsultados.length > 0) {
        const rows = await this.doctorRepo.getIdsMedicosPorNombre(medicosConsultados, clinicId);
        idsMedicosSolicitados = rows.map((f) => f.id_medico);

        if (!idsMedicosSolicitados.length) {
          const event = AvailabilityEventCatalog.MEDICOS_SOLICITADOS_NO_ENCONTRADOS(medicosConsultados);
          AvailabilityEventLogger.log(event);
          return { success: true, message: event.message, analisis_agenda: [] };
        }
      }

      if (idsMedicosSolicitados.length) {
        const setIds = new Set(idsMedicosSolicitados);
        tratamientosFiltrados = tratamientosFiltrados
          .map((t) => ({
            ...t,
            medicos: t.medicos.filter((m) => setIds.has(m.id_medico)),
          }))
          .filter((t) => t.medicos.length > 0);

        if (!tratamientosFiltrados.length) {
          const event = AvailabilityEventCatalog.MEDICO_NO_ASOCIADO_A_TRATAMIENTO(
            idsMedicosSolicitados.map(String),
            (tratamientoIds.length ? tratamientoIds.map(String) : tratamientosConsultados),
          );
          AvailabilityEventLogger.log(event);
          return { success: true, message: event.message, analisis_agenda: [] };
        }
      }

      // Espacios
      let idsEspaciosSolicitados: number[] = [];
      if (espacioIdsIn && espacioIdsIn.length) {
        idsEspaciosSolicitados = Array.from(new Set(espacioIdsIn.filter((n) => Number.isInteger(n)))) as number[];
      } else if (espaciosConsultados.length > 0) {
        const setNombresEspacios = new Set(
          espaciosConsultados.map((n) => String(n).trim().toLowerCase()),
        );
        tratamientosFiltrados = tratamientosFiltrados
          .map((t) => ({
            ...t,
            medicos: t.medicos
              .map((m) => ({
                ...m,
                espacios: (m.espacios || []).filter((e) =>
                  setNombresEspacios.has(String(e.nombre_espacio).trim().toLowerCase()),
                ),
              }))
              .filter((m) => (m.espacios && m.espacios.length > 0)),
          }))
          .filter((t) => t.medicos && t.medicos.length > 0);
      }

      if (idsEspaciosSolicitados.length) {
        const setIdsE = new Set(idsEspaciosSolicitados);
        tratamientosFiltrados = tratamientosFiltrados
          .map((t) => ({
            ...t,
            medicos: t.medicos
              .map((m) => ({
                ...m,
                espacios: (m.espacios || []).filter((e) => setIdsE.has(e.id_espacio)),
              }))
              .filter((m) => (m.espacios && m.espacios.length > 0)),
          }))
          .filter((t) => t.medicos && t.medicos.length > 0);
      }

      const idsMedicos = idsMedicosSolicitados.length
        ? idsMedicosSolicitados
        : [...new Set(tratamientosFiltrados.flatMap((t) => t.medicos.map((m) => m.id_medico)))];

      const idsEspacios = (
        idsEspaciosSolicitados.length
          ? idsEspaciosSolicitados
          : [
              ...new Set(
                tratamientosFiltrados.flatMap((t) =>
                  t.medicos.flatMap((m) => m.espacios.map((e) => e.id_espacio)),
                ),
              ),
            ]
      );

      if (!idsMedicos.length) {
        const event = AvailabilityEventCatalog.NINGUN_MEDICO_ENCONTRADO(
          tratamientoIds.length ? tratamientoIds.map(String) : tratamientosConsultados,
        );
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      if (!idsEspacios.length) {
        const event = AvailabilityEventCatalog.NINGUN_ESPACIO_ENCONTRADO(
          tratamientoIds.length ? tratamientoIds.map(String) : tratamientosConsultados,
          idsMedicos.map(String),
        );
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      // =============================
      // 3) Consultas SQL por fechas
      // =============================
      const consultasSQL = AvailabilitySQLBuilder({
        fechas: fechasValidas,
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
          consultasSQL.sql_citas.params,
        );
        progMedicos = await ejecutarConReintento(
          consultasSQL.sql_prog_medicos.text,
          consultasSQL.sql_prog_medicos.params,
        );
        progEspacios = await ejecutarConReintento(
          consultasSQL.sql_prog_espacios.text,
          consultasSQL.sql_prog_espacios.params,
        );
        progMedicoEspacio = await ejecutarConReintento(
          consultasSQL.sql_prog_medico_espacio.text,
          consultasSQL.sql_prog_medico_espacio.params,
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
          fechasValidas.map((f) => f.fecha),
        );
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      if (noProgEspacios && noProgMedicoEspacio) {
        const event = AvailabilityEventCatalog.NO_PROG_ESPACIOS(
          idsEspacios.map(String),
          fechasValidas.map((f) => f.fecha),
        );
        AvailabilityEventLogger.log(event);
        return { success: true, message: event.message, analisis_agenda: [] };
      }

      // =============================
      // 4) Cálculo de disponibilidad y ajuste de 3h desde ahora
      // =============================
      const availability = AvailabilityCalculator({
        tratamientos: tratamientosFiltrados,
        citas_programadas: citas,
        prog_medicos: progMedicos,
        prog_espacios: progEspacios,
        prog_medico_espacio: progMedicoEspacio,
      });

      const adjustedAvailability = AvailabilityAdjuster(availability, tiempo_actual);

      if (!adjustedAvailability.length) {
        const event = AvailabilityEventCatalog.SIN_HORARIOS_DISPONIBLES(
          tratamientoIds.length ? tratamientoIds.map(String) : tratamientosConsultados,
          fechasValidas,
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

export default AvailabilityDomainService;