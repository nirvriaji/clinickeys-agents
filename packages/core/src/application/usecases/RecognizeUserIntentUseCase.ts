// packages/core/src/application/usecases/RecognizeUserIntentUseCase.ts

import { AppError, getActualTimeForPrompts } from '@clinickeys-agents/core/utils';
import { BotConfigType, BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { IOpenAIService } from '@clinickeys-agents/core/domain/openai';
import { FetchPatientInfoUseCase } from './FetchPatientInfoUseCase';
import type { DateTime } from 'luxon';

type KnownIntent =
  | "conversación_regular"
  | "consulta_agendar"
  | "confirmar_cita"
  | "paciente_en_camino"
  | "agendar_cita"
  | "consulta_reprogramar"
  | "reprogramar_cita"
  | "cancelar_cita"
  | "tarea"
  | "identificar_paciente";

export interface RecognizeUserIntentInput {
  botConfigType: BotConfigType;
  botConfigId: string;
  clinicSource: string;
  clinicId: number;
  leadId: number;
  timezone: string;
  tiempoActualDT: DateTime;
  reminderMessage: string;
  userMessage: string;
  openAIService: IOpenAIService;
  speakingBotId: string;
  threadId?: string | null;
  botConfig?: BotConfigDTO;
}

export interface RecognizeUserIntentOutput {
  intent: KnownIntent;
  params: Record<string, unknown>;
  patientInfo: PatientInfo;
  assistantResult: {
    threadId: string;
    runId: string;
    message?: string;
    functionCalls?: Array<{
      tool_call_id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
  };
}

type PatientInfo = Awaited<ReturnType<FetchPatientInfoUseCase['execute']>>;

type IntentContext = {
  MENSAJE: string;
  TIMEZONE_SISTEMA: string;
  TIEMPO_ACTUAL: string;
  PACIENTES_ASOCIADOS_AL_TELEFONO: PatientInfo['patients'];
  CONTEXTO_PLACEHOLDERS: string;
};

export class RecognizeUserIntentUseCase {
  private fetchPatientInfoUseCase: FetchPatientInfoUseCase;

  constructor(fetchPatientInfoUseCase: FetchPatientInfoUseCase) {
    this.fetchPatientInfoUseCase = fetchPatientInfoUseCase;
  }

  async execute(input: RecognizeUserIntentInput): Promise<RecognizeUserIntentOutput> {
    const {
      botConfigType,
      botConfigId,
      clinicSource,
      clinicId,
      leadId,
      timezone,
      tiempoActualDT,
      reminderMessage,
      userMessage,
      openAIService,
      speakingBotId,
      threadId,
      botConfig
    } = input;

    Logger.info('[RecognizeUserIntent] Inicio', { leadId, userMessage, speakingBotId, threadId });

    Logger.debug('[RecognizeUserIntent] Obteniendo información de pacientes');
    const patientInfo = await this.fetchPatientInfoUseCase.execute({
      botConfigType,
      botConfigId,
      clinicSource,
      clinicId,
      leadId,
      tiempoActualDT
    });
    Logger.debug('[RecognizeUserIntent] Información de pacientes obtenida', { patientsCount: patientInfo.patients?.length });

    let MENSAJE = '';
    const allAppointments = patientInfo.patients.flatMap(p => p.appointments || []);
    if (reminderMessage && Array.isArray(allAppointments) && allAppointments.length) {
      MENSAJE = `MENSAJE_RECORDATORIO_CITA: ${reminderMessage}. RESPUESTA_AL_MENSAJE_RECORDATORIO_CITA del paciente: ${userMessage}`;
    } else {
      MENSAJE = (userMessage || "").trim();
    }

    const contextForAI: IntentContext = {
      MENSAJE,
      TIMEZONE_SISTEMA: timezone,
      TIEMPO_ACTUAL: getActualTimeForPrompts(tiempoActualDT, timezone),
      PACIENTES_ASOCIADOS_AL_TELEFONO: patientInfo.patients ?? [],
      CONTEXTO_PLACEHOLDERS: botConfig?.placeholders ? JSON.stringify(botConfig.placeholders) : ""
    };

    Logger.debug('[RecognizeUserIntent] Contexto para AI generado', {
      contextSample: {
        MENSAJE,
        TIMEZONE_SISTEMA: timezone,
        TIEMPO_ACTUAL: getActualTimeForPrompts(tiempoActualDT, timezone),
        PACIENTES_ASOCIADOS_AL_TELEFONO: patientInfo.patients ?? [],
      }
    });

    let assistantResult: RecognizeUserIntentOutput['assistantResult'];
    try {
      Logger.debug('[RecognizeUserIntent] Solicitando respuesta al asistente', { speakingBotId });
      const resp = await openAIService.getResponseFromAssistant(
        speakingBotId,
        JSON.stringify(contextForAI),
        threadId || undefined
      );

      assistantResult = {
        threadId: resp.threadId,
        runId: resp.runId,
        message: resp.message,
        functionCalls: resp.functionCalls
      };
      Logger.debug('[RecognizeUserIntent] Respuesta recibida del asistente', { assistantResult });
    } catch (error) {
      Logger.error("RecognizeUserIntentUseCase: error llamando a getResponseFromAssistant", {
        error,
        speakingBotId,
        clinicId,
        leadId
      });
      throw new AppError({
        code: 'ERR_OPENAI_INTENT',
        humanMessage: 'Ocurrió un problema al analizar la intención. Inténtalo nuevamente.',
        context: { error, speakingBotId, clinicId, leadId }
      });
    }

    const firstCall = assistantResult.functionCalls && assistantResult.functionCalls[0];
    let intent = firstCall?.name?.trim() as KnownIntent | undefined;

    if (!intent) {
      Logger.warn("RecognizeUserIntentUseCase: intención no detectada", {
        assistantResult,
        userMessage
      });
      intent = "conversación_regular";
    }

    const params: Record<string, unknown> = firstCall?.arguments ?? {};
    Logger.info('[RecognizeUserIntent] Intención final detectada', { intent, params });

    return {
      intent,
      params,
      assistantResult,
      patientInfo
    };
  }
}
