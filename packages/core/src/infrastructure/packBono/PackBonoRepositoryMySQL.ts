// packages/core/src/infrastructure/packBono/PackBonoRepositoryMySQL.ts

import { IPackBonoRepository, PackBonoDTO, PackBonoTratamientoDTO, PackBonoSesionDTO } from "@clinickeys-agents/core/domain/packBono";
import { ejecutarConReintento, ejecutarUnicoResultado, ejecutarExecConReintento } from "@clinickeys-agents/core/infrastructure/helpers";

export class PackBonoRepositoryMySQL implements IPackBonoRepository {
  /**
   * Obtiene todos los packs bono de una clínica.
   */
  async getPackBonosByClinic(id_clinica: number): Promise<PackBonoDTO[]> {
    const query = `
      SELECT id_pack_bono, id_clinica, id_super_clinica, nombre, descripcion, precio
      FROM pack_bonos
      WHERE id_clinica = ?
    `;
    return await ejecutarConReintento(query, [id_clinica]);
  }

  /**
   * Obtiene un pack bono por su ID y clínica.
   */
  async getPackBonoById(id_pack_bono: number, id_clinica: number): Promise<PackBonoDTO | undefined> {
    const query = `
      SELECT id_pack_bono, id_clinica, id_super_clinica, nombre, descripcion, precio
      FROM pack_bonos
      WHERE id_pack_bono = ? AND id_clinica = ?
      LIMIT 1
    `;
    const row = await ejecutarUnicoResultado(query, [id_pack_bono, id_clinica]);
    return row || undefined;
  }

  /**
   * Obtiene todos los tratamientos asociados a un pack bono.
   */
  async getPackBonoTratamientos(id_pack_bono: number): Promise<PackBonoTratamientoDTO[]> {
    const query = `
      SELECT id_pack_bono_tratamientos, id_pack_bono, id_par_tratamiento, id_tratamiento, total_sesiones
      FROM pack_bono_tratamientos
      WHERE id_pack_bono = ?
    `;
    return await ejecutarConReintento(query, [id_pack_bono]);
  }

  /**
   * Obtiene las sesiones de pack bono de un paciente.
   */
  async getPackBonosSesionesByPacienteId(id_paciente: number): Promise<PackBonoSesionDTO[]> {
    const query = `
      SELECT id_pack_bono_sesion, id_pack_bono, id_paciente
      FROM pack_bonos_sesiones
      WHERE id_paciente = ?
    `;
    return await ejecutarConReintento(query, [id_paciente]);
  }

  /**
   * Procesa el pack bono/presupuesto de una cita usando el stored procedure legacy.
   */
  async procesarPackbonoPresupuestoDeCita(p_action: string, p_id_cita: number): Promise<any> {
    const query = 'CALL sp_procesar_cita_packbono_y_presupuesto(?, ?)';
    return await ejecutarExecConReintento(query, [p_action, p_id_cita]);
  }
}