// packages/core/src/infrastructure/presupuesto/PresupuestoRepositoryMySQL.ts

import { IPresupuestoRepository, PresupuestoDTO, CreatePresupuestoParams } from "@clinickeys-agents/core/domain/presupuesto";
import { ejecutarConReintento, ejecutarUnicoResultado, ejecutarExecConReintento } from "@clinickeys-agents/core/infrastructure/helpers";

export class PresupuestoRepositoryMySQL implements IPresupuestoRepository {
  /**
   * Obtiene todos los presupuestos pendientes de un paciente en una clínica.
   */
  async getPresupuestosByPacienteId(id_paciente: number, id_clinica: number): Promise<PresupuestoDTO[]> {
    const query = `
      SELECT 
        p.id_presupuesto,
        p.fecha,
        p.monto_total,
        p.monto_pagado,
        p.saldo_pendiente,
        p.id_tipo_pago,
        tpp.nombre AS nombre_tipo_pago,
        ep.nombre AS nombre_estado
      FROM presupuestos p
      LEFT JOIN tipo_pago_presupuesto tpp ON p.id_tipo_pago = tpp.id_tipo_pago
      LEFT JOIN estados_presupuestos ep ON p.id_estado = ep.id
      WHERE p.id_paciente = ?
        AND p.id_clinica = ?
        AND p.saldo_pendiente > 0
      ORDER BY p.fecha DESC
    `;
    return await ejecutarConReintento(query, [id_paciente, id_clinica]);
  }

  /**
   * Obtiene un presupuesto por su ID y clínica.
   */
  async getPresupuestoById(id_presupuesto: number, id_clinica: number): Promise<PresupuestoDTO | undefined> {
    const query = `
      SELECT 
        p.id_presupuesto,
        p.fecha,
        p.monto_total,
        p.monto_pagado,
        p.saldo_pendiente,
        p.id_tipo_pago,
        tpp.nombre AS nombre_tipo_pago,
        ep.nombre AS nombre_estado
      FROM presupuestos p
      LEFT JOIN tipo_pago_presupuesto tpp ON p.id_tipo_pago = tpp.id_tipo_pago
      LEFT JOIN estados_presupuestos ep ON p.id_estado = ep.id
      WHERE p.id_presupuesto = ?
        AND p.id_clinica = ?
      LIMIT 1
    `;
    const row = await ejecutarUnicoResultado(query, [id_presupuesto, id_clinica]);
    return row || undefined;
  }

  /**
   * Crea un presupuesto nuevo.
   */
  async createPresupuesto(params: CreatePresupuestoParams): Promise<number> {
    const query = `
      INSERT INTO presupuestos (
        id_paciente, id_clinica, fecha, monto_total, monto_pagado, saldo_pendiente, id_tipo_pago, id_estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result: any = await ejecutarExecConReintento(query, [
      params.id_paciente,
      params.id_clinica,
      params.fecha,
      params.monto_total,
      params.monto_pagado,
      params.saldo_pendiente,
      params.id_tipo_pago,
      params.id_estado
    ]);
    return result.insertId || result[0]?.insertId;
  }
}