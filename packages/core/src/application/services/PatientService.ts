// packages/core/src/application/services/PatientService.ts

import { IAppointmentRepository, AppointmentDTO } from "@clinickeys-agents/core/domain/appointment";
import { IPresupuestoRepository, PresupuestoDTO } from "@clinickeys-agents/core/domain/presupuesto";
import {
  IBonoRepository,
  BonoConUsoDTO,
  BonoSesionDetalleDTO,
} from "@clinickeys-agents/core/domain/bono";
import { IPatientRepository, PatientDTO } from "@clinickeys-agents/core/domain/patient";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { DateTime } from "luxon";
import { PhoneNumber } from "@clinickeys-agents/core/domain/common";

export interface GetPatientByPhoneOrCreateParams {
  nombre: string;
  apellido: string;
  telefono: string;
  id_clinica: number;
  id_super_clinica: number;
  kommo_lead_id: number;
}

export class PatientService {
  private readonly patientRepo: IPatientRepository;
  private readonly presupuestoRepo: IPresupuestoRepository;
  private readonly appointmentRepo: IAppointmentRepository;
  private readonly BonoRepo: IBonoRepository;

  constructor({
    patientRepo,
    appointmentRepo,
    presupuestoRepo,
    BonoRepo,
  }: {
    patientRepo: IPatientRepository;
    presupuestoRepo: IPresupuestoRepository;
    appointmentRepo: IAppointmentRepository;
    BonoRepo: IBonoRepository;
  }) {
    this.patientRepo = patientRepo;
    this.presupuestoRepo = presupuestoRepo;
    this.appointmentRepo = appointmentRepo;
    this.BonoRepo = BonoRepo;
  }

  async findById(patientId: number): Promise<PatientDTO | undefined> {
    Logger.debug("[PatientService] findById called", { patientId });
    const res = await this.patientRepo.findById(patientId);
    Logger.debug("[PatientService] findById result", { found: !!res });
    return res;
  }

  async createPatient(params: GetPatientByPhoneOrCreateParams): Promise<number> {
    Logger.info("[PatientService] createPatient called", {
      clinicId: params.id_clinica,
      superClinicId: params.id_super_clinica,
      kommo_lead_id: params.kommo_lead_id,
    });

    // Guardamos el teléfono tal cual llega (para no alterar UX),
    // pero las búsquedas siempre se harán con digitsOnly.
    const patientId = await this.patientRepo.createPatient(params);
    Logger.info("[PatientService] createPatient result", { patientId });
    return patientId;
  }

  async getPatientByPhoneOrCreate(
    params: GetPatientByPhoneOrCreateParams
  ): Promise<PatientDTO[]> {
    Logger.info("[PatientService] getPatientByPhoneOrCreate called", {
      telefono: params.telefono,
      id_clinica: params.id_clinica,
    });

    // Normalizamos el teléfono del usuario con el VO.
    const pn = PhoneNumber.fromFreeform(params.telefono);
    const telefonoNacional = pn.national || pn.digitsOnly;
    Logger.debug("[PatientService] Normalized user phone", {
      input: params.telefono,
      national: pn.national,
      digitsOnly: pn.digitsOnly,
      isValid: pn.isValid,
    });

    const pacientesExistentes = await this.patientRepo.findByNationalPhoneAndClinic(
      telefonoNacional,
      Number(params.id_clinica)
    );

    if (pacientesExistentes && pacientesExistentes.length) {
      Logger.info("[PatientService] Existing patients found", {
        count: pacientesExistentes.length,
      });
      return pacientesExistentes;
    }

    Logger.debug("[PatientService] Creating new patient");
    const id_paciente = await this.patientRepo.createPatient(params);

    Logger.info("[PatientService] New patient created", { id_paciente });
    return [
      {
        id_paciente,
        nombre: params.nombre,
        apellido: params.apellido,
        telefono: params.telefono,
      } as PatientDTO,
    ];
  }

  async getBasicPatientsByPhone(
    telefono: string,
    id_clinica: number
  ): Promise<PatientDTO[]> {
    Logger.info("[PatientService] getBasicPatientsByPhone called", {
      telefono,
      id_clinica,
    });

    const pn = PhoneNumber.fromFreeform(telefono);
    const telefonoNacional = pn.national || pn.digitsOnly;
    Logger.debug("[PatientService] Normalized basic phone", {
      input: telefono,
      national: pn.national,
      digitsOnly: pn.digitsOnly,
      isValid: pn.isValid,
    });

    const pacientes = await this.patientRepo.findByNationalPhoneAndClinic(
      telefonoNacional,
      id_clinica
    );
    Logger.info("[PatientService] getBasicPatientsByPhone result", {
      count: pacientes?.length || 0,
    });

    return pacientes || [];
  }

