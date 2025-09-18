// packages/core/src/infrastructure/tratamiento/TratamientoRepositoryMySQL.ts

import {
  ejecutarConReintento,
  ejecutarUnicoResultado,
} from "@clinickeys-agents/core/infrastructure/helpers";
import {
  TratamientoDTO,
  TratamientoSearchResultDTO,
} from "@clinickeys-agents/core/domain/tratamiento/dtos";
import { ITratamientoRepository } from "@clinickeys-agents/core/domain/tratamiento/ITratamientoRepository";

export class TratamientoRepositoryMySQL implements ITratamientoRepository {
  /**
   * Obtiene todos los tratamientos activos de una clínica y super clínica.
   */
  async getActiveTreatmentsForClinic(
    id_clinica: number,
    id_super_clinica: number
  ): Promise<TratamientoDTO[]> {
    const query = `
      SELECT 
        t.id_tratamiento,
        t.nombre_tratamiento,
        t.descripcion,
        t.duracion,
        t.precio,
        t.id_estado_registro,
        t.id_clinica,
        t.id_super_clinica
      FROM tratamientos t
      WHERE t.id_clinica = ? 
        AND t.id_super_clinica = ?
        AND t.id_estado_registro = 1
      ORDER BY t.nombre_tratamiento ASC
    `;
    return await ejecutarConReintento<TratamientoDTO>(query, [id_clinica, id_super_clinica]);
  }

  /**
   * Obtiene los detalles de un tratamiento por su ID.
   */
  async getTreatmentDetailsById(
    id_tratamiento: number
  ): Promise<TratamientoDTO | undefined> {
    const query = `
      SELECT 
        t.id_tratamiento,
        t.nombre_tratamiento,
        t.descripcion,
        t.duracion,
        t.precio,
        t.id_estado_registro,
        t.id_clinica,
        t.id_super_clinica
      FROM tratamientos t
      WHERE t.id_tratamiento = ?
      LIMIT 1
    `;
    const row = await ejecutarUnicoResultado<TratamientoDTO>(query, [id_tratamiento]);
    return row || undefined;
  }

  /**
   * Busca tratamientos que contengan el nombre proporcionado (LIKE %...%).
   */
  async findTreatmentsContainingName(
    nombre: string,
    id_clinica: number,
    id_super_clinica: number
  ): Promise<TratamientoDTO[]> {
    const query = `
      SELECT 
        t.id_tratamiento,
        t.nombre_tratamiento,
        t.descripcion,
        t.duracion,
        t.precio,
        t.id_estado_registro,
        t.id_clinica,
        t.id_super_clinica
      FROM tratamientos t
      WHERE t.id_clinica = ? 
        AND t.id_super_clinica = ?
        AND t.id_estado_registro = 1
        AND t.nombre_tratamiento LIKE ?
      ORDER BY t.nombre_tratamiento ASC
    `;
    return await ejecutarConReintento<TratamientoDTO>(query, [id_clinica, id_super_clinica, `%${nombre}%`]);
  }

  /**
   * Busca tratamientos por un array de nombres, devolviendo relevancia y coincidencia exacta.
   */
  async findTreatmentsByNamesWithRelevance(
    nombres: string[],
    id_clinica: number
  ): Promise<TratamientoSearchResultDTO[]> {
    const searchTerms = nombres.join(" ");
    const exactMarkers = nombres.map(() => "LOWER(TRIM(?))").join(", ");

    const query = `
      SELECT DISTINCT
        t.id_tratamiento,
        t.nombre_tratamiento,
        t.descripcion,
        t.duracion,
        t.precio,
        t.id_estado_registro,
        t.id_clinica,
        t.id_super_clinica,
        MATCH(t.nombre_tratamiento, t.descripcion) AGAINST(?) AS relevance,
        (CASE
          WHEN LOWER(TRIM(t.nombre_tratamiento)) IN (${exactMarkers}) THEN 1
          ELSE 0
        END) AS is_exact
      FROM tratamientos t
      WHERE t.id_clinica = ?
        AND t.id_estado_registro = 1
        AND MATCH(t.nombre_tratamiento, t.descripcion) AGAINST(?)
      ORDER BY is_exact DESC, relevance DESC, t.nombre_tratamiento ASC
    `;

    const params = [
      searchTerms,
      ...nombres.map((n) => n.toLowerCase().trim()),
      id_clinica,
      searchTerms,
    ];

    return await ejecutarConReintento<TratamientoSearchResultDTO>(query, params);
  }
}
