// packages/core/src/application/usecases/OrchestrateConversationUseCase.ts

import { z } from "zod";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";

import { KommoService, PrimaryBotService } from "@clinickeys-agents/core/application/services";

import {
  ScheduleAppointmentUseCase,
  CheckAvailabilityUseCase,
  ManageAppointmentStateUseCase,
  CreateTaskUseCase,
  LoadPatientsByPhoneUseCase,
  RegularConversationUseCase,
  SessionResetUseCase,
} from "@clinickeys-agents/core/application/usecases";

import type { BotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";
import { KommoCustomFieldValueBase } from "@clinickeys-agents/core/infrastructure/integrations/kommo";
import { localTime } from "@clinickeys-agents/core/utils";
import {
  PATIENT_MESSAGE_PROCESSED_CHUNK,
  PLEASE_WAIT_MESSAGE,
  REMINDER_MESSAGE,
  NOTIFICATION_ID,
  CLINIC_NAME,
  APPOINTMENT_DATE,
  APPOINTMENT_START_TIME,
  APPOINTMENT_END_TIME,
  APPOINTMENT_WEEKDAY_NAME,
  DOCTOR_FULL_NAME,
  TREATMENT_NAME,
  SPACE_NAME,
  BOT_MESSAGE,
  RESP_ID,
} from "@clinickeys-agents/core/utils";

// =============================
// Zod Schemas (validación de tool-calls)
// =============================
const CheckAvailabilitySchema = z.object({
  tratamiento: z.string(),
  medico: z.string().nullable().optional(),
  espacio: z.string().nullable().optional(),
  fechas: z.string(),
  horas: z.string(),
  rango_dias_extra: z.number().optional(),
  summary: z.string(),
});

// Modo A: usar paciente existente
const ScheduleAppointmentUseExistingSchema = z.object({
  nombre: z.string(),
  apellido: z.string(),
  telefono: z.string(),
  summary: z.string(),
  id_paciente: z.number(),
  shouldCreatePatient: z.literal(false),
  isThirdParty: z.boolean(),
  id_pack_bono: z.number().nullable().optional(),
  id_presupuesto: z.number().nullable().optional(),
  horarioEscogido: z.object({
    fecha_cita: z.string(),
    fecha_legible: z.string(),
    hora_inicio: z.string(),
    hora_fin: z.string(),
    id_tratamiento: z.number(),
    id_medico: z.number(),
    id_espacio: z.number(),
  }),
});

// Modo B: crear/buscar paciente en agendar
const ScheduleAppointmentCreateSchema = z.object({
  nombre: z.string(),
  apellido: z.string(),
  telefono: z.string(),
  summary: z.string(),
  // id_paciente no requerido cuando se crea
  id_paciente: z.number().optional(),
  shouldCreatePatient: z.literal(true),
  isThirdParty: z.boolean(),
  id_pack_bono: z.number().nullable().optional(),
  id_presupuesto: z.number().nullable().optional(),
  horarioEscogido: z.object({
    fecha_cita: z.string(),
    fecha_legible: z.string(),
    hora_inicio: z.string(),
    hora_fin: z.string(),
    id_tratamiento: z.number(),
    id_medico: z.number(),
    id_espacio: z.number(),
  }),
});

const ScheduleAppointmentSchema = z.union([
  ScheduleAppointmentUseExistingSchema,
  ScheduleAppointmentCreateSchema,
]);

const ManageAppointmentStateSchema = z.object({
  id_cita: z.number(),
  estado: z.enum(["PROGRAMADA", "CANCELADA", "CONFIRMADA", "EN_CAMINO"]),
  summary: z.string(),
  motivo_cambio: z.string(),
});

const CreateTaskSchema = z.object({
  nombre: z.string().optional(),
  apellido: z.string().optional(),
  telefono: z.string().optional(),
  motivo: z.string().optional(),
  canal_preferido: z.string().nullable().optional(),
});

const LoadPatientsByPhoneSchema = z.object({
  telefono_consulta: z.string(),
});

const RegularConversationSchema = z.object({
  assistantMessage: z.string(),
});

// =============================
// Tipos del caso de uso
// =============================
export interface OrchestrateConversationInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  userMessage: string;
  reminderMessage: string;
  previousResponseId?: string;
}

