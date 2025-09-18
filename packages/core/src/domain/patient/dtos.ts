// packages/core/src/domain/patient/dtos.ts

// DTO to create a new patient
export class CreatePatientDTO {
  nombre!: string;
  apellido!: string;
  telefono!: string;
  id_clinica!: number;
  id_super_clinica!: number;
  kommo_lead_id?: number;
}

// DTO for updating kommo_lead_id (optional, if needed externally)
export class UpdateKommoLeadIdDTO {
  kommo_lead_id!: string;
}

// DTO for returning patient data (response DTO)
export class PatientDTO {
  id_paciente!: number;
  nombre!: string;
  apellido!: string;
  email?: string | null;
  telefono!: string;
  fecha_nacimiento?: string | null;
  id_sexo?: number | null;
  direccion?: string | null;
  ciudad?: string | null;
  id_clinica?: number | null;
  codigo_postal?: string | null;
  nif_cif?: string | null;
  referido?: string | null;
  observaciones?: string | null;
  id_super_clinica!: number;
  id_estado_registro?: number | null;
  id_cliente?: number | null;
  lopd_aceptado!: boolean;
  kommo_lead_id?: string | null;
  old_id?: number | null;
  fecha_alta?: string | null;
  fecha_creacion?: string | null;
  fecha_modificacion?: string | null;
  usuario_creacion?: string | null;
  id_usuario_creacion?: number | null;
}
