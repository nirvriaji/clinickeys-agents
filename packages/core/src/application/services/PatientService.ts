// packages/core/src/application/services/PatientService.ts

import { IAppointmentRepository } from "@clinickeys-agents/core/domain/appointment";
import { IPresupuestoRepository } from "@clinickeys-agents/core/domain/presupuesto";
import { IPackBonoRepository } from "@clinickeys-agents/core/domain/packBono";
import { IPatientRepository } from "@clinickeys-agents/core/domain/patient";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { DateTime } from "luxon";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";

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
    patientRepo: IPatientRepository,
    presupuestoRepo: IPresupuestoRepository,
    appointmentRepo: IAppointmentRepository,
    packBonoRepo: IPackBonoRepository;
  }) {
    this.patientRepo = patientRepo;
    this.presupuestoRepo = presupuestoRepo;
    this.appointmentRepo = appointmentRepo;
    this.packBonoRepo = packBonoRepo;
  }

  async findById(patientId: number): Promise<any | undefined> {
    Logger.debug('[PatientService] findById called', { patientId });
    const res = await this.patientRepo.findById(patientId);
    Logger.debug('[PatientService] findById result', { found: !!res });
    return res;
  }

  async createPatient(params: GetPatientByPhoneOrCreateParams): Promise<number> {
    Logger.info('[PatientService] createPatient called', { clinicId: params.id_clinica, superClinicId: params.id_super_clinica, kommo_lead_id: params.kommo_lead_id });
    const patientId = await this.patientRepo.createPatient(params);
    Logger.info('[PatientService] createPatient result', { patientId });
    return patientId;
  }

  async getPatientByPhoneOrCreate(params: GetPatientByPhoneOrCreateParams) {
    Logger.info('[PatientService] getPatientByPhoneOrCreate called', { telefono: params.telefono, id_clinica: params.id_clinica });
    let telefonoNacional = params.telefono;
    try {
      const phoneObj = parsePhoneNumberFromString(params.telefono);
      if (phoneObj) {
        telefonoNacional = phoneObj.nationalNumber;
        Logger.debug('[PatientService] Parsed national phone', { telefonoNacional });
      }
    } catch (err) {
      Logger.warn('[PatientService] Phone parse failed, using original', { telefono: params.telefono, error: err });
    }

    const pacientesExistentes = await this.patientRepo.findByNationalPhoneAndClinic(
      telefonoNacional,
      Number(params.id_clinica)
    );
    if (pacientesExistentes && pacientesExistentes.length) {
      Logger.info('[PatientService] Existing patients found', { count: pacientesExistentes.length });
      return pacientesExistentes;
    }

    Logger.debug('[PatientService] Creating new patient');
    const id_paciente = await this.patientRepo.createPatient({
      nombre: params.nombre,
      apellido: params.apellido,
      telefono: params.telefono,
      id_clinica: params.id_clinica,
      id_super_clinica: params.id_super_clinica,
      kommo_lead_id: params.kommo_lead_id,
    });

    Logger.info('[PatientService] New patient created', { id_paciente });
    return [{ id_paciente, nombre: params.nombre, apellido: params.apellido, telefono: params.telefono }];
  }

  async getBasicPatientsByPhone(telefono: string, id_clinica: number): Promise<any[]> {
    Logger.info('[PatientService] getBasicPatientsByPhone called', { telefono, id_clinica });

    let telefonoNacional = telefono;
    try {
      const phoneObj = parsePhoneNumberFromString(telefono);
      if (phoneObj) {
        telefonoNacional = phoneObj.nationalNumber;
        Logger.debug('[PatientService] Parsed national phone', { telefonoNacional });
      }
    } catch (err) {
      Logger.warn('[PatientService] Phone parse failed, using original', { telefono, error: err });
    }

    const pacientes = await this.patientRepo.findByNationalPhoneAndClinic(telefonoNacional, id_clinica);
    Logger.info('[PatientService] getBasicPatientsByPhone result', { count: pacientes?.length || 0 });

    // aquí devolvemos solo la info básica de paciente, no citas ni presupuestos ni packs
    return pacientes || [];
  }

  /**
   * Orquesta la consulta completa de info de pacientes, citas, packs y presupuestos.
   */
  async getPatientInfo(tiempoActualDT: DateTime, id_clinica: number, lead_phones: any): Promise<any> {
    Logger.info('[PatientService] getPatientInfo called', { id_clinica, lead_phones });

    if (!id_clinica) {
      Logger.error('[PatientService] Missing id_clinica');
      return {
        success: false,
        message: "Falta id_clinica en la solicitud",
        paciente: {}, citas: [], packsBonos: [], presupuestos: [],
      };
    }

    if (!lead_phones || typeof lead_phones !== "object") {
      Logger.warn('[PatientService] Invalid lead_phones, returning empty result');
      return {
        success: true,
        message: "No se pudo encontrar el paciente",
        paciente: {}, citas: [], packsBonos: [], presupuestos: []
      };
    }

    let telefono = lead_phones.in_conversation?.trim() || lead_phones.in_field?.trim() || lead_phones.in_contact?.trim();
    if (!telefono) {
      Logger.warn('[PatientService] No phone available from lead_phones');
      return {
        success: true,
        message: "No se pudo encontrar el paciente",
        paciente: {}, citas: [], packsBonos: [], presupuestos: []
      };
    }

    let telefonoSinPrefijo = telefono;
    try {
      const phoneNumber = parsePhoneNumberFromString(telefono);
      if (phoneNumber) telefonoSinPrefijo = phoneNumber.nationalNumber;
      Logger.debug('[PatientService] Extracted national phone', { telefonoSinPrefijo });
    } catch (err) {
      Logger.warn('[PatientService] Phone parse failed for lead phone', { telefono, error: err });
    }

    const pacientes = await this.patientRepo.findByNationalPhoneAndClinic(telefonoSinPrefijo, id_clinica);
    if (!pacientes || !pacientes.length) {
      Logger.warn('[PatientService] Patients not found', { telefonoSinPrefijo, id_clinica });
      return {
        success: true,
        message: "[ERROR_NO_PATIENT_FOUND] No se pudo encontrar el paciente",
        paciente: {}, citas: [], packsBonos: [], presupuestos: []
      };
    }

    const patientsInfo = await Promise.all(
      pacientes.map(async (paciente: any) => {
        const idPaciente = paciente.id_paciente;
        Logger.debug('[PatientService] Processing patient', { idPaciente });

        const presupuestos = await this.presupuestoRepo.getPresupuestosByPacienteId(idPaciente, id_clinica);
        const presupuestosMapped = (presupuestos || []).map((p: any) => ({
          id_presupuesto: p.id_presupuesto,
          fecha: p.fecha,
          url_presupuesto: `https://clinickeys.com/clients/presupuesto/pdf-generate/?id_presupuesto=${p.id_presupuesto}`,
          monto_total: p.monto_total,
          monto_pagado: p.monto_pagado,
          saldo_pendiente: p.saldo_pendiente,
          id_tipo_pago: p.id_tipo_pago,
          nombre_tipo_pago: p.nombre_tipo_pago,
          nombre_estado: p.nombre_estado
        }));

        const citasRaw = await this.appointmentRepo.getAppointmentsByPatient(idPaciente, id_clinica);
        const citasFiltradas = (citasRaw || []).filter((cita: any) => {
          const fecha = cita.fecha_cita instanceof Date
            ? DateTime.fromJSDate(cita.fecha_cita).toISODate()
            : cita.fecha_cita;
          const hora = cita.hora_inicio || '00:00:00';
          const fechaHoraISO = `${fecha}T${hora}`;
          const zone = tiempoActualDT.zoneName ?? 'UTC';
          const citaDT = DateTime.fromISO(fechaHoraISO, { zone });
          return citaDT > tiempoActualDT;
        });

        const citas = citasFiltradas.map((cita: any) => {
          const fecha = cita.fecha_cita instanceof Date
            ? DateTime.fromJSDate(cita.fecha_cita)
            : DateTime.fromISO(cita.fecha_cita);

          const hora = cita.hora_inicio || '00:00:00';
          const citaDT = DateTime.fromISO(
            `${fecha.toISODate()}T${hora}`,
            { zone: tiempoActualDT.zoneName ?? 'UTC' }
          );

          return {
            id_cita: cita.id_cita,
            id_medico: cita.id_medico,
            id_tratamiento: cita.id_tratamiento,
            fecha_cita: cita.fecha_cita,
            hora_inicio: cita.hora_inicio,
            hora_fin: cita.hora_fin,
            id_espacio: cita.id_espacio,
            id_presupuesto: cita.id_presupuesto,
            id_pack_bono: cita.id_pack_bono,
            nombre_espacio: cita.nombre_espacio,
            nombre_tratamiento: cita.nombre_tratamiento,
            nombre_medico: cita.nombre_medico,
            dia_semana: citaDT.setLocale("es").toFormat("cccc"),
            [`ultimo_resumen_cita_ID_${cita.id_cita}`]: cita.comentario_ia,
          };
        });

        const packSesiones = await this.packBonoRepo.getPackBonosSesionesByPacienteId(idPaciente);
        const citasDetalle = await this.appointmentRepo.getCitasDetallePorPackTratamiento(idPaciente, id_clinica);
        const lookupCitas: Record<string, any[]> = {};
        (citasDetalle || []).forEach((row: any) => {
          const key = `${row.id_pack_bono}_${row.id_tratamiento}`;
          if (!lookupCitas[key]) lookupCitas[key] = [];
          lookupCitas[key].push(row.id_cita);
        });

        const packsBonos = await Promise.all(
          (packSesiones || []).map(async (sesion: any) => {
            const packBono = await this.packBonoRepo.getPackBonoById(sesion.id_pack_bono, id_clinica);
            if (!packBono) return null;
            const tratamientos = await this.packBonoRepo.getPackBonoTratamientos(sesion.id_pack_bono);
            const tratamientosConUso = (tratamientos || []).map((tratamiento: any) => {
              const key = `${sesion.id_pack_bono}_${tratamiento.id_tratamiento}`;
              const citas_id = lookupCitas[key] || [];
              const sesiones_usadas = citas_id.length;
              return {
                id_pack_bono: sesion.id_pack_bono,
                id_tratamiento: tratamiento.id_tratamiento,
                total_sesiones: tratamiento.total_sesiones,
                sesiones_usadas,
                citas_id
              };
            });
            const total_sesiones = tratamientosConUso.reduce((sum: number, t: any) => sum + Number(t.total_sesiones), 0);
            const total_sesiones_utilizadas = tratamientosConUso.reduce((sum: number, t: any) => sum + Number(t.sesiones_usadas), 0);
            return {
              packBono: {
                id_pack_bono: packBono.id_pack_bono,
                id_paciente: idPaciente,
                id_clinica: packBono.id_clinica,
                id_super_clinica: packBono.id_super_clinica,
                nombre: packBono.nombre,
                descripcion: packBono.descripcion,
                precio: packBono.precio,
                total_sesiones,
                total_sesiones_utilizadas,
                tratamientos: tratamientosConUso
              }
            };
          })
        );

        return {
          paciente,
          citas,
          packsBonos: packsBonos.filter(item => item !== null),
          presupuestos: presupuestosMapped
        };
      })
    );

    const out = { success: true, message: null, patients: patientsInfo };
    Logger.info('[PatientService] getPatientInfo result', { patients: patientsInfo.length });
    return out;
  }

  async updateKommoLeadId(patientId: number, kommoLeadId: number): Promise<void> {
    Logger.info('[PatientService] updateKommoLeadId called', { patientId, kommoLeadId });
    return this.patientRepo.updateKommoLeadId(patientId, kommoLeadId);
  }
}
