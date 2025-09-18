// packages/core/src/infrastructure/medico/MedicoRepositoryMySQL.ts

import { ejecutarConReintento, ejecutarUnicoResultado } from "@clinickeys-agents/core/infrastructure/helpers";
import { MedicoDTO, MedicoWithFullNameDTO } from "@clinickeys-agents/core/domain/medico/dtos";
import { IMedicoRepository } from "@clinickeys-agents/core/domain/medico/IMedicoRepository";

export class MedicoRepositoryMySQL implements IMedicoRepository {
  /**
   * Obtiene todos los médicos activos de una clínica y super clínica.
   */
  async getMedicos(id_clinica: number, id_super_clinica: number): Promise<MedicoWithFullNameDTO[]> {
    const query = `
      SELECT 
        m.id_medico,
        CONCAT(TRIM(m.nombre_medico), ' ', TRIM(m.apellido_medico)) AS nombre_completo
      FROM medicos m
      WHERE m.id_clinica = ? 
        AND m.id_super_clinica = ?
        AND m.id_estado_registro = 1
      ORDER BY nombre_completo ASC
    `;
    const rows = await ejecutarConReintento<MedicoWithFullNameDTO>(query, [id_clinica, id_super_clinica]);
    return rows;
  }

  /**
   * Obtiene los médicos activos asociados a un tratamiento específico.
   */
  async getMedicosByTratamiento(id_tratamiento: number, id_clinica: number): Promise<MedicoWithFullNameDTO[]> {
    const query = `
      SELECT 
        m.id_medico,
        CONCAT(TRIM(m.nombre_medico), ' ', TRIM(m.apellido_medico)) AS nombre_completo
      FROM medicos m
      INNER JOIN medico_tratamiento mt ON mt.id_medico = m.id_medico
      WHERE mt.id_tratamiento = ?
        AND m.id_clinica = ?
        AND m.id_estado_registro = 1
    `;
    const rows = await ejecutarConReintento<MedicoWithFullNameDTO>(query, [id_tratamiento, id_clinica]);
    return rows;
  }

  /**
   * Obtiene IDs de médicos en una clínica por una lista de nombres completos normalizados.
   */
  async getIdsMedicosPorNombre(
    nombresSolicitados: string[],
    id_clinica: number
  ): Promise<{ id_medico: number; nombre_medico: string }[]> {
    if (!Array.isArray(nombresSolicitados) || nombresSolicitados.length === 0) return [];

    const nombresNormalizados = nombresSolicitados.map((str) =>
      str.toLowerCase().trim().replace(/\s+/g, " ")
    );
    const marcadores = nombresNormalizados.map(() => "?").join(", ");

    const query = `
      SELECT
        id_medico,
        LOWER(TRIM(CONCAT(nombre_medico, ' ', apellido_medico))) AS nombre_medico
      FROM medicos
      WHERE id_clinica = ?
        AND LOWER(TRIM(CONCAT(nombre_medico, ' ', apellido_medico))) IN (${marcadores})
    `;

    const params = [id_clinica, ...nombresNormalizados];
    const rows = await ejecutarConReintento<{ id_medico: number; nombre_medico: string }>(query, params);
    return rows;
  }

  /**
   * Busca un médico por ID.
   */
  async findById(id_medico: number): Promise<MedicoDTO | undefined> {
    const query = `
      SELECT 
        id_medico,
        nombre_medico,
        apellido_medico,
        numero_colegiado,
        id_super_clinica,
        id_clinica,
        id_especialidad,
        id_usuario,
        id_estado_registro,
        old_id,
        fecha_migracion,
        detalles_migracion
      FROM medicos
      WHERE id_medico = ?
      LIMIT 1
    `;
    const row = await ejecutarUnicoResultado<MedicoDTO>(query, [id_medico]);
    return row || undefined;
  }
}
