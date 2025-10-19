// packages/core/src/infrastructure/patient/PatientRepositoryMySQL.ts

import { PatientDTO, IPatientRepository } from "@clinickeys-agents/core/domain/patient";
import { ejecutarUnicoResultado, ejecutarExecConReintento, ejecutarTodosLosResultados } from "@clinickeys-agents/core/infrastructure/helpers";

interface PatientRow {
  id_paciente: number;
  nombre: string;
  apellido: string;
  email?: string | null;
  telefono: string;
  fecha_nacimiento?: string | null;
  id_sexo?: number | null;
  direccion?: string | null;
  ciudad?: string | null;
  id_clinica?: number | null;
  codigo_postal?: string | null;
  nif_cif?: string | null;
  referido?: string | null;
  observaciones?: string | null;
  id_super_clinica: number;
  id_estado_registro?: number | null;
  id_cliente?: number | null;
  lopd_aceptado: number;
  kommo_lead_id?: string | null;
  old_id?: number | null;
  fecha_alta?: string | null;
  fecha_creacion?: string | null;
  fecha_modificacion?: string | null;
  usuario_creacion?: string | null;
  id_usuario_creacion?: number | null;
}

/**
 * Implementación MySQL del repositorio de pacientes.
 */
export class PatientRepositoryMySQL implements IPatientRepository {
  /**
   * Actualiza el campo kommoLeadId de un paciente específico.
   */
  async updateKommoLeadId(patientId: number, kommoLeadId: string): Promise<void> {
    await ejecutarExecConReintento(
      "UPDATE pacientes SET kommo_lead_id = ? WHERE id_paciente = ?",
      [kommoLeadId, patientId]
    );
  }

  /**
   * Obtiene el kommoLeadId guardado en BD de un paciente específico.
   */
  async getKommoLeadId(patientId: number): Promise<string | undefined> {
    const row = await ejecutarUnicoResultado(
      "SELECT kommo_lead_id AS kommoLeadId FROM pacientes WHERE id_paciente = ?",
      [patientId]
    );
    return row?.kommoLeadId;
  }

  /**
   * Crea un nuevo paciente y retorna el id insertado.
   */
  async createPatient(params: {
    nombre: string;
    apellido: string;
    telefono: string;
    id_clinica: number;
    id_super_clinica: number;
    kommo_lead_id?: number;
  }): Promise<number> {
    const query = `
      INSERT INTO pacientes 
        (nombre, apellido, telefono, id_clinica, codigo_postal, nif_cif, id_super_clinica, id_estado_registro, lopd_aceptado, kommo_lead_id, old_id, usuario_creacion)
      VALUES (?, ?, ?, ?, 0, 0, ?, 1, 1, ?, 0, ?)
    `;
    const paramsArr = [
      params.nombre,
      params.apellido,
      params.telefono,
      params.id_clinica,
      params.id_super_clinica,
      params.kommo_lead_id || null,
      "CHATBOT"
    ];
    const result: any = await ejecutarExecConReintento(query, paramsArr);
    return result.insertId || result[0]?.insertId;
  }

  /**
   * Busca paciente por ID. Devuelve el registro completo como PatientDTO o undefined.
   */
  async findById(patientId: number): Promise<PatientDTO | undefined> {
    const row = await ejecutarUnicoResultado(
      "SELECT * FROM pacientes WHERE id_paciente = ?",
      [patientId]
    );
    if (!row) return undefined;
    return this.mapRowToPatientDTO(row as PatientRow);
  }

  /**
   * Busca todos los pacientes por teléfono nacional (solo dígitos), clínica y estado activo.
   * Devuelve PatientDTO[].
   */
  async findByNationalPhoneAndClinic(telefonoNacional: string, id_clinica: number): Promise<PatientDTO[]> {
    const rows = await ejecutarTodosLosResultados(
      `SELECT id_paciente, nombre, apellido, telefono, id_clinica, nif_cif, id_super_clinica, id_cliente, kommo_lead_id
       FROM pacientes
       WHERE REGEXP_REPLACE(telefono, '[^0-9]', '') LIKE CONCAT('%', ?, '%')
         AND id_clinica = ?
         AND id_estado_registro IN (1, 2)`,
      [telefonoNacional, id_clinica]
    );
    if (!rows || !rows.length) return [];
    return rows.map((row: PatientRow) => ({
      id_paciente: row.id_paciente,
      nombre: row.nombre,
      apellido: row.apellido,
      telefono: row.telefono,
      id_clinica: row.id_clinica,
      id_super_clinica: row.id_super_clinica,
      kommo_lead_id: row.kommo_lead_id,
    } as PatientDTO));
  }

  /**
   * Convierte un row de la BD a PatientDTO.
   */
  private mapRowToPatientDTO(row: PatientRow): PatientDTO {
    return {
      id_paciente: row.id_paciente,
      nombre: row.nombre,
      apellido: row.apellido,
      email: row.email,
      telefono: row.telefono,
      fecha_nacimiento: row.fecha_nacimiento,
      id_sexo: row.id_sexo,
      direccion: row.direccion,
      ciudad: row.ciudad,
      id_clinica: row.id_clinica,
      codigo_postal: row.codigo_postal,
      nif_cif: row.nif_cif,
      referido: row.referido,
      observaciones: row.observaciones,
      id_super_clinica: row.id_super_clinica,
      id_estado_registro: row.id_estado_registro,
      id_cliente: row.id_cliente,
      lopd_aceptado: !!row.lopd_aceptado,
      kommo_lead_id: row.kommo_lead_id,
      old_id: row.old_id,
      fecha_alta: row.fecha_alta,
      fecha_creacion: row.fecha_creacion,
      fecha_modificacion: row.fecha_modificacion,
      usuario_creacion: row.usuario_creacion,
      id_usuario_creacion: row.id_usuario_creacion,
    };
  }
}
