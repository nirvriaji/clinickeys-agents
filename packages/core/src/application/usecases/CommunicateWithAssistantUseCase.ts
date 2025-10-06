// packages/core/src/application/usecases/CommunicateWithAssistantUseCase.ts

import {
  CheckAvailabilityUseCase,
  ScheduleAppointmentUseCase,
  RecognizeUserIntentUseCase,
  RegularConversationUseCase,
  IdentifyPatientUseCase,
  CreateTaskUseCase,
  ManageAppointmentStateUseCase,
  ClarifyPatientUseCase,
} from '@clinickeys-agents/core/application/usecases';

import {
  PATIENT_MESSAGE_PROCESSED_CHUNK,
  PLEASE_WAIT_MESSAGE,
  REMINDER_MESSAGE,
  NOTIFICATION_ID,
  PATIENT_FIRST_NAME,
  PATIENT_LAST_NAME,
  PATIENT_PHONE,
  CLINIC_NAME,
  APPOINTMENT_DATE,
  APPOINTMENT_START_TIME,
  APPOINTMENT_END_TIME,
  APPOINTMENT_WEEKDAY_NAME,
  DOCTOR_FULL_NAME,
  TREATMENT_NAME,
  SPACE_NAME,
  BOT_MESSAGE,
  THREAD_ID,
} from '@clinickeys-agents/core/utils';

import { localTime, mergePlaceholdersIntoContext } from '@clinickeys-agents/core/utils';
import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { KommoService, OpenAIService } from '@clinickeys-agents/core/application/services';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { z } from 'zod';

import type { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';

const CheckAvailabilitySchema = z.object({
  tratamiento: z.string(),
  medico: z.string().nullable().optional(),
  espacio: z.string().nullable().optional(),
  fechas: z.string(),
  horas: z.string(),
  rango_dias_extra: z.number().optional(),
  summary: z.string(),
});

const ScheduleAppointmentSchema = z.object({
  // Datos del paciente / control
  nombre: z.string(),
  apellido: z.string(),
  telefono: z.string(),
  summary: z.string(),
  id_paciente: z.number(),
  shouldCreatePatient: z.boolean(),
  isThirdParty: z.boolean(),

  // Vínculos comerciales opcionales
  id_pack_bono: z.number().nullable().optional(),
  id_presupuesto: z.number().nullable().optional(),

  // Opción de horario elegida (requerida)
  horarioEscogido: z.object({
    fecha_cita: z.string(),        // 'YYYY-MM-DD'
    fecha_legible: z.string(),
    hora_inicio: z.string(),       // 'HH:MM'
    hora_fin: z.string(),          // 'HH:MM' (si no llega, el UC calcula con la duración)

    id_tratamiento: z.number(),
    id_medico: z.number(),
    id_espacio: z.number(),

    // Metadatos opcionales (si vienen desde el redactor/selector)
    nombre_tratamiento: z.string(),
    nombre_medico: z.string(),
    nombre_espacio: z.string(),
    duracion_tratamiento: z.number(),
    especifica: z.boolean().nullable().optional(),
  }),
});

const ManageAppointmentStateSchema = z.object({
  id_cita: z.number(),
  estado: z.enum(["PROGRAMADA", "CANCELADA", "CONFIRMADA", "EN_CAMINO"]),
  summary: z.string(),
});

const CreateTaskSchema = z.object({
  nombre: z.string().optional(),
  apellido: z.string().optional(),
  telefono: z.string().optional(),
  motivo: z.string().optional(),
  canal_preferido: z.string().nullable().optional(),
});

const RegularConversationSchema = z.object({
  assistantMessage: z.string(),
});

const IdentifyPatientSchema = z.object({
  nombre: z.string(),
  apellido: z.string(),
  telefono: z.string(),
});

// Schema mínimo para clarificar_paciente.
// Acepta `candidatos` como string (JSON serializado) o como array con los campos esenciales.
const ClarifyPatientSchema = z.object({
  id_clinica: z.number().optional(),
  candidatos: z.union([
    z.string(),
    z.array(
      z.object({
        id_paciente: z.number().optional(),
        nombre: z.string().optional(),
        apellido: z.string().optional(),
        telefono: z.string().optional(),
        // En algunos casos puede venir envuelto en { paciente: {...} }
        paciente: z
          .object({
            id_paciente: z.number(),
            nombre: z.string(),
            apellido: z.string(),
            telefono: z.string().optional(),
          })
          .optional(),
      })
    ),
  ]),
});

export interface CommunicateInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  userMessage: string;
  reminderMessage: string;
  threadId?: string | null;
}

interface UseCaseResponse {
  success: boolean;
  toolOutput: string;
  customFields?: Record<string, string>;
  createdAppointmentId?: number;
  needsConfirmation?: boolean;
}

interface CommunicateOutput {
  success: boolean;
  message: string;
}

