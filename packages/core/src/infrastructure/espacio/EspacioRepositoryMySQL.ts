// packages/core/src/infrastructure/espacio/EspacioRepositoryMySQL.ts

import { ejecutarConReintento, ejecutarUnicoResultado } from "@clinickeys-agents/core/infrastructure/helpers";
import { EspacioDTO } from "@clinickeys-agents/core/domain/espacio";

export class EspacioRepositoryMySQL {
  /**
   * Obtiene un espacio por su ID.
   */
  async findById(id_espacio: number): Promise<EspacioDTO | undefined> {
    const query = `
      SELECT id_espacio, id_clinica, nombre AS nombre_espacio
      FROM espacios
      WHERE id_espacio = ?
      LIMIT 1
    `;
    const row = await ejecutarUnicoResultado<EspacioDTO>(query, [id_espacio]);
    return row as EspacioDTO | undefined;
  }

  /**
   * Obtiene todos los espacios de una clínica.
   */
  async findByClinica(id_clinica: number): Promise<EspacioDTO[]> {
    const query = `
      SELECT id_espacio, id_clinica, nombre AS nombre_espacio
      FROM espacios
      WHERE id_clinica = ?
    `;
    const rows = await ejecutarConReintento<EspacioDTO>(query, [id_clinica]);
    return rows as EspacioDTO[];
  }

  /**
   * Obtiene todos los espacios donde un médico puede realizar un tratamiento específico en una clínica.
   * Se asume la relación: medico_espacio y espacios_tratamientos.
   */
  async getEspaciosByMedicoAndTratamiento(
    id_medico: number,
    id_tratamiento: number,
    id_clinica: number
  ): Promise<EspacioDTO[]> {
    const query = `
      SELECT e.id_espacio, e.id_clinica, e.nombre AS nombre_espacio
      FROM espacios e
      INNER JOIN medico_espacio me ON me.id_espacio = e.id_espacio
      INNER JOIN espacios_tratamientos et ON et.id_espacio = e.id_espacio
      WHERE me.id_medico = ?
        AND et.id_tratamiento = ?
        AND e.id_clinica = ?
    `;
    const rows = await ejecutarConReintento<EspacioDTO>(query, [id_medico, id_tratamiento, id_clinica]);
    return rows as EspacioDTO[];
  }
}
