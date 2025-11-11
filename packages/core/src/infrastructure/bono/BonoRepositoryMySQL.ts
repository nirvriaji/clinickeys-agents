import { IBonoRepository, BonoSesionDetalleDTO } from "@clinickeys-agents/core/domain/bono";
import { ejecutarConReintento, ejecutarExecConReintento } from "@clinickeys-agents/core/infrastructure/helpers";

export class BonoRepositoryMySQL implements IBonoRepository {
  async getBonosSesionesDetallesByPacienteId(id_paciente: number): Promise<BonoSesionDetalleDTO[]> {
    const query = `
      SELECT 
        bp.id_bono_paciente,
        bp.id_paciente,
        bp.id_clinica,
        bp.nombre_bono,
        bp.descripcion,
        bp.monto_total,
        bp.monto_pagado,
        bp.saldo_pendiente,
        bp.sesiones_total,
        bp.sesiones_usado,
        bp.sesiones_pendiente,
        dbp.id_detalle_bono_paciente,
        dbp.id_tratamiento,
        dbp.id_producto,
        dbp.item,
        dbp.descripcion AS descripcion,
        dbp.cantidad,
        dbp.precio,
        dbp.total_item
      FROM bonos_pacientes bp
      INNER JOIN detalle_bono_paciente dbp 
        ON bp.id_bono_paciente = dbp.id_bono_paciente
      WHERE bp.id_paciente = ? 
        AND bp.id_estado_registro = 1
      ORDER BY bp.id_bono_paciente, dbp.item
    `;
    return ejecutarConReintento(query, [id_paciente]);
  }

  async getRecibosByPacienteId(id_paciente: number): Promise<any[]> {
    const query = `
      SELECT 
        id_recibo,
        id_bono_paciente,
        id_paciente,
        id_clinica,
        monto_total,
        fecha_recibo
      FROM recibos
      WHERE id_paciente = ? 
        AND id_bono_paciente IS NOT NULL
    `;
    return ejecutarConReintento(query, [id_paciente]);
  }

  async getDetalleRecibosByPacienteId(id_paciente: number): Promise<any[]> {
    const query = `
      SELECT 
        dr.id_detalle_recibo,
        r.id_recibo,
        r.id_bono_paciente,
        dr.item,
        dr.id_tratamiento,
        dr.id_producto,
        dr.cantidad,
        dr.precio,
        dr.total_item
      FROM detalle_recibo dr
      INNER JOIN recibos r ON dr.id_recibo = r.id_recibo
      WHERE r.id_paciente = ? 
        AND r.id_bono_paciente IS NOT NULL
    `;
    return ejecutarConReintento(query, [id_paciente]);
  }

  async procesarBonoPresupuestoDeCita(p_action: string, p_id_cita: number): Promise<any> {
    const query = "CALL sp_procesar_cita_packbono_y_presupuesto_V2(?, ?)";
    return ejecutarExecConReintento(query, [p_action, p_id_cita]);
  }
}