  /**
   * Orquesta la consulta completa de info de pacientes, citas, packs y presupuestos.
   */
  async getPatientInfo(
    tiempoActualDT: DateTime,
    id_clinica: number,
    lead_phones: { in_conversation?: string; in_lead_cf?: string; in_contact_cf?: string }
  ): Promise<{
    success: boolean;
    message: string | null;
    patients: {
      paciente: PatientDTO;
      presupuestos: PresupuestoDTO[];
      citas: AppointmentDTO[];
      packsBonos: BonoConUsoDTO[];
    }[];
  }> {
    Logger.info("[PatientService] getPatientInfo called", {
      id_clinica,
      lead_phones,
    });

    if (!id_clinica) {
      Logger.error("[PatientService] Missing id_clinica");
      return { success: false, message: "Falta id_clinica en la solicitud", patients: [] };
    }

    if (!lead_phones || typeof lead_phones !== "object") {
      Logger.warn("[PatientService] Invalid lead_phones, returning empty result");
      return { success: true, message: "No se pudo encontrar el paciente", patients: [] };
    }

    const telefonos = [
      lead_phones.in_conversation,
      lead_phones.in_lead_cf,
      lead_phones.in_contact_cf,
    ]
      .filter(Boolean)
      .map((t) => (t as string).trim())
      .map((t) => PhoneNumber.fromFreeform(t)) // reforzamos invariantes, vengan de donde vengan
      .map((pn) => pn.national || pn.digitsOnly)
      .filter((t) => !!t);

    if (!telefonos.length) {
      Logger.warn("[PatientService] No phone available from lead_phones");
      return { success: true, message: "No se pudo encontrar el paciente", patients: [] };
    }

    const pacientesMap = new Map<number, PatientDTO>();

    for (const tel of telefonos) {
      const encontrados = await this.patientRepo.findByNationalPhoneAndClinic(
        tel,
        id_clinica
      );
      (encontrados || []).forEach((p) => pacientesMap.set(p.id_paciente, p));
    }

    const pacientes = Array.from(pacientesMap.values());

    if (!pacientes.length) {
      Logger.warn("[PatientService] Patients not found", {
        id_clinica,
        telefonos,
      });
      return {
        success: true,
        message: "[ERROR_NO_PATIENT_FOUND] No se pudo encontrar el paciente",
        patients: [],
      };
    }

    const patientsInfo = await Promise.all(
      pacientes.map(async (paciente: PatientDTO) => ({
        paciente,
        presupuestos: await this.fetchPresupuestos(paciente.id_paciente, id_clinica),
        citas: await this.fetchCitas(paciente.id_paciente, id_clinica, tiempoActualDT),
        packsBonos: await this.fetchBonos(paciente.id_paciente, id_clinica),
      }))
    );

    const out = { success: true, message: null, patients: patientsInfo };
    return out;
  }

  private async fetchPresupuestos(
    idPaciente: number,
    idClinica: number
  ): Promise<PresupuestoDTO[]> {
    const presupuestos = await this.presupuestoRepo.getPresupuestosByPacienteId(
      idPaciente,
      idClinica
    );
    return (presupuestos || []).map((p) => ({
      ...p,
      url_presupuesto: `https://clinickeys.com/clients/presupuesto/pdf-generate/?id_presupuesto=${p.id_presupuesto}`,
    }));
  }

  private async fetchCitas(
    idPaciente: number,
    idClinica: number,
    tiempoActualDT: DateTime
  ): Promise<AppointmentDTO[]> {
    const citasRaw = await this.appointmentRepo.getAppointmentsByPatient(
      idPaciente,
      idClinica
    );

    const citasFiltradas = (citasRaw || []).filter((cita) => {
      const fecha = cita.fecha_cita;
      const hora = cita.hora_inicio || "00:00:00";
      const fechaHoraISO = `${fecha}T${hora}`;
      const zone = tiempoActualDT.zoneName ?? "UTC";
      const citaDT = DateTime.fromISO(fechaHoraISO, { zone });
      const limiteInferior = tiempoActualDT.minus({ days: 400 });
      return citaDT >= limiteInferior;
    });

    return this.normalizeAppointmentStatus(citasFiltradas, tiempoActualDT);
  }

