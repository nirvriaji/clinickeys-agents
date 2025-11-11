// packages/core/src/application/usecases/FetchPatientInfoUseCase.ts

import { CHAT_BOT_CUSTOM_FIELDS, PATIENT_PHONE } from '@clinickeys-agents/core/utils';
import { PatientService } from '@clinickeys-agents/core/application/services';
import { BonoConUsoDTO } from '@clinickeys-agents/core/domain/bono';
import { AppointmentDTO } from '@clinickeys-agents/core/domain/appointment';
import { PresupuestoDTO } from '@clinickeys-agents/core/domain/presupuesto';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { PatientDTO } from '@clinickeys-agents/core/domain/patient';
import { FetchKommoDataUseCase } from './FetchKommoDataUseCase';
import { DateTime } from 'luxon';
import { PhoneNumber } from '@clinickeys-agents/core/domain/common';

export interface FetchPatientInfoInput {
  botConfig: BotConfigDTO;
  leadId: number;
  tiempoActualDT: DateTime;
}

export interface FetchPatientInfoOutput {
  patients: Array<{
    patient: PatientDTO;
    appointments: AppointmentDTO[];
    packsBonos: BonoConUsoDTO[];
    budgets: PresupuestoDTO[];
  }>;
  /**
   * Teléfono principal del interlocutor (contacto base) ya normalizado
   * y listo para inyección en el contexto como TELEFONO_INTERLOCUTOR.
   */
  interlocutorPhone: string;
  /**
   * Conjunto de teléfonos detectados en las fuentes conocidas para este lead/contact.
   * Se incluye para que capas superiores puedan construir TELEFONOS_VINCULADOS_AL_INTERLOCUTOR
   * de manera vendor‑neutral.
   */
  phones: LeadPhones;
}

export type PatientFullInfo = {
  paciente: PatientDTO;
  citas: AppointmentDTO[];
  packsBonos: BonoConUsoDTO[];
  presupuestos: PresupuestoDTO[];
};

/**
 * Teléfonos asociados al lead/contact en distintas fuentes.
 * - in_contact_cf: Teléfono del contacto (CONTACT PHONE). Suele ser el "principal" del interlocutor.
 * - in_lead_cf: Teléfono adicional capturado para el lead (por ejemplo, de terceros gestionados).
 * - in_conversation: Se completa río abajo (PatientService) con números aportados textual/temporalmente durante la conversación cuando aplique.
 */
export interface LeadPhones {
  in_conversation: string; // libre / se completa en PatientService cuando corresponda
  in_lead_cf: string; // del CF de lead
  in_contact_cf: string; // del CF de contacto (PHONE)
}

export class FetchPatientInfoUseCase {
  private fetchKommoDataUseCase: FetchKommoDataUseCase;
  private patientService: PatientService;

  constructor(
    fetchKommoDataUseCase: FetchKommoDataUseCase,
    patientService: PatientService
  ) {
    this.fetchKommoDataUseCase = fetchKommoDataUseCase;
    this.patientService = patientService;
  }

