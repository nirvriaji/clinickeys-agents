// packages/core/src/application/services/AppointmentService.ts

import { IAppointmentRepository, UpdateAppointmentInput, AppointmentDTO } from "@clinickeys-agents/core/domain/appointment";
import { AvailabilityEventCatalog } from "@clinickeys-agents/core/domain/availability/events";
import { AvailabilityEventLogger } from "@clinickeys-agents/core/infrastructure/logging";

export class AppointmentService {
  private appointmentRepository: IAppointmentRepository;

  constructor(appointmentRepository: IAppointmentRepository) {
    this.appointmentRepository = appointmentRepository;
  }

  async updateAppointment(params: UpdateAppointmentInput): Promise<void> {
    return await this.appointmentRepository.updateAppointment(params);
  }

  async getAppointmentsByPatient(patientId: number, clinicId: number): Promise<any[]> {
    return await this.appointmentRepository.getAppointmentsByPatient(patientId, clinicId);
  }

  async getAppointmentById(appointmentId: number): Promise<AppointmentDTO | undefined> {
    return await this.appointmentRepository.findAppointmentById(appointmentId);
  }

  async confirmAppointment(appointmentId: number, summary: string): Promise<any | undefined> {
    const appointment = await this.getAppointmentById(appointmentId);
    if (!appointment) {
      const event = AvailabilityEventCatalog.CLINICA_NO_ENCONTRADA(appointmentId);
      AvailabilityEventLogger.log(event);
      return undefined;
    }

    const CONFIRMED_STATUS_IN = 36;

    await this.updateAppointment({
      id_cita: appointmentId,
      id_estados_cita_in: CONFIRMED_STATUS_IN,
      comentario_ia: summary,
    });

    return await this.getAppointmentById(appointmentId);
  }

  async unconfirmAppointment(appointmentId: number, summary: string): Promise<any | undefined> {
    const appointment = await this.getAppointmentById(appointmentId);
    if (!appointment) {
      const event = AvailabilityEventCatalog.CLINICA_NO_ENCONTRADA(appointmentId);
      AvailabilityEventLogger.log(event);
      return undefined;
    }

    const UNCONFIRMED_STATUS_IN = null;

    await this.updateAppointment({
      id_cita: appointmentId,
      id_estados_cita_in: UNCONFIRMED_STATUS_IN,
      comentario_ia: summary,
    });

    return await this.getAppointmentById(appointmentId);
  }

  async cancelAppointment(appointmentId: number, summary: string): Promise<any | undefined> {
    const appointment = await this.getAppointmentById(appointmentId);
    if (!appointment) {
      const event = AvailabilityEventCatalog.CLINICA_NO_ENCONTRADA(appointmentId);
      AvailabilityEventLogger.log(event);
      return undefined;
    }

    const CANCELED_STATUS = 2;

    await this.updateAppointment({
      id_cita: appointmentId,
      id_estado_cita: CANCELED_STATUS,
      comentario_ia: summary,
    });

    return await this.getAppointmentById(appointmentId);
  }

  async markOnTheWay(appointmentId: number, summary: string): Promise<any | undefined> {
    const appointment = await this.getAppointmentById(appointmentId);
    if (!appointment) {
      const event = AvailabilityEventCatalog.CLINICA_NO_ENCONTRADA(appointmentId);
      AvailabilityEventLogger.log(event);
      return undefined;
    }

    const ON_THE_WAY_STATUS_IN = 10;

    await this.updateAppointment({
      id_cita: appointmentId,
      id_estados_cita_in: ON_THE_WAY_STATUS_IN,
      comentario_ia: summary,
    });

    return await this.getAppointmentById(appointmentId);
  }

  async insertarCitaConComentario(params: {
    p_id_clinica: number;
    p_id_super_clinica: number;
    p_id_paciente: number;
    p_id_medico: number;
    p_id_espacio: number;
    p_id_tratamiento: number;
    p_id_presupuesto: number;
    p_id_bono_paciente: number | null;
    p_item_bono_paciente: number | null;
    p_fecha_cita: string;
    p_hora_inicio: string;
    p_hora_fin: string;
    p_comentario_ia: string;
  }): Promise<any> {
    return await this.appointmentRepository.insertarCitaConComentario(params);
  }
}