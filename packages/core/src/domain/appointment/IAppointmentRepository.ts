// packages/core/src/domain/appointment/IAppointmentRepository.ts

import { AppointmentDTO } from "@clinickeys-agents/core/domain/appointment/dtos";

export interface CreateAppointmentInput {
  id_paciente: number;
  id_clinica: number;
  id_super_clinica: number;
  id_medico: number;
  id_tratamiento: number;
  id_espacio: number;
  fecha_cita: string; // YYYY-MM-DD
  hora_inicio: string; // HH:mm:ss
  hora_fin: string;   // HH:mm:ss
  id_presupuesto?: number | null;
  id_pack_bono?: number | null;
  comentario_ia: string;
  [key: string]: any;
}

export interface UpdateAppointmentInput {
  id_cita: number;
  id_medico?: number;
  fecha_cita?: string;
  hora_inicio?: string;
  hora_fin?: string;
  id_espacio?: number;
  id_estado_cita?: number;
  id_estados_cita_in?: number | null;
  comentario_ia: string;
  [key: string]: any;
}

export interface CitaDetallePackTratamientoDTO {
  id_pack_bono: number;
  id_tratamiento: number;
  id_cita: number;
}

export interface IAppointmentRepository {
  /**
   * Crea una nueva cita.
   */
  createAppointment(params: CreateAppointmentInput): Promise<number>;

  /**
   * Actualiza una cita existente.
   */
  updateAppointment(params: UpdateAppointmentInput): Promise<void>;

  /**
   * Obtiene las citas de un paciente por clínica.
   */
  getAppointmentsByPatient(patientId: number, clinicId: number): Promise<AppointmentDTO[]>;

  /**
   * Obtiene una cita por su ID.
   */
  findById(id_cita: number): Promise<AppointmentDTO | undefined>;

  /**
   * Obtiene detalles de citas por pack de tratamiento para un paciente y clínica.
   */
  getCitasDetallePorPackTratamiento(id_paciente: number, id_clinica: number): Promise<CitaDetallePackTratamientoDTO[]>;

  /**
   * Inserta una cita asociada a un pack bono, usando stored procedure.
   */
  insertarCitaPackBonos(params: {
    p_id_clinica: number;
    p_id_super_clinica: number;
    p_id_paciente: number;
    p_id_medico: number;
    p_id_espacio: number;
    p_id_tratamiento: number;
    p_id_presupuesto: number;
    p_id_pack_bono: number;
    p_fecha_cita: string;
    p_hora_inicio: string;
    p_hora_fin: string;
    p_comentario_ia: string;
  }): Promise<any>;
}
