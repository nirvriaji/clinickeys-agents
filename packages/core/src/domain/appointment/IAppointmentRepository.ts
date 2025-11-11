// packages/core/src/domain/appointment/IAppointmentRepository.ts

import { AppointmentDTO } from "@clinickeys-agents/core/domain/appointment/dtos";

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

export interface IAppointmentRepository {
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
  findAppointmentById(id_cita: number): Promise<AppointmentDTO | undefined>;

  /**
   * Inserta una cita asociada a un pack bono, usando stored procedure.
   */
  insertarCitaConComentario(params: {
    p_id_clinica: number;
    p_id_super_clinica: number;
    p_id_paciente: number;
    p_id_medico: number;
    p_id_espacio: number;
    p_id_tratamiento: number;
    p_id_presupuesto: number;
    p_fecha_cita: string;
    p_hora_inicio: string;
    p_hora_fin: string;
    p_comentario_ia: string;
    p_id_bono_paciente: number | null;
    p_item_bono_paciente: number | null;
  }): Promise<any>;
}
