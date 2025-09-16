import { BotConfigType } from '@clinickeys-agents/core/domain/botConfig';
import { FetchPatientInfoUseCase } from './FetchPatientInfoUseCase';
import { AppError } from '@clinickeys-agents/core/utils';

export interface ProcessLeadInput {
  event: any;
  pathParams: {
    botConfigType: BotConfigType;
    botConfigId: string;
    clinicSource: string;
    clinicId: string;
  };
  tiempoActualDT: any;
}

export interface ProcessLeadOutput {
  leadId: number;
  pathParams: {
    botConfigType: BotConfigType;
    botConfigId: string;
    clinicSource: string;
    clinicId: string;
  };
  patients: Array<{
    paciente: any;
    appointments: any[];
    packsBonos: any[];
    budgets: any[];
  }>;
}

export class ProcessLeadUseCase {
  private fetchPatientInfoUseCase: FetchPatientInfoUseCase;

  constructor(fetchPatientInfoUseCase: FetchPatientInfoUseCase) {
    this.fetchPatientInfoUseCase = fetchPatientInfoUseCase;
  }

  async execute(input: ProcessLeadInput): Promise<ProcessLeadOutput> {
    const { event, pathParams, tiempoActualDT } = input;
    const body = event.body;

    if (
      !body ||
      !body.leads ||
      !body.leads.add ||
      !Array.isArray(body.leads.add) ||
      !body.leads.add.length
    ) {
      throw new AppError({
        code: 'ERR_INVALID_WEBHOOK_EVENT',
        humanMessage: 'Invalid webhook event: missing leads info',
        context: { body }
      });
    }

    const { botConfigType, botConfigId, clinicSource, clinicId } = pathParams;
    const leadId = body.leads.add[0].id;

    const patientInfo = await this.fetchPatientInfoUseCase.execute({
      botConfigType,
      botConfigId,
      clinicSource,
      clinicId: Number(clinicId),
      leadId,
      tiempoActualDT
    });

    return {
      leadId,
      pathParams: { botConfigType, botConfigId, clinicSource, clinicId },
      patients: patientInfo.patients
    };
  }
}