  async execute(input: FetchPatientInfoInput): Promise<FetchPatientInfoOutput> {
    const { botConfig, leadId, tiempoActualDT } = input;
    Logger.info('[FetchPatientInfo] Inicio', { hasBotConfig: !!botConfig.botConfigId, leadId });

    Logger.debug('[FetchPatientInfo] Obteniendo datos de Kommo');
    const kommoData = await this.fetchKommoDataUseCase.execute({
      botConfig,
      leadId
    });

    // Valores por defecto (defensivos)
    let interlocutorPhone = '';
    let phones: LeadPhones = { in_conversation: '', in_lead_cf: '', in_contact_cf: '' };

    if (!kommoData) {
      Logger.warn('[FetchPatientInfo] No se pudo obtener datos de Kommo', { leadId });
      return { patients: [], interlocutorPhone, phones };
    }

    Logger.debug('[FetchPatientInfo] Datos de Kommo obtenidos', {
      contactId: kommoData.contactId,
      normalizedLeadCFCount: kommoData.normalizedLeadCF?.length,
      normalizedContactCFCount: kommoData.normalizedContactCF?.length,
      normalizedLeadCFSample: kommoData.normalizedLeadCF
        ?.filter((cf: any) => CHAT_BOT_CUSTOM_FIELDS.includes(cf.field_name as string))
        .map((cf: any) => ({ name: cf.field_name, value: cf.value })) || [],
    });

    phones = this.prepareLeadPhones(kommoData, kommoData.botConfig?.defaultCountry);
    interlocutorPhone = phones.in_contact_cf || '';

    Logger.debug('[FetchPatientInfo] Obteniendo información del paciente desde PatientService');
    const patientInfo = await this.patientService.getPatientInfo(
      tiempoActualDT,
      kommoData.botConfig.clinicId,
      phones
    );

    if (!patientInfo || !patientInfo.patients) {
      Logger.warn('[FetchPatientInfo] No se encontró información del paciente', { leadId });
      return { patients: [], interlocutorPhone, phones };
    }

    if (!patientInfo.patients.length) {
      Logger.warn('[FetchPatientInfo] Pacientes vacío', { leadId });
      return { patients: [], interlocutorPhone, phones };
    }

    await this.syncKommoLeadId(patientInfo.patients, kommoData.leadData.id);

    Logger.info('[FetchPatientInfo] Información de pacientes obtenida con éxito', {
      totalPatients: patientInfo.patients.length
    });

    const outputPatients = patientInfo.patients.map((p: PatientFullInfo) => ({
      patient: p.paciente,
      appointments: p.citas,
      packsBonos: p.packsBonos,
      budgets: p.presupuestos
    }));

    return { patients: outputPatients, interlocutorPhone, phones };
  }

  /**
   * Normaliza los teléfonos provenientes de Kommo (lead/contact) usando el VO PhoneNumber.
   * - Si el número es válido, devolvemos E.164.
   * - Si es inválido, devolvemos digitsOnly (para búsquedas tolerantes).
   */
  private prepareLeadPhones(kommoData: any, defaultCountry?: string): LeadPhones {
    // CONTACT PHONE (field_code === 'PHONE')
    let contactRaw: unknown = '';
    try {
      const cf = Array.isArray(kommoData.normalizedContactCF)
        ? kommoData.normalizedContactCF.find((c: any) => (c?.field_code || '').toString().toUpperCase() === 'PHONE')
        : undefined;
      contactRaw = cf && Array.isArray(cf.values) && cf.values.length > 0 ? cf.values[0]?.value : cf?.value;
    } catch {
      contactRaw = '';
    }

    // LEAD PHONE (field_name === PATIENT_PHONE)
    let leadRaw: unknown = '';
    try {
      const cf = Array.isArray(kommoData.normalizedLeadCF)
        ? kommoData.normalizedLeadCF.find((c: any) => (c?.field_name || '') === PATIENT_PHONE)
        : undefined;
      leadRaw = cf ? cf.value : '';
    } catch {
      leadRaw = '';
    }

    const contactPN = PhoneNumber.fromKommo(contactRaw as any, (defaultCountry || '').toUpperCase());
    const leadPN = PhoneNumber.fromKommo(leadRaw as any, (defaultCountry || '').toUpperCase());

    const in_contact_cf = contactPN.isValid ? contactPN.e164 : contactPN.digitsOnly;
    const in_lead_cf = leadPN.isValid ? leadPN.e164 : leadPN.digitsOnly;

    return {
      in_conversation: '', // Se completa en PatientService a partir del mensaje del usuario cuando aplique
      in_lead_cf,
      in_contact_cf,
    };
  }

  private async syncKommoLeadId(patients: PatientFullInfo[], newLeadId: string) {
    for (const patient of patients) {
      if (patient.paciente && patient.paciente.id_paciente) {
        const patientId = patient.paciente.id_paciente;
        const oldLeadId = patient.paciente.kommo_lead_id as any;
        if (oldLeadId !== newLeadId) {
          Logger.debug('[FetchPatientInfo] Actualizando kommo_lead_id en BD', {
            patientId,
            oldLeadId,
            newLeadId,
          });
          await this.patientService.updateKommoLeadId(patientId, newLeadId);
          (patient.paciente as any).kommo_lead_id = newLeadId;
        }
      }
    }
  }
}