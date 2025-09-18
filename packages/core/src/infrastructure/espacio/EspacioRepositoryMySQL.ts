// packages/core/src/infrastructure/espacio/EspacioRepositoryMySQL.ts

import {
  ejecutarConReintento,
  ejecutarUnicoResultado,
} from "@clinickeys-agents/core/infrastructure/helpers";
import {
  EspacioDTO,
  EspacioBasicDTO,
} from "@clinickeys-agents/core/domain/espacio/dtos";
import { IEspacioRepository } from "@clinickeys-agents/core/domain/espacio/IEspacioRepository";

export class EspacioRepositoryMySQL implements IEspacioRepository {
  /**
   * Obtiene un espacio por su ID.
   */
  async findById(id_espacio: number): Promise<EspacioDTO | undefined> {
    const query = `
      SELECT id_espacio, nombre, descripcion, id_super_clinica, id_clinica, id_estado_registro
      FROM espacios
      WHERE id_espacio = ?
      LIMIT 1
    `;
    const row = await ejecutarUnicoResultado<EspacioDTO>(query, [id_espacio]);
    return row || undefined;
  }

  /**
   * Obtiene todos los espacios de una clínica.
   */
  async findByClinica(id_clinica: number): Promise<EspacioDTO[]> {
    const query = `
      SELECT id_espacio, nombre, descripcion, id_super_clinica, id_clinica, id_estado_registro
      FROM espacios
      WHERE id_clinica = ?
    `;
    const rows = await ejecutarConReintento<EspacioDTO>(query, [id_clinica]);
    return rows;
  }

  /**
   * Obtiene todos los espacios donde un médico puede realizar un tratamiento específico en una clínica.
   */
  async getEspaciosByMedicoAndTratamiento(
    id_medico: number,
    id_tratamiento: number,
    id_clinica: number
  ): Promise<EspacioBasicDTO[]> {
    const query = `
      SELECT e.id_espacio, e.nombre AS nombre
      FROM espacios e
      INNER JOIN medico_espacio me ON me.id_espacio = e.id_espacio
      INNER JOIN espacios_tratamientos et ON et.id_espacio = e.id_espacio
      WHERE me.id_medico = ?
        AND et.id_tratamiento = ?
        AND e.id_clinica = ?
        AND e.id_estado_registro = 1
    `;
    const rows = await ejecutarConReintento<EspacioBasicDTO>(query, [
      id_medico,
      id_tratamiento,
      id_clinica,
    ]);
    return rows;
  }
}
