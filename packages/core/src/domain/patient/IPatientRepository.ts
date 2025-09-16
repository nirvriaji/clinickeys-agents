// @clinickeys-agents/core/src/domain/patient/IPatientRepository.ts

import { PatientDTO } from "@clinickeys-agents/core/domain/patient";

export interface IPatientRepository {
  /**
   * Actualiza el kommoLeadId de un paciente.
   */
  updateKommoLeadId(patientId: number, kommoLeadId: number): Promise<void>;

  /**
   * Obtiene el kommoLeadId de un paciente.
   */
  getKommoLeadId(patientId: number): Promise<string | undefined>;

  /**
   * Crea un paciente y retorna el id insertado.
   */
  createPatient(params: {
    nombre: string;
    apellido: string;
    telefono: string;
    id_clinica: number;
    id_super_clinica: number;
    kommo_lead_id?: number;
  }): Promise<number>;

  /**
   * Busca paciente por teléfono. Devuelve PatientDTO o undefined.
   */
  findByPhone(telefono: string): Promise<PatientDTO | undefined>;

  /**
   * Busca paciente por ID. Devuelve PatientDTO o undefined.
   */
  findById(patientId: number): Promise<PatientDTO | undefined>;

  /**
   * Busca paciente por número nacional, clínica y solo activos. Devuelve PatientDTO o undefined.
   */
  findByNationalPhoneAndClinic(telefonoNacional: string, id_clinica: number): Promise<PatientDTO[]>;

  updateKommoLeadId(patientId: number, kommoLeadId: number): Promise<void>;
}
