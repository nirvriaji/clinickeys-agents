import {
  TratamientoDTO,
  TratamientoBasicDTO,
  TratamientoWithClinicDTO,
  TratamientoSearchResultDTO,
} from "./dtos";

/**
 * Contrato del repositorio de tratamientos.
 *
 * Nota: Mantiene compatibilidad con los métodos existentes y añade
 * un método ID-first para resolver múltiples tratamientos por sus IDs.
 */
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

  /**
   * Obtiene tratamientos por un conjunto de IDs.
   * \- ID-first: permite resolver canónicamente sin depender de nombres.
   * \- No falla si algún ID no existe; simplemente no lo incluye en el resultado.
   */
  findTreatmentsByIds(ids: number[]): Promise<TratamientoDTO[]>;
}