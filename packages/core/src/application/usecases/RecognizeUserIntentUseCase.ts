// packages/core/src/application/usecases/RecognizeUserIntentUseCase.ts

import { FetchPatientInfoUseCase } from '@clinickeys-agents/core/application/usecases';
import { BotConfigType, BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { AvailabilityError } from '@clinickeys-agents/core/domain/errors';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { getClinicLocalTimestamp } from '@clinickeys-agents/core/utils';
import { IOpenAIService } from '@clinickeys-agents/core/domain/openai';
import type { DateTime } from 'luxon';

// =============================
// Tipos
// =============================

type KnownIntent =
  | 'conversación_regular'
  | 'identificar_paciente'
  | 'clarificar_paciente'
  | 'consulta_agendar'
  | 'agendar_cita'
  | 'crear_tarea'
  | 'gestionar_estado_cita';

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
  MENSAJE_USUARIO: string;
  TIMEZONE_SISTEMA: string;
  TIEMPO_LOCAL: string;
  PACIENTES_ASOCIADOS_AL_INTERLOCUTOR: PatientInfo['patients'];
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
      botConfig,
    } = input;

    Logger.info('[RecognizeUserIntent] Inicio', {
      leadId,
      clinicId,
      clinicSource,
      botConfigType,
      botConfigId,
      speakingBotId,
      threadId,
      timezone,
    });

    Logger.info('[RecognizeUserIntent] Obteniendo información de pacientes (fetchPatientInfoUseCase)');
    const patientInfo = await this.fetchPatientInfoUseCase.execute({
      botConfigType,
      botConfigId,
      clinicSource,
      clinicId,
      leadId,
      tiempoActualDT,
    });
    const hasAppointments = (patientInfo.patients || []).some((p) => (p.appointments || []).length > 0);
    Logger.info('[RecognizeUserIntent] Información de pacientes obtenida', {
      patientsCount: patientInfo.patients?.length || 0,
      hasAppointments,
    });
    const allAppointments = patientInfo.patients.flatMap((p) => p.appointments || []);
    Logger.info('[RecognizeUserIntent] Reminder message and appointments conditions', {
      hasReminderMessage: reminderMessage,
      totalAppointments: allAppointments,
    });
    let MENSAJE_USUARIO = '';
    if (reminderMessage && hasAppointments) {
      MENSAJE_USUARIO = `MENSAJE_RECORDATORIO_CITA: ${reminderMessage}. MENSAJE_USUARIO (Respuesta al recordatorio): ${userMessage}`;
      Logger.info('[RecognizeUserIntent] Mensaje del usuario clasificado como respuesta a recordatorio', {
        hasReminderMessage: !!reminderMessage,
        totalAppointments: allAppointments.length,
      });
    } else {
      MENSAJE_USUARIO = (userMessage || '').trim();
      Logger.info('[RecognizeUserIntent] Mensaje del usuario recibido', {
        length: MENSAJE_USUARIO.length,
        preview: MENSAJE_USUARIO,
      });
    }

    // =============================
    // Contexto para el asistente
    // =============================

    // Nuevo modelo: solo inyectamos el placeholder unificado del asistente principal
    // "ASISTENTE_PRINCIPAL_CONFIG". Si no existe, enviamos string vacío.
    const placeholdersPrincipal = JSON.stringify({
      ASISTENTE_PRINCIPAL_CONFIG: botConfig?.placeholders?.ASISTENTE_PRINCIPAL_CONFIG || '',
    });

    const contextForAI: IntentContext = {
      MENSAJE_USUARIO,
      TIMEZONE_SISTEMA: timezone,
      TIEMPO_LOCAL: getClinicLocalTimestamp(tiempoActualDT, timezone),
      PACIENTES_ASOCIADOS_AL_INTERLOCUTOR: patientInfo.patients ?? [],
      CONTEXTO_PLACEHOLDERS: placeholdersPrincipal,
    };

    Logger.info('[RecognizeUserIntent] Contexto para AI generado', {
      TIMEZONE_SISTEMA: contextForAI.TIMEZONE_SISTEMA,
      TIEMPO_LOCAL: contextForAI.TIEMPO_LOCAL,
      pacientesAsociados: (contextForAI.PACIENTES_ASOCIADOS_AL_INTERLOCUTOR || []).length,
      placeholdersIncluidos: !!contextForAI.CONTEXTO_PLACEHOLDERS,
      contextJSON: JSON.stringify(contextForAI),
    });

    let assistantResult: RecognizeUserIntentOutput['assistantResult'];
    try {
      Logger.info('[RecognizeUserIntent] Solicitando respuesta al asistente (getResponseFromAssistant)', {
        speakingBotId,
        threadId,
      });
      const resp = await openAIService.getResponseFromAssistant(
        speakingBotId,
        JSON.stringify(contextForAI),
        threadId || undefined,
      );

      assistantResult = {
        threadId: resp.threadId,
        runId: resp.runId,
        message: resp.message,
        functionCalls: resp.functionCalls,
      };
      Logger.info('[RecognizeUserIntent] Respuesta recibida del asistente', {
        threadId: assistantResult.threadId,
        runId: assistantResult.runId,
        messageLength: (assistantResult.message || '').length,
        functionCallsCount: assistantResult.functionCalls?.length || 0,
        functionCalls: assistantResult.functionCalls,
      });
    } catch (error) {
      Logger.error('[RecognizeUserIntent] Error llamando a getResponseFromAssistant', {
        error,
        speakingBotId,
        clinicId,
        leadId,
      });
      throw new AvailabilityError({
        code: 'ERR_OPENAI_INTENT',
        humanMessage: 'Ocurrió un problema al analizar la intención. Inténtalo nuevamente.',
        context: { error, speakingBotId, clinicId, leadId },
      });
    }

    const firstCall = assistantResult.functionCalls && assistantResult.functionCalls[0];
    let intent = firstCall?.name?.trim() as KnownIntent | undefined;

    if (!intent) {
      Logger.warn('[RecognizeUserIntent] Intención no detectada, se usará conversación_regular', {
        assistantMessage: assistantResult.message,
      });
      intent = 'conversación_regular';
    }

    const params: Record<string, unknown> = firstCall?.arguments ?? {};

    Logger.info('[RecognizeUserIntent] Intención final detectada', {
      intent,
      params,
      hasParams: !!params && Object.keys(params).length > 0,
    });

    return {
      intent,
      params,
      assistantResult,
      patientInfo,
    };
  }
}