  private normalizeAppointmentStatus(
    citas: AppointmentDTO[],
    tiempoActualDT: DateTime
  ): AppointmentDTO[] {
    return citas.map((cita) => {
      const inicio = DateTime.fromISO(`${cita.fecha_cita}T${cita.hora_inicio}`);
      const fin = DateTime.fromISO(`${cita.fecha_cita}T${cita.hora_fin}`);
      let estado = cita.estado_cita;

      if (tiempoActualDT >= inicio && tiempoActualDT <= fin) {
        estado = "En curso";
      } else if (
        ["Programado", "Reprogramado", "Consulta", "Espera"].includes(cita.estado_cita) &&
        tiempoActualDT > fin
      ) {
        estado = "Terminado";
      }

      return { ...cita, estado_cita: estado };
    });
  }

  private async fetchBonos(
    idPaciente: number,
    idClinica: number
  ): Promise<BonoConUsoDTO[]> {
    Logger.debug("[PatientService] fetchBonos called", { idPaciente, idClinica });

    // 1) Trae los detalles del bono por paciente (ítems/tratamientos)
    const detalles = await this.BonoRepo.getBonosSesionesDetallesByPacienteId(idPaciente);
    if (!detalles || !detalles.length) {
      Logger.debug("[PatientService] fetchBonos: no pack/bono details found", { idPaciente });
      return [];
    }

    // 2) Fuente de verdad del consumo: recibos/detalle_recibo (NO citas)
    const detallesRecibo = await this.BonoRepo.getDetalleRecibosByPacienteId(idPaciente);

    // 3) Construir índices de uso por clave (bono-item-tratamiento)
    //    Clave elegida: `tratamiento_${id_tratamiento}_${item}`
    const sesionesUsadas: Record<string, number> = {};
    for (const dr of detallesRecibo || []) {
      if (!dr || dr.id_tratamiento == null || dr.item == null) continue;
      const key = `tratamiento_${dr.id_tratamiento}_${dr.item}`;
      const cant = Number(dr.cantidad || 0);
      if (!Number.isFinite(cant)) continue;
      sesionesUsadas[key] = (sesionesUsadas[key] || 0) + cant;
    }

    // 4) Agrupar detalles por bono
    const bonosMap = new Map<number, BonoSesionDetalleDTO[]>();
    for (const d of detalles) {
      if (!bonosMap.has(d.id_bono_paciente)) bonosMap.set(d.id_bono_paciente, []);
      bonosMap.get(d.id_bono_paciente)!.push(d);
    }

    // 5) Construir salida – sin legacy, sin citas_id, con item_bono_paciente
    const bonos: BonoConUsoDTO[] = [];

    for (const [id_bono_paciente, items] of bonosMap) {
      const head = items[0];

      const tratamientos = items
        .filter(i => i.id_tratamiento != null)
        .map(i => {
          const total = Number(i.cantidad || 0);
          const key = `tratamiento_${i.id_tratamiento}_${i.item}`;
          const usadasDesdeRecibos = Number(sesionesUsadas[key] || 0);
          // Cap para evitar sobreconsumo por inconsistencias contables
          const sesiones_usadas = Math.min(Math.max(usadasDesdeRecibos, 0), Math.max(total, 0));

          return {
            id_tratamiento: i.id_tratamiento as number,
            item_bono_paciente: i.item,
            total_sesiones: total,
            sesiones_usadas,
          };
        });

      const total_sesiones = tratamientos.reduce((s, t) => s + t.total_sesiones, 0);
      const total_sesiones_utilizadas = tratamientos.reduce((s, t) => s + t.sesiones_usadas, 0);

      bonos.push({
        id_bono_paciente,
        id_clinica: idClinica,
        nombre: head.nombre_bono,
        descripcion: head.descripcion ?? "",
        precio: Number(head.monto_total),
        total_sesiones,
        total_sesiones_utilizadas,
        tratamientos,
      });
    }

    Logger.debug("[PatientService] fetchBonos result", { bonos });
    return bonos;
  }

  async updateKommoLeadId(patientId: number, kommoLeadId: string): Promise<void> {
    Logger.info("[PatientService] updateKommoLeadId called", {
      patientId,
      kommoLeadId,
    });
    return this.patientRepo.updateKommoLeadId(patientId, kommoLeadId);
  }
}