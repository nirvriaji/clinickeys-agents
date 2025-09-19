// packages/core/src/application/usecases/FetchPatientInfoUseCase.ts

import { CHAT_BOT_CUSTOM_FIELDS, PATIENT_PHONE } from '@clinickeys-agents/core/utils';
import { PatientService } from '@clinickeys-agents/core/application/services';
import { PackBonoConUsoDTO } from '@clinickeys-agents/core/domain/packBono';
import { AppointmentDTO } from '@clinickeys-agents/core/domain/appointment';
import { PresupuestoDTO } from '@clinickeys-agents/core/domain/presupuesto';
import { AvailabilityError } from '@clinickeys-agents/core/domain/errors';
import { BotConfigType } from '@clinickeys-agents/core/domain/botConfig';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { PatientDTO } from '@clinickeys-agents/core/domain/patient';
import { FetchKommoDataUseCase } from './FetchKommoDataUseCase';
import { DateTime } from 'luxon';

export interface FetchPatientInfoInput {
  botConfigType: BotConfigType;
  botConfigId: string;
  clinicSource: string;
  clinicId: number;
  leadId: number;
  tiempoActualDT: DateTime;
}

export interface FetchPatientInfoOutput {
  patients: Array<{
    patient: PatientDTO;
    appointments: AppointmentDTO[];
    packsBonos: PackBonoConUsoDTO[];
    budgets: PresupuestoDTO[];
  }>;
}

export type PatientFullInfo = {
  paciente: PatientDTO;
  citas: AppointmentDTO[];
  packsBonos: PackBonoConUsoDTO[];
  presupuestos: PresupuestoDTO[];
};

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
      normalizedLeadCFSample: kommoData.normalizedLeadCF
        ?.filter(cf => CHAT_BOT_CUSTOM_FIELDS.includes(cf.field_name))
        .map(cf => ({ name: cf.field_name, value: cf.value })) || [],
    });

    const leadPhones = this.prepareLeadPhones(kommoData);
    Logger.debug('[FetchPatientInfo] leadPhones preparado', { leadPhones });

    Logger.debug('[FetchPatientInfo] Obteniendo información del paciente desde PatientService');
    const patientInfo = await this.patientService.getPatientInfo(
      tiempoActualDT,
      kommoData.botConfig.clinicId,
      leadPhones
    );

    if (!patientInfo || !patientInfo.patients?.length) {
      Logger.error('[FetchPatientInfo] No se encontró información del paciente', { leadId });
      throw new AvailabilityError({
        code: 'ERR_PATIENT_INFO_NOT_FOUND',
        humanMessage: 'Patient info not found for this lead/contact.',
        context: { botConfigId, clinicSource, clinicId, leadId }
      });
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

    return { patients: outputPatients };
  }

  private prepareLeadPhones(kommoData: any) {
    const contactPhone = kommoData.normalizedContactCF?.find((cf: { field_code: string; values: Array<{ value: string }> }) => cf.field_code === 'PHONE')?.values?.[0]?.value || '';
    const leadCFPhone = kommoData.normalizedLeadCF?.find((cf: { field_name: string; value: string }) => cf.field_name === PATIENT_PHONE)?.value || '';
    return {
      in_conversation: '',
      in_field: leadCFPhone,
      in_contact: contactPhone
    };
  }

  private async syncKommoLeadId(patients: PatientFullInfo[], newLeadId: string) {
    for (const patient of patients) {
      if (patient.paciente?.id_paciente) {
        const patientId = patient.paciente.id_paciente;
        const oldLeadId = patient.paciente.kommo_lead_id;
        if (oldLeadId !== newLeadId) {
          Logger.debug('[FetchPatientInfo] Actualizando kommo_lead_id en BD', {
            patientId,
            oldLeadId,
            newLeadId,
          });
          await this.patientService.updateKommoLeadId(patientId, newLeadId);
          patient.paciente.kommo_lead_id = newLeadId;
        }
      }
    }
  }
}