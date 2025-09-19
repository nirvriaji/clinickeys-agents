// packages/core/src/application/services/PatientService.ts

import { IAppointmentRepository, AppointmentDTO } from "@clinickeys-agents/core/domain/appointment";
import { IPresupuestoRepository, PresupuestoDTO } from "@clinickeys-agents/core/domain/presupuesto";
import { IPackBonoRepository, PackBonoConUsoDTO } from "@clinickeys-agents/core/domain/packBono";
import { IPatientRepository, PatientDTO } from "@clinickeys-agents/core/domain/patient";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { DateTime } from "luxon";

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
  private readonly packBonoRepo: IPackBonoRepository;

  constructor({
    patientRepo,
    appointmentRepo,
    presupuestoRepo,
    packBonoRepo,
  }: {
    patientRepo: IPatientRepository;
    presupuestoRepo: IPresupuestoRepository;
    appointmentRepo: IAppointmentRepository;
    packBonoRepo: IPackBonoRepository;
  }) {
    this.patientRepo = patientRepo;
    this.presupuestoRepo = presupuestoRepo;
    this.appointmentRepo = appointmentRepo;
    this.packBonoRepo = packBonoRepo;
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
    let telefonoNacional = params.telefono;
    try {
      const phoneObj = parsePhoneNumberFromString(params.telefono);
      if (phoneObj) {
        telefonoNacional = phoneObj.nationalNumber;
        Logger.debug("[PatientService] Parsed national phone", {
          telefonoNacional,
        });
      }
    } catch (err) {
      Logger.warn("[PatientService] Phone parse failed, using original", {
        telefono: params.telefono,
        error: err,
      });
    }

    const pacientesExistentes =
      await this.patientRepo.findByNationalPhoneAndClinic(
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

    let telefonoNacional = telefono;
    try {
      const phoneObj = parsePhoneNumberFromString(telefono);
      if (phoneObj) {
        telefonoNacional = phoneObj.nationalNumber;
        Logger.debug("[PatientService] Parsed national phone", {
          telefonoNacional,
        });
      }
    } catch (err) {
      Logger.warn("[PatientService] Phone parse failed, using original", {
        telefono,
        error: err,
      });
    }

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
      packsBonos: PackBonoConUsoDTO[];
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
    ].filter(Boolean).map((t) => t!.trim());

    if (!telefonos.length) {
      Logger.warn("[PatientService] No phone available from lead_phones");
      return { success: true, message: "No se pudo encontrar el paciente", patients: [] };
    }

    const pacientesMap = new Map<number, PatientDTO>();

    for (const tel of telefonos) {
      let telefonoSinPrefijo = tel;
      try {
        const phoneNumber = parsePhoneNumberFromString(tel);
        if (phoneNumber) telefonoSinPrefijo = phoneNumber.nationalNumber;
        Logger.debug("[PatientService] Extracted national phone", {
          telefonoSinPrefijo,
        });
      } catch (err) {
        Logger.warn("[PatientService] Phone parse failed for lead phone", {
          tel,
          error: err,
        });
      }

      const encontrados = await this.patientRepo.findByNationalPhoneAndClinic(
        telefonoSinPrefijo,
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
        packsBonos: await this.fetchPacksBonos(paciente.id_paciente, id_clinica),
      }))
    );

    const out = { success: true, message: null, patients: patientsInfo };
    Logger.info("[PatientService] getPatientInfo result", {
      patients: patientsInfo.length,
    });
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

  private async fetchPacksBonos(
    idPaciente: number,
    idClinica: number
  ): Promise<PackBonoConUsoDTO[]> {
    const packSesiones = await this.packBonoRepo.getPackBonosSesionesByPacienteId(
      idPaciente
    );
    const citasDetalle =
      await this.appointmentRepo.getCitasDetallePorPackTratamiento(
        idPaciente,
        idClinica
      );
    const lookupCitas: Record<string, number[]> = {};
    (citasDetalle || []).forEach((row) => {
      const key = `${row.id_pack_bono}_${row.id_tratamiento}`;
      if (!lookupCitas[key]) lookupCitas[key] = [];
      lookupCitas[key].push(row.id_cita);
    });

    const packsBonos = await Promise.all(
      (packSesiones || []).map(async (sesion) => {
        const packBono = await this.packBonoRepo.getPackBonoById(
          sesion.id_pack_bono,
          idClinica
        );
        if (!packBono) return null;
        const tratamientos = await this.packBonoRepo.getPackBonoTratamientos(
          sesion.id_pack_bono
        );
        const tratamientosConUso = (tratamientos || []).map((tratamiento) => {
          const key = `${sesion.id_pack_bono}_${tratamiento.id_tratamiento}`;
          const citas_id = lookupCitas[key] || [];
          return {
            id_pack_bono: sesion.id_pack_bono,
            id_tratamiento: tratamiento.id_tratamiento,
            total_sesiones: tratamiento.total_sesiones,
            sesiones_usadas: citas_id.length,
            citas_id,
          };
        });
        const total_sesiones = tratamientosConUso.reduce(
          (sum, t) => sum + Number(t.total_sesiones),
          0
        );
        const total_sesiones_utilizadas = tratamientosConUso.reduce(
          (sum, t) => sum + Number(t.sesiones_usadas),
          0
        );
        return {
          ...packBono,
          total_sesiones,
          total_sesiones_utilizadas,
          tratamientos: tratamientosConUso,
        } as PackBonoConUsoDTO;
      })
    );

    return packsBonos.filter((item): item is PackBonoConUsoDTO => item !== null);
  }

  async updateKommoLeadId(patientId: number, kommoLeadId: string): Promise<void> {
    Logger.info("[PatientService] updateKommoLeadId called", {
      patientId,
      kommoLeadId,
    });
    return this.patientRepo.updateKommoLeadId(patientId, kommoLeadId);
  }
}