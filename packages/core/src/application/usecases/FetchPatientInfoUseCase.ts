// packages/core/src/application/usecases/FetchPatientInfoUseCase.ts

import { AppError, CHAT_BOT_CUSTOM_FIELDS, PATIENT_PHONE } from '@clinickeys-agents/core/utils';
import { PatientService } from '@clinickeys-agents/core/application/services';
import { BotConfigType } from '@clinickeys-agents/core/domain/botConfig';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { FetchKommoDataUseCase } from './FetchKommoDataUseCase';

export interface FetchPatientInfoInput {
  botConfigType: BotConfigType;
  botConfigId: string;
  clinicSource: string;
  clinicId: number;
  leadId: number;
  tiempoActualDT: any;
}

export interface FetchPatientInfoOutput {
  patients: Array<{
    paciente: any;
    appointments: any[];
    packsBonos: any[];
    budgets: any[];
  }>;
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
    const { botConfigType, botConfigId, clinicSource, clinicId, leadId, tiempoActualDT } = input;
    Logger.info('[FetchPatientInfo] Inicio', { botConfigType, botConfigId, clinicSource, clinicId, leadId });

    Logger.debug('[FetchPatientInfo] Obteniendo datos de Kommo');
    const kommoData = await this.fetchKommoDataUseCase.execute({
      botConfigType,
      botConfigId,
      clinicSource,
      clinicId,
      leadId
    });
    Logger.debug('[FetchPatientInfo] Datos de Kommo obtenidos', {
      contactId: kommoData.contactId,
      normalizedLeadCFCount: kommoData.normalizedLeadCF?.length,
      normalizedContactCFCount: kommoData.normalizedContactCF?.length,
      normalizedLeadCFSample: kommoData.normalizedLeadCF?.filter(cf => CHAT_BOT_CUSTOM_FIELDS.includes(cf.field_name)).map(cf => ({ name: cf.field_name, value: cf.value })) || [],
    });

    Logger.debug('[FetchPatientInfo] Preparando objeto leadPhones');
    const contactPhone = kommoData.normalizedContactCF?.find((cf: any) => cf.field_code === 'PHONE')?.values?.[0]?.value || '';
    const leadCFPhone = kommoData.normalizedLeadCF?.find((cf) => cf.field_name == PATIENT_PHONE)?.value || '';
    const leadPhones = {
      in_conversation: '',
      in_field: leadCFPhone,
      in_contact: contactPhone
    };
    Logger.debug('[FetchPatientInfo] leadPhones preparado', { leadPhones });

    Logger.debug('[FetchPatientInfo] Obteniendo información del paciente desde PatientService');
    const patientInfo = await this.patientService.getPatientInfo(
      tiempoActualDT,
      kommoData.botConfig.clinicId,
      leadPhones
    );

    if (!patientInfo || !patientInfo.patients?.length) {
      Logger.error('[FetchPatientInfo] No se encontró información del paciente', { leadId });
      throw new AppError({
        code: 'ERR_PATIENT_INFO_NOT_FOUND',
        humanMessage: 'Patient info not found for this lead/contact.',
        context: { botConfigId, clinicSource, clinicId, leadId }
      });
    }

    for (const patient of patientInfo.patients) {
      if (patient.paciente?.id_paciente) {
        const patientId = patient.paciente.id_paciente;
        const oldLeadId = patient.paciente.kommo_lead_id;
        if (oldLeadId !== kommoData.leadData.id) {
          Logger.debug('[FetchPatientInfo] Actualizando kommo_lead_id en BD', {
            patientId,
            oldLeadId,
            newLeadId: kommoData.leadData.id,
          });
          await this.patientService.updateKommoLeadId(patientId, kommoData.leadData.id);
          patient.paciente.kommo_lead_id = kommoData.leadData.id;
        }
      }
    }

    Logger.info('[FetchPatientInfo] Información de pacientes obtenida con éxito', {
      totalPatients: patientInfo.patients.length
    });

    const outputPatients = patientInfo.patients.map((p: any) => ({
      paciente: p.paciente,
      appointments: p.citas,
      packsBonos: p.packsBonos,
      budgets: p.presupuestos
    }));

    return { patients: outputPatients };
  }
}