export interface OrchestrateConversationOutput {
  success: boolean;
  message: string;
}

export interface OrchestrateConversationUseCaseDeps {
  kommoService: KommoService;
  primaryBot: PrimaryBotService;
  scheduleAppointmentUC: ScheduleAppointmentUseCase;
  checkAvailabilityUC: CheckAvailabilityUseCase;
  manageAppointmentStateUC: ManageAppointmentStateUseCase;
  createTaskUC: CreateTaskUseCase;
  loadPatientsByPhoneUC: LoadPatientsByPhoneUseCase;
  regularConversationUC: RegularConversationUseCase;
  sessionResetUC: SessionResetUseCase;
}

const MAX_TOOL_RETRIES = 3;
const MAX_TOOL_CALLS_PER_TURN = 5;

export class OrchestrateConversationUseCase {
  constructor(private readonly deps: OrchestrateConversationUseCaseDeps) {}

  public async execute(input: OrchestrateConversationInput): Promise<OrchestrateConversationOutput> {
    const { botConfig, leadId, normalizedLeadCF, previousResponseId, userMessage, reminderMessage } = input;

    try {
      Logger.info("[OrchestrateConversation] Inicio", { leadId });

      // =============================
      // PRE-FLIGHT: limpieza condicional y apertura de sesión (sin Salesbot)
      // =============================
      const pre = await this.deps.sessionResetUC.preFlight({ botConfig, leadId, normalizedLeadCF });
      if (!pre.success) {
        Logger.warn("[OrchestrateConversation] preFlight no pasó barrera de sesión; se aborta limpio", { leadId });
        return { success: false, message: "No fue posible procesar el mensaje en este momento." };
      }

      // Contador de tool-calls por turno
      let toolCallsThisTurn = 0;

      // Caché simple de pacientes por turno (clave: nombre|apellido|telefono normalizado)
      const patientCache = new Map<string, number>();

      // Executor local: mapea tool-calls → Use Cases (con retries por tool)
      const executor = async (name: string, args: Record<string, any>) => {
        if (toolCallsThisTurn >= MAX_TOOL_CALLS_PER_TURN) {
          Logger.warn("[OrchestrateConversation] Límite de tool-calls alcanzado", { limit: MAX_TOOL_CALLS_PER_TURN });
          throw new Error("MAX_TOOL_CALLS_REACHED");
        }

        Logger.info("[OrchestrateConversation] Ejecutando tool", { name, args });

        for (let attempt = 1; attempt <= MAX_TOOL_RETRIES; attempt++) {
          try {
            const toolOutput = await this.executeTool({
              name,
              args,
              botConfig,
              leadId,
              normalizedLeadCF,
              patientCache,
            });

            toolCallsThisTurn += 1;
            return toolOutput;
          } catch (err) {
            const isLast = attempt === MAX_TOOL_RETRIES;
            Logger.warn("[OrchestrateConversation] Tool error/retry", {
              name,
              attempt,
              isLast,
              err,
            });
            if (isLast) throw err;
          }
        }
        // No debería alcanzarse
        throw new Error(`Falló la herramienta tras ${MAX_TOOL_RETRIES} reintentos`);
      };

      // Resolver flujo completo con Responses v5 (múltiples function-calls)
      const result = await this.deps.primaryBot.converse({
        botConfig,
        leadId,
        normalizedLeadCF,
        userMessage, // PrimaryBotService construye su propio contexto a partir de este mensaje
        reminderMessage,
        toolExecutor: executor,
        previousResponseId,
      });

      const finalMessage = result.message || "";
      const responseId = result.responseId || ""; // correlación → RESP_ID

      Logger.info("[OrchestrateConversation] Resultado final", {
        hasMessage: !!finalMessage,
        responseId,
      });

      // Armar custom fields para Kommo
      const baseFields: Record<string, string> = {
        [APPOINTMENT_WEEKDAY_NAME]: "",
        [APPOINTMENT_START_TIME]: "",
        [APPOINTMENT_END_TIME]: "",
        [APPOINTMENT_DATE]: "",
        [REMINDER_MESSAGE]: "",
        [DOCTOR_FULL_NAME]: "",
        [NOTIFICATION_ID]: "",
        [TREATMENT_NAME]: "",
        [CLINIC_NAME]: "",
        [SPACE_NAME]: "",
        [RESP_ID]: responseId,
        [BOT_MESSAGE]: finalMessage,
        [PLEASE_WAIT_MESSAGE]: "false",
        [PATIENT_MESSAGE_PROCESSED_CHUNK]: userMessage,
      };

      Logger.info("[OrchestrateConversation] Enviando respuesta a Kommo", {
        leadId,
        responseId,
      });

      const reply = await this.deps.kommoService.replyToLead({
        salesbotId: botConfig.kommo.salesbotId,
        leadId,
        customFields: baseFields,
        normalizedLeadCF,
      });

      // Fase RENDERING (sin Salesbot), útil para trazas
      if (!reply.aborted) {
        await this.deps.sessionResetUC.markRenderingPhase({ botConfig, leadId });
      } else {
        Logger.warn("[OrchestrateConversation] replyToLead abortado por guardia de concurrencia (randomStamp). Se omite RENDERING.", { leadId });
      }

      // =============================
      // POST-FLIGHT: limpieza condicional y cierre de sesión (sin Salesbot)
      // =============================
      await this.deps.sessionResetUC.postFlight({ botConfig, leadId });

      return { success: true, message: finalMessage };
    } catch (error) {
      Logger.error("[OrchestrateConversation] Error general", { error });
      return {
        success: false,
        message: "No fue posible procesar el mensaje en este momento.",
      };
    }
  }

