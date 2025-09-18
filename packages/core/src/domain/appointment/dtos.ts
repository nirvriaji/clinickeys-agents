// packages/core/src/domain/appointment/dtos.ts

export interface AppointmentDTO {
  id_cita: number;
  id_paciente: number;
  id_medico: number;
  id_super_clinica: number;
  id_clinica: number;
  id_tratamiento: number;
  id_espacio: number;

  fecha_cita: string; // YYYY-MM-DD
  hora_inicio: string; // HH:mm:ss
  hora_fin: string;   // HH:mm:ss

  id_presupuesto?: number | null;
  id_pack_bono?: number | null;
  comentario_ia?: string | null;

  // Datos obtenidos por joins
  nombre_espacio?: string | null;
  nombre_tratamiento?: string | null;
  nombre_medico?: string | null;
  estado_cita: string;
}
