// packages/core/src/application/usecases/OrchestrateConversationUseCase.ts

import { z } from "zod";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";

import { KommoService, PrimaryBotService } from "@clinickeys-agents/core/application/services";

import {
  ScheduleAppointmentUseCase,
  CheckAvailabilityUseCase,
  ManageAppointmentStateUseCase,
  CreateTaskUseCase,
  IdentifyPatientUseCase,
  ClarifyPatientUseCase,
  RegularConversationUseCase,
} from "@clinickeys-agents/core/application/usecases";

import type { BotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";
import { KommoCustomFieldValueBase } from "@clinickeys-agents/core/infrastructure/integrations/kommo";
import { localTime, mergePlaceholdersIntoContext } from "@clinickeys-agents/core/utils";
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
  THREAD_ID,
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

const ScheduleAppointmentSchema = z.object({
  nombre: z.string(),
  apellido: z.string(),
  telefono: z.string(),
  summary: z.string(),
  id_paciente: z.number(),
  shouldCreatePatient: z.boolean(),
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
    nombre_tratamiento: z.string().nullable().optional(),
    nombre_medico: z.string().nullable().optional(),
    nombre_espacio: z.string().nullable().optional(),
    duracion_tratamiento: z.number().nullable().optional(),
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

const IdentifyPatientSchema = z.object({
  nombre: z.string(),
  apellido: z.string(),
  telefono: z.string(),
});

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
  identifyPatientUC: IdentifyPatientUseCase;
  clarifyPatientUC: ClarifyPatientUseCase;
  regularConversationUC: RegularConversationUseCase;
}

const MAX_TOOL_RETRIES = 3;

export class OrchestrateConversationUseCase {
  constructor(private readonly deps: OrchestrateConversationUseCaseDeps) {}

  public async execute(input: OrchestrateConversationInput): Promise<OrchestrateConversationOutput> {
    const { botConfig, leadId, normalizedLeadCF, previousResponseId, userMessage, reminderMessage } = input;

    try {
      Logger.info("[OrchestrateConversation] Inicio", { leadId });

      // Executor local: mapea tool-calls → Use Cases (con retries por tool)
      const executor = async (name: string, args: Record<string, any>) => {
        Logger.info("[OrchestrateConversation] Ejecutando tool", { name });

        for (let attempt = 1; attempt <= MAX_TOOL_RETRIES; attempt++) {
          try {
            const toolOutput = await this.executeTool({
              name,
              args,
              botConfig,
              leadId,
              normalizedLeadCF,
            });
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
      const responseId = result.responseId || ""; // correlación → THREAD_ID

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
        [THREAD_ID]: responseId,
        [BOT_MESSAGE]: finalMessage,
        [PLEASE_WAIT_MESSAGE]: "false",
        [PATIENT_MESSAGE_PROCESSED_CHUNK]: userMessage,
      };

      Logger.info("[OrchestrateConversation] Enviando respuesta a Kommo", {
        leadId,
        responseId,
      });

      await this.deps.kommoService.replyToLead({
        salesbotId: botConfig.kommo.salesbotId,
        leadId,
        customFields: baseFields,
        normalizedLeadCF,
      });

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
  }): Promise<string> {
    const { name, args, botConfig, leadId, normalizedLeadCF } = params;

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
        return this.wrapToolOutput(out.toolOutput, botConfig);
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
            nombre_tratamiento: norm(parsed.horarioEscogido.nombre_tratamiento),
            nombre_medico: norm(parsed.horarioEscogido.nombre_medico),
            nombre_espacio: norm(parsed.horarioEscogido.nombre_espacio),
            duracion_tratamiento: norm(parsed.horarioEscogido.duracion_tratamiento) as number | undefined,
            especifica: norm(parsed.horarioEscogido.especifica) as boolean | undefined,
          },
          id_pack_bono: norm(parsed.id_pack_bono) as number | undefined,
          id_presupuesto: norm(parsed.id_presupuesto) as number | undefined,
        } as typeof parsed;

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

        // Confirmación/desconfirmación automática (en código; el modelo no lo sabe)
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

        return this.wrapToolOutput(out.toolOutput, botConfig);
      }

      case "gestionar_estado_cita": {
        Logger.info("[Tool] gestionar_estado_cita");
        const parsed = ManageAppointmentStateSchema.parse(args);
        const out = await this.deps.manageAppointmentStateUC.execute({
          leadId,
          params: parsed,
        });
        if (!out.success) throw new Error("gestionar_estado_cita UC failed");
        return this.wrapToolOutput(out.toolOutput, botConfig);
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
        return this.wrapToolOutput(out.toolOutput, botConfig);
      }

      case "identificar_paciente": {
        Logger.info("[Tool] identificar_paciente");
        const parsed = IdentifyPatientSchema.parse(args);
        const out = await this.deps.identifyPatientUC.execute({
          leadId,
          botConfig,
          params: parsed,
          tiempoActualDT: localTime(botConfig.timezone),
        });
        if (!out.success) throw new Error("identificar_paciente UC failed");
        return this.wrapToolOutput(out.toolOutput, botConfig);
      }

      case "clarificar_paciente": {
        Logger.info("[Tool] clarificar_paciente");
        const parsed = ClarifyPatientSchema.parse(args);

        // Normalización de candidatos (acepta string JSON o array con posible {paciente:{...}})
        let candidatesArr: Array<{ id_paciente: number; nombre: string; apellido: string; telefono: string }> = [];
        try {
          const raw = Array.isArray(parsed.candidatos) ? parsed.candidatos : JSON.parse(parsed.candidatos as string);
          candidatesArr = (raw as any[])
            .map((item: any) => {
              const base = item?.paciente || item || {};
              return {
                id_paciente: Number(base.id_paciente),
                nombre: String(base.nombre || ""),
                apellido: String(base.apellido || ""),
                telefono: base.telefono ? String(base.telefono) : "",
              };
            })
            .filter((c: any) => Number.isFinite(c.id_paciente));
        } catch (e) {
          Logger.warn("[Tool] clarificar_paciente → candidatos no parseables, se envía vacío", { e });
          candidatesArr = [];
        }

        const out = await this.deps.clarifyPatientUC.execute({
          botConfig,
          leadId,
          normalizedLeadCF,
          params: {
            id_clinica: parsed.id_clinica ?? botConfig.clinicId,
            candidatos: candidatesArr,
          },
        });
        if (!out.success) throw new Error("clarificar_paciente UC failed");
        return this.wrapToolOutput(out.toolOutput, botConfig);
      }

      default: {
        Logger.info("[Tool] fallback → conversación_regular");
        const out = await this.deps.regularConversationUC.execute({
          params: RegularConversationSchema.parse({ assistantMessage: String(args?.assistantMessage || "") }),
        });
        if (!out.success) throw new Error("regularConversation UC failed");
        return this.wrapToolOutput(out.toolOutput, botConfig);
      }
    }
  }

  private wrapToolOutput(toolOutput: string, botConfig: BotConfigDTO): string {
    const placeholders = mergePlaceholdersIntoContext(botConfig.placeholders);
    return `${toolOutput}\n${placeholders}`;
  }
}