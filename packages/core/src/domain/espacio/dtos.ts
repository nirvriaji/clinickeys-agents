// packages/core/src/domain/espacio/dtos.ts

export interface EspacioDTO {
  id_espacio: number;
  nombre: string;
  descripcion: string;
  id_super_clinica: number;
  id_clinica: number;
  id_estado_registro: number;
}

/**
 * Versión básica solo con id y nombre, útil para listados rápidos.
 */
export type EspacioBasicDTO = Pick<EspacioDTO, "id_espacio" | "nombre">;

/**
 * Versión extendida con nombre de la clínica (para joins).
 */
export interface EspacioWithClinicDTO extends EspacioDTO {
  nombre_clinica: string;
}