export interface CommunicateWithAssistantUseCaseDeps {
  kommoService: KommoService;
  openAIService: OpenAIService;
  recognizeIntentUC: RecognizeUserIntentUseCase;
  scheduleAppointmentUC: ScheduleAppointmentUseCase;
  checkAvailabilityUC: CheckAvailabilityUseCase;
  manageAppointmentStateUC: ManageAppointmentStateUseCase;
  createTaskUC: CreateTaskUseCase;
  regularConversationUC: RegularConversationUseCase;
  identifyPatientUC: IdentifyPatientUseCase;
  clarifyPatientUC: ClarifyPatientUseCase; // NUEVO
}

export class CommunicateWithAssistantUseCase {
  constructor(private deps: CommunicateWithAssistantUseCaseDeps) {}

  public async execute(input: CommunicateInput): Promise<CommunicateOutput> {
    const { botConfig, leadId, normalizedLeadCF, userMessage, reminderMessage, threadId } = input;

    try {
      Logger.info('[CommunicateWithAssistant] Inicio de ejecución', { leadId, userMessage, reminderMessage });

      const intentResult = await this.deps.recognizeIntentUC.execute({
        botConfigType: botConfig.botConfigType,
        botConfigId: botConfig.botConfigId,
        clinicSource: botConfig.clinicSource,
        clinicId: botConfig.clinicId,
        leadId,
        timezone: botConfig.timezone,
        tiempoActualDT: localTime(botConfig.timezone),
        reminderMessage,
        userMessage,
        openAIService: this.deps.openAIService,
        speakingBotId: botConfig.openai?.assistants?.speakingBot || '',
        threadId: threadId || undefined,
        botConfig,
      } as any);

      const { intent: intentName, params, assistantResult } = intentResult;
      const { threadId: thId, runId, functionCalls, message: assistantPlainMessage } = assistantResult || {};
      Logger.info('[CommunicateWithAssistant] Intent detectada', { intentName, thId, runId });
      Logger.debug('[CommunicateWithAssistant] Parámetros de intent', { params });

      let ucResponse: UseCaseResponse;
      switch (intentName) {
        case 'consulta_agendar':
          Logger.info('[CommunicateWithAssistant] Ejecutando caso de uso: consulta_agendar');
          ucResponse = await this.deps.checkAvailabilityUC.execute({
            botConfig,
            leadId,
            normalizedLeadCF,
            params: CheckAvailabilitySchema.parse(params),
            timezone: botConfig.timezone,
            tiempoActualDT: localTime(botConfig.timezone),
            subdomain: botConfig.kommo.subdomain,
          });
          break;
        case 'agendar_cita':
          Logger.info('[CommunicateWithAssistant] Ejecutando caso de uso: agendar_cita');
          const scheduleParams = ScheduleAppointmentSchema.parse(params);
          ucResponse = await this.deps.scheduleAppointmentUC.execute({
            botConfig,
            leadId,
            normalizedLeadCF,
            params: scheduleParams,
            timezone: botConfig.timezone,
            tiempoActualDT: localTime(botConfig.timezone),
            subdomain: botConfig.kommo.subdomain,
          });

          if (ucResponse.success && ucResponse.createdAppointmentId) {
            if (ucResponse.needsConfirmation) {
              Logger.info('[CommunicateWithAssistant] Cita es hoy/mañana, confirmando automáticamente', { id_cita: ucResponse.createdAppointmentId });
              await this.deps.manageAppointmentStateUC.execute({
                leadId,
                params: {
                  id_cita: ucResponse.createdAppointmentId,
                  estado: "CONFIRMADA",
                  summary: scheduleParams.summary,
                },
              });
            } else {
              Logger.info('[CommunicateWithAssistant] Cita no es hoy/mañana, desconfirmando automáticamente', { id_cita: ucResponse.createdAppointmentId });
              await this.deps.manageAppointmentStateUC.execute({
                leadId,
                params: {
                  id_cita: ucResponse.createdAppointmentId,
                  estado: "PROGRAMADA",
                  summary: scheduleParams.summary,
                },
              });
            }
          }
          break;
        case 'gestionar_estado_cita':
          Logger.info('[CommunicateWithAssistant] Ejecutando caso de uso: gestionar_estado_cita');
          ucResponse = await this.deps.manageAppointmentStateUC.execute({
            leadId,
            params: ManageAppointmentStateSchema.parse(params),
          });
          break;
        case 'crear_tarea':
          Logger.info('[CommunicateWithAssistant] Ejecutando caso de uso: crear_tarea');
          ucResponse = await this.deps.createTaskUC.execute({
            botConfig,
            leadId,
            normalizedLeadCF,
            params: CreateTaskSchema.parse(params),
          });
          break;
        case 'identificar_paciente':
          Logger.info('[CommunicateWithAssistant] Ejecutando caso de uso: identificar_paciente');
          ucResponse = await this.deps.identifyPatientUC.execute({
            leadId,
            botConfig,
            params: IdentifyPatientSchema.parse(params),
            tiempoActualDT: localTime(botConfig.timezone),
          });
          break;
        case 'clarificar_paciente':
          Logger.info('[CommunicateWithAssistant] Ejecutando caso de uso: clarificar_paciente');
          // Normalizar entrada para el UC a partir del esquema flexible.
          const parsed = ClarifyPatientSchema.parse(params);

          // Parsear candidatos si vienen como string JSON o como objetos con `paciente` anidado.
          let candidatesArr: Array<{ id_paciente: number; nombre: string; apellido: string; telefono: string }>;
          try {
            const raw = Array.isArray(parsed.candidatos)
              ? parsed.candidatos
              : JSON.parse(parsed.candidatos as string);

            candidatesArr = (raw as any[]).map((item: any) => {
              const base = item?.paciente || item || {};
              return {
                id_paciente: Number(base.id_paciente),
                nombre: String(base.nombre || ''),
                apellido: String(base.apellido || ''),
                telefono: base.telefono ? String(base.telefono) : '',
              };
            }).filter((c: any) => Number.isFinite(c.id_paciente));
          } catch (e) {
            Logger.warn('[CommunicateWithAssistant] No se pudo parsear candidatos en clarificar_paciente; se enviará vacío', { error: e });
            candidatesArr = [];
          }

          ucResponse = await this.deps.clarifyPatientUC.execute({
            botConfig,
            leadId,
            normalizedLeadCF,
            params: {
              id_clinica: parsed.id_clinica ?? botConfig.clinicId,
              candidatos: candidatesArr,
            },
          });
          break;
        default:
          Logger.info('[CommunicateWithAssistant] Ejecutando caso de uso: conversación regular');
          ucResponse = await this.deps.regularConversationUC.execute({
            params: RegularConversationSchema.parse({ assistantMessage: assistantPlainMessage || '' }),
          });
      }

      if (!ucResponse.success) {
        Logger.error('[CommunicateWithAssistant] El caso de uso devolvió error', { intentName, ucResponse });
        throw new Error('El caso de uso devolvió error.');
      }

      let finalMsg: string = assistantPlainMessage || '';

      if (runId && Array.isArray(functionCalls) && functionCalls.length > 0) {
        Logger.info('[CommunicateWithAssistant] Resolviendo functionCalls', { count: functionCalls.length });
        Logger.info('[CommunicateWithAssistant] ToolOutput recibido del UC', { toolOutput: ucResponse.toolOutput });
        const toolOutputWithPlaceholders = `${ucResponse.toolOutput}\n${mergePlaceholdersIntoContext(botConfig.placeholders)}`;
        const resolved = await this.deps.openAIService.getResponseFromWaitingAssistant({
          threadId: thId!,
          runId: runId!,
          functionCalls,
          rawOutput: toolOutputWithPlaceholders,
        });
        Logger.info('[CommunicateWithAssistant] Respuesta final tras functionCalls', { resolvedMessage: resolved });
        Logger.info('[CommunicateWithAssistant] Respuesta final tras functionCalls', { resolvedMessage: resolved.message });
        finalMsg = resolved.message || '';
      }

      const baseFields: Record<string, string> = {
        [APPOINTMENT_WEEKDAY_NAME]: '',
        [APPOINTMENT_START_TIME]: '',
        [APPOINTMENT_END_TIME]: '',
        [APPOINTMENT_DATE]: '',
        [REMINDER_MESSAGE]: '',
        [DOCTOR_FULL_NAME]: '',
        [NOTIFICATION_ID]: '',
        [TREATMENT_NAME]: '',
        [CLINIC_NAME]: '',
        [SPACE_NAME]: '',
        [THREAD_ID]: thId ?? '',
        [BOT_MESSAGE]: finalMsg || '',
        [PLEASE_WAIT_MESSAGE]: 'false',
        [PATIENT_MESSAGE_PROCESSED_CHUNK]: userMessage,
      };

      const customFields = { ...baseFields, ...(ucResponse.customFields ?? {}) };
      Logger.info('[CommunicateWithAssistant] Campos construidos para Kommo', {
        baseFields,
        ucCustomFields: ucResponse.customFields,
        mergedCustomFields: customFields,
      });

      Logger.info('[CommunicateWithAssistant] Llamando a replyToLead', { leadId, salesbotId: botConfig.kommo.salesbotId });
      await this.deps.kommoService.replyToLead({
        salesbotId: botConfig.kommo.salesbotId,
        leadId,
        customFields,
        normalizedLeadCF,
      });
      Logger.info('[CommunicateWithAssistant] Ejecución completada con éxito', { leadId });

      return { success: true, message: finalMsg || '' };
    } catch (error) {
      Logger.error('[CommunicateWithAssistant] Error general en ejecución', { error });
      return {
        success: false,
        message: 'No fue posible procesar el mensaje en este momento.'
      };
    }
  }
}