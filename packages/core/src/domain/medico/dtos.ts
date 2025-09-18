// packages/core/src/domain/medico/dtos.ts

export interface MedicoDTO {
  id_medico: number;
  nombre_medico: string | null;
  apellido_medico: string | null;
  numero_colegiado: string | null;
  id_super_clinica: number;
  id_clinica: number | null;
  id_especialidad: number;
  id_usuario: number | null;
  id_estado_registro: number;
  old_id: number | null;
  fecha_migracion: string | null; // tratado como string (ISO) porque usamos dateStrings: true en MySQL
  detalles_migracion: Record<string, unknown> | null;
}

/**
 * Versión básica con solo lo mínimo para disponibilidad o listados.
 */
export type MedicoBasicDTO = Pick<MedicoDTO, "id_medico" | "nombre_medico" | "apellido_medico">;

/**
 * Versión que expone el nombre completo ya concatenado.
 */
export interface MedicoWithFullNameDTO extends Pick<MedicoDTO, "id_medico"> {
  nombre_completo: string;
}
