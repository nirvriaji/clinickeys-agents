// packages/core/src/domain/tratamiento/ITratamientoRepository.ts

import {
  TratamientoDTO,
  TratamientoBasicDTO,
  TratamientoWithClinicDTO,
  TratamientoSearchResultDTO,
} from "./dtos";

export interface ITratamientoRepository {
  /**
   * Obtiene todos los tratamientos activos de una clínica y super clínica.
   */
  getActiveTreatmentsForClinic(
    id_clinica: number,
    id_super_clinica: number
  ): Promise<TratamientoDTO[]>;

  /**
   * Obtiene los detalles de un tratamiento por su ID.
   */
  getTreatmentDetailsById(
    id_tratamiento: number
  ): Promise<TratamientoDTO | undefined>;

  /**
   * Busca tratamientos que contengan el nombre proporcionado (LIKE %...%).
   */
  findTreatmentsContainingName(
    nombre: string,
    id_clinica: number,
    id_super_clinica: number
  ): Promise<TratamientoDTO[]>;

  /**
   * Busca tratamientos por un array de nombres, devolviendo relevancia y coincidencia exacta.
   */
  findTreatmentsByNamesWithRelevance(
    nombres: string[],
    id_clinica: number
  ): Promise<TratamientoSearchResultDTO[]>;
}
