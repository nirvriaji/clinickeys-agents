// packages/core/src/infrastructure/appointment/AppointmentRepositoryMySQL.ts

import {
  ejecutarConReintento,
  ejecutarExecConReintento,
  ejecutarUnicoResultado,
} from "@clinickeys-agents/core/infrastructure/helpers";
import { AppointmentDTO } from "@clinickeys-agents/core/domain/appointment/dtos";
import { UpdateAppointmentInput, IAppointmentRepository } from "@clinickeys-agents/core/domain/appointment";
import { CITAS_ESTADOS_VISIBLES } from "@clinickeys-agents/core/utils";

export class AppointmentRepositoryMySQL implements IAppointmentRepository {
  /**
   * Actualiza una cita existente.
   */
  async updateAppointment(params: UpdateAppointmentInput): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (params.id_medico !== undefined) {
      updates.push("id_medico = ?");
      values.push(params.id_medico);
    }
    if (params.fecha_cita !== undefined) {
      updates.push("fecha_cita = ?");
      values.push(params.fecha_cita);
    }
    if (params.hora_inicio !== undefined) {
      updates.push("hora_inicio = ?");
      values.push(params.hora_inicio);
    }
    if (params.hora_fin !== undefined) {
      updates.push("hora_fin = ?");
      values.push(params.hora_fin);
    }
    if (params.id_espacio !== undefined) {
      updates.push("id_espacio = ?");
      values.push(params.id_espacio);
    }
    if (params.id_estado_cita !== undefined) {
      updates.push("id_estado_cita = ?");
      values.push(params.id_estado_cita);
    }
    if (params.comentario_ia !== undefined) {
      updates.push("comentario_ia = ?");
      values.push(params.comentario_ia);
    }
    if (params.id_estados_cita_in !== undefined) {
      updates.push("id_estados_cita_in = ?");
      values.push(params.id_estados_cita_in);
    }

    if (updates.length === 0) return;

    const query = `
      UPDATE citas
      SET ${updates.join(", ")}
      WHERE id_cita = ?
    `;
    values.push(params.id_cita);

    await ejecutarExecConReintento(query, values);
  }

  /**
   * Obtiene las citas de un paciente por clínica.
   */
  async getAppointmentsByPatient(
    patientId: number,
    clinicId: number
  ): Promise<AppointmentDTO[]> {
    const DAYS_LIMIT = 400; // Número de días hacia atrás para filtrar citas
    const query = `
      SELECT
        citas.id_cita,
        citas.id_paciente,
        citas.id_medico,
        citas.id_super_clinica,
        citas.id_clinica,
        citas.id_tratamiento,
        citas.id_espacio,
        citas.fecha_cita,
        citas.hora_inicio,
        citas.hora_fin,
        citas.id_presupuesto,
        citas.id_bono_paciente,
        citas.item_bono_paciente,
        citas.comentario_ia,
        espacios.nombre AS nombre_espacio,
        tratamientos.nombre_tratamiento,
        CONCAT(TRIM(medicos.nombre_medico), ' ', TRIM(medicos.apellido_medico)) AS nombre_medico,
        estado_cita.descripcion AS estado_cita
      FROM citas
      LEFT JOIN espacios      ON citas.id_espacio      = espacios.id_espacio
      LEFT JOIN tratamientos  ON citas.id_tratamiento  = tratamientos.id_tratamiento
      LEFT JOIN medicos       ON citas.id_medico       = medicos.id_medico
      LEFT JOIN estado_cita   ON citas.id_estado_cita  = estado_cita.id_estado_cita
      WHERE citas.id_paciente = ?
        AND citas.id_clinica  = ?
        AND citas.id_estado_cita IN (${CITAS_ESTADOS_VISIBLES.join(", ")})
        AND citas.fecha_cita >= DATE_SUB(CURDATE(), INTERVAL ${DAYS_LIMIT} DAY)
      ORDER BY citas.fecha_cita ASC, citas.hora_inicio ASC;
    `;

    return await ejecutarConReintento(query, [patientId, clinicId]);
  }

  /**
   * Obtiene una cita por su ID.
   */
  async findAppointmentById(id_cita: number): Promise<AppointmentDTO | undefined> {
    const query = `
      SELECT 
        id_cita, id_paciente, id_medico, id_super_clinica, id_clinica,
        id_tratamiento, id_espacio, fecha_cita, hora_inicio, hora_fin,
        id_presupuesto, id_bono_paciente, item_bono_paciente, comentario_ia
      FROM citas WHERE id_cita = ?
    `;
    const row = await ejecutarUnicoResultado(query, [id_cita]);
    return row || undefined;
  }

  /**
   * Inserta una cita asociada a un pack bono, usando el stored procedure.
   */
  async insertarCitaConComentario(params: {
    p_id_paciente: number;
    p_id_medico: number;
    p_id_espacio: number;
    p_id_tratamiento: number;
    p_fecha_cita: string;
    p_hora_inicio: string;
    p_hora_fin: string;
    p_id_clinica: number;
    p_id_super_clinica: number;
    p_id_presupuesto: number | null;
    p_comentario_ia: string;
    p_id_bono_paciente: number | null;
    p_item_bono_paciente: number | null;
  }): Promise<any> {
    const query =
      "CALL sp_crear_cita_con_comentario_V3(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    const values = [
      params.p_id_paciente,
      params.p_id_medico,
      params.p_id_espacio,
      params.p_id_tratamiento,
      params.p_fecha_cita,
      params.p_hora_inicio,
      params.p_hora_fin,
      params.p_id_clinica,
      params.p_id_super_clinica,
      params.p_id_presupuesto, // <- primero presupuesto
      params.p_comentario_ia, // <- luego comentario
      null, // <- p_id_pack_bono (legacy)
      params.p_id_bono_paciente,
      params.p_item_bono_paciente,
    ];
    return await ejecutarExecConReintento(query, values);
  }
}