  // =============================
  // Tool dispatcher
  // =============================
  private async executeTool(params: {
    name: string;
    args: Record<string, any>;
    botConfig: BotConfigDTO;
    leadId: number;
    normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
    patientCache: Map<string, number>;
  }): Promise<string> {
    const { name, args, botConfig, leadId, normalizedLeadCF, patientCache } = params;

    switch (name) {
      case "consulta_agendar": {
        Logger.info("[Tool] consulta_agendar");
        const parsed = CheckAvailabilitySchema.parse(args);
        const out = await this.deps.checkAvailabilityUC.execute({
          botConfig,
          leadId,
          normalizedLeadCF,
          params: parsed,
          timezone: botConfig.timezone,
          tiempoActualDT: localTime(botConfig.timezone),
          subdomain: botConfig.kommo.subdomain,
        });
        if (!out.success) throw new Error("consulta_agendar UC failed");
        return this.wrapToolOutput(out.toolOutput);
      }

      case "agendar_cita": {
        Logger.info("[Tool] agendar_cita");
        const parsed = ScheduleAppointmentSchema.parse(args);

        // Normalizar null → undefined para campos opcionales del horarioEscogido
        const norm = (v: unknown) => (v === null ? undefined : v);
        const fixed = {
          ...parsed,
          horarioEscogido: {
            ...parsed.horarioEscogido,
          },
          id_pack_bono: norm((parsed as any).id_pack_bono) as number | undefined,
          id_presupuesto: norm((parsed as any).id_presupuesto) as number | undefined,
        } as typeof parsed;

        // Sugerencia de reuso de cache: si no viene id_paciente pero tenemos coincidencia exacta de nombre/apellido/telefono
        if ((fixed as any).shouldCreatePatient === true && !(fixed as any).id_paciente) {
          const key = this.cacheKey((fixed as any).nombre, (fixed as any).apellido, (fixed as any).telefono);
          const cachedId = patientCache.get(key);
          if (cachedId) {
            (fixed as any).id_paciente = cachedId;
            (fixed as any).shouldCreatePatient = false; // ya tenemos ID
          }
        }

        const out = await this.deps.scheduleAppointmentUC.execute({
          botConfig,
          leadId,
          normalizedLeadCF,
          params: fixed as any,
          timezone: botConfig.timezone,
          tiempoActualDT: localTime(botConfig.timezone),
          subdomain: botConfig.kommo.subdomain,
        });
        if (!out.success) throw new Error("agendar_cita UC failed");

        // Guardar en caché el id_paciente resultante si vino
        const p = parsed;
        const idResult = out.id_paciente_result as number | undefined;
        if (idResult) {
          const key = this.cacheKey(p.nombre, p.apellido, p.telefono);
          patientCache.set(key, idResult);
        }

        // Confirmación/desconfirmación automática
        if (out.createdAppointmentId) {
          try {
            await this.deps.manageAppointmentStateUC.execute({
              leadId,
              params: {
                id_cita: out.createdAppointmentId,
                estado: out.needsConfirmation ? "CONFIRMADA" : "PROGRAMADA",
                summary: parsed.summary,
              },
            });
          } catch (e) {
            Logger.warn("[Tool] manageAppointmentState post-agendar falló (no bloqueante)", { e });
          }
        }

        return this.wrapToolOutput(out.toolOutput);
      }

      case "gestionar_estado_cita": {
        Logger.info("[Tool] gestionar_estado_cita");
        const parsed = ManageAppointmentStateSchema.parse(args);
        const out = await this.deps.manageAppointmentStateUC.execute({
          leadId,
          params: parsed,
        });
        if (!out.success) throw new Error("gestionar_estado_cita UC failed");
        return this.wrapToolOutput(out.toolOutput);
      }

      case "crear_tarea": {
        Logger.info("[Tool] crear_tarea");
        const parsed = CreateTaskSchema.parse(args);
        const out = await this.deps.createTaskUC.execute({
          botConfig,
          leadId,
          normalizedLeadCF,
          params: parsed,
        });
        if (!out.success) throw new Error("crear_tarea UC failed");
        return this.wrapToolOutput(out.toolOutput);
      }

      case "cargar_pacientes_por_telefono": {
        Logger.info("[Tool] cargar_pacientes_por_telefono");
        const parsed = LoadPatientsByPhoneSchema.parse(args);
        const out = await this.deps.loadPatientsByPhoneUC.execute({
          leadId,
          botConfig,
          normalizedLeadCF,
          params: parsed,
          tiempoActualDT: localTime(botConfig.timezone),
        });
        if (!out.success) throw new Error("cargar_pacientes_por_telefono UC failed");
        return this.wrapToolOutput(out.toolOutput);
      }

      default: {
        Logger.info("[Tool] fallback → conversación_regular");
        const out = await this.deps.regularConversationUC.execute({
          params: RegularConversationSchema.parse({ assistantMessage: String(args?.assistantMessage || "") }),
        });
        if (!out.success) throw new Error("regularConversation UC failed");
        return this.wrapToolOutput(out.toolOutput);
      }
    }
  }

  private wrapToolOutput(toolOutput: string): string {
    // IMPORTANTE: no cerrar con una llave extra (bug anterior) — devolver tal cual
    return `${toolOutput}`;
  }

  private cacheKey(nombre: string, apellido: string, telefono: string): string {
    const norm = (s: string) => String(s || "").trim().toLowerCase();
    const tel = String(telefono || "").replace(/\D+/g, "");
    return `${norm(nombre)}|${norm(apellido)}|${tel}`;
  }
}

export default OrchestrateConversationUseCase;