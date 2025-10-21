// packages/core/src/application/services/ConversationContextService.ts

import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { FetchPatientInfoUseCase } from "@clinickeys-agents/core/application/usecases";
import { localTime, getClinicLocalTimestamp, mergePlaceholdersIntoContext } from "@clinickeys-agents/core/utils";
import type { BotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";

// Tipos devueltos por FetchPatientInfoUseCase (coinciden con los ya existentes)
type PatientInfo = Awaited<ReturnType<FetchPatientInfoUseCase["execute"]>>;

export interface ConversationContext {
  /**
   * Se deja vacío por defecto. PrimaryBotService cargará el prompt real
   * desde packages/core/src/prompts/principal_bot.md
   */
  systemPrompt: string;
  /** Carga útil lista para enviar a OpenAI ( Responses v5 ) como input del usuario. */
  userPayloadJSON: string;
  /** Metadatos útiles para logs y trazabilidad. */
  meta: {
    timezone: string;
    localTimeForPrompts: string;
    hasReminderThread: boolean;
    patientsCount: number;
    appointmentsCount: number;
  };
}

export interface ConversationContextServiceDeps {
  fetchPatientInfoUC: FetchPatientInfoUseCase;
  logger?: typeof Logger;
}

/**
 * Ensambla un contexto consistente para la conversación inicial o turnos subsiguientes.
 *
 * - Obtiene pacientes/citas asociados al lead (vía FetchPatientInfoUseCase)
 * - Resuelve el mensaje efectivo del usuario cuando es respuesta a recordatorio
 * - Inyecta TZ, hora local y placeholders mínimos del bot principal
 * - Emite JSON final mínimo (no multi‑propósito) para facilitar el razonamiento del LLM
 */
export class ConversationContextService {
  private fetchPatientInfoUC: FetchPatientInfoUseCase;
  private logger: typeof Logger;

  constructor({ fetchPatientInfoUC, logger = Logger }: ConversationContextServiceDeps) {
    this.fetchPatientInfoUC = fetchPatientInfoUC;
    this.logger = logger;
  }

  /**
   * Construye el contexto consumible por el PrimaryBot.
   *
   * @param botConfig Configuración del bot/clinica
   * @param leadId    Identificador del lead en Kommo
   * @param userMessage Mensaje recibido del usuario (texto libre)
   * @param reminderMessage Mensaje de recordatorio enviado previamente (si aplica)
   */
  async build(
    botConfig: BotConfigDTO,
    leadId: number,
    userMessage: string,
    reminderMessage?: string | null
  ): Promise<ConversationContext> {
    const tz = botConfig.timezone;
    const tiempoActualDT = localTime(tz);
    const localTimeForPrompts = getClinicLocalTimestamp(tiempoActualDT, tz);

    this.logger.info("[ConversationContextService] Iniciando construcción de contexto", {
      leadId,
      clinicId: botConfig.clinicId,
      tz,
    });

    // 1) Pacientes y citas asociados al interlocutor
    const patientInfo = await this.fetchPatientInfoSafe({
      botConfig,
      leadId,
      tiempoActualDT,
    });

    const patients = patientInfo.patients ?? [];
    const appointmentsCount = patients.reduce((acc, p) => acc + (p.appointments?.length || 0), 0);

    // Teléfono del interlocutor proveniente del CONTACT CF de Kommo (garantizado por flujo)
    const interlocutorPhone = patientInfo.interlocutorPhone || "";

    // 2) Resolver mensaje efectivo del usuario (respuesta a recordatorio vs mensaje normal)
    let MENSAJE_USUARIO = (userMessage || "").trim();
    const hasReminderThread = !!reminderMessage && appointmentsCount > 0;
    if (hasReminderThread) {
      MENSAJE_USUARIO = `MENSAJE_RECORDATORIO_CITA: ${reminderMessage}. MENSAJE_USUARIO (Respuesta al recordatorio): ${userMessage}`;
    }

    // 3) Placeholders (mantener compacto: solo el bloque del asistente principal)
    const CONTEXTO_PLACEHOLDERS = JSON.stringify({
      ASISTENTE_PRINCIPAL_CONFIG: botConfig?.placeholders?.ASISTENTE_PRINCIPAL_CONFIG || "",
    });

    // 4) Bloque opcional en texto plano con TODOS los placeholders (para concatenar si hace falta)
    //    No va en el JSON principal para no contaminar el razonamiento.
    const FULL_PLACEHOLDERS_TEXT = mergePlaceholdersIntoContext(botConfig.placeholders);

    // 5) Construir payload JSON compacto (coherente con el diseño previo)
    const payload = {
      MENSAJE_USUARIO,
      TIMEZONE_SISTEMA: tz,
      TIEMPO_LOCAL: localTimeForPrompts,
      TELEFONO_INTERLOCUTOR: interlocutorPhone,
      PACIENTES_ASOCIADOS_AL_INTERLOCUTOR: patients,
      CONTEXTO_PLACEHOLDERS,
      FULL_PLACEHOLDERS_TEXT,
    } as const;

    const userPayloadJSON = JSON.stringify(payload);

    this.logger.info("[ConversationContextService] Contexto construido", {
      patientsCount: patients.length,
      appointmentsCount,
      hasReminderThread,
      hasInterlocutorPhone: !!interlocutorPhone,
      payloadBytes: userPayloadJSON // Buffer.byteLength(userPayloadJSON, "utf8"),
    });

    return {
      systemPrompt: "", // PrimaryBotService inyectará el prompt real desde principal_bot.md
      userPayloadJSON,
      meta: {
        timezone: tz,
        localTimeForPrompts,
        hasReminderThread,
        patientsCount: patients.length,
        appointmentsCount,
      },
    };
  }

  // ---------------------------
  // Helpers
  // ---------------------------

  private async fetchPatientInfoSafe(args: {
    botConfig: BotConfigDTO;
    leadId: number;
    tiempoActualDT: any; // DateTime (Luxon) — se tipa suave para no acoplar aquí
  }): Promise<PatientInfo> {
    try {
      const info = await this.fetchPatientInfoUC.execute(args);
      this.logger.info("[ConversationContextService] Pacientes/citas obtenidos", {
        patients: info.patients?.length || 0,
      });
      return info as PatientInfo;
    } catch (err) {
      this.logger.error("[ConversationContextService] Error en FetchPatientInfoUseCase", err as Error);
      // Fallback seguro: sin pacientes y sin teléfono
      return { patients: [], interlocutorPhone: "" } as unknown as PatientInfo;
    }
  }
}

export default ConversationContextService;