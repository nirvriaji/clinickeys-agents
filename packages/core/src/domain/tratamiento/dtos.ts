// packages/core/src/domain/tratamiento/dtos.ts

/**
 * Representa un tratamiento completo con todos sus campos.
 */
export interface TratamientoDTO {
  id_tratamiento: number;
  nombre_tratamiento: string;
  descripcion: string;
  duracion: number; // en minutos
  precio: number;
  id_estado_registro: number;
  id_clinica: number;
  id_super_clinica: number;
}

/**
 * Versión básica solo con id y nombre, útil para listados rápidos.
 */
export type TratamientoBasicDTO = Pick<
  TratamientoDTO,
  "id_tratamiento" | "nombre_tratamiento"
>;

/**
 * Versión extendida con nombre de la clínica (para joins).
 */
export interface TratamientoWithClinicDTO extends TratamientoDTO {
  nombre_clinica: string;
}

/**
 * Versión con campos de búsqueda y relevancia, útil para resultados de búsqueda avanzada.
 */
export interface TratamientoSearchResultDTO extends TratamientoDTO {
  relevance: number;
  is_exact: number; // 1 si es coincidencia exacta, 0 en caso contrario
}