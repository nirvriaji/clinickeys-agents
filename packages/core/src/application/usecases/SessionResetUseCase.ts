import { KommoService } from "@clinickeys-agents/core/application/services";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import type { BotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";
import type { KommoCustomFieldValueBase } from "@clinickeys-agents/core/infrastructure/integrations/kommo";

import {
  buildPreFlightPatch,
  buildRenderingPhasePatch,
  buildPostFlightPatch,
  buildLightClosePatch,
  toLeadFieldMap,
  isSameSession,
} from "@clinickeys-agents/core/utils";

import {
  SESSION_ID,
  SESSION_SEQ,
  SESSION_PHASE,
  PHASE_ACTIVE,
  CONVERSATION_LAST_ACTIVE_MS,
} from "@clinickeys-agents/core/utils";

export interface SessionResetPreFlightInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: unknown })[];
}

export interface SessionResetPreFlightOutput {
  success: boolean;
  sessionId: string;
  sessionSeq: string;
}

export interface SessionRenderingPhaseInput {
  botConfig: BotConfigDTO;
  leadId: number;
}

export interface SessionPostFlightInput {
  botConfig: BotConfigDTO;
  leadId: number;
}

/**
 * Gestión de sesión y limpieza de CF con reglas:
 * - Reset temporal: si han pasado >= 24h desde el último activity.
 * - Cierre ligero cuando NO hay reset temporal (conserva efímeros),
 *   solo marca IDLE y actualiza lastActive.
 *
 * Nota: Ya NO existe el criterio de "herramienta crítica" para forzar full reset.
 */
export class SessionResetUseCase {
  private readonly kommoService: KommoService;
  private static readonly RESET_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

  constructor(kommoService: KommoService) {
    this.kommoService = kommoService;
  }

  // --------------------
  // PRE-FLIGHT
  // --------------------
  public async preFlight(
    input: SessionResetPreFlightInput
  ): Promise<SessionResetPreFlightOutput> {
    const { botConfig, leadId, normalizedLeadCF } = input;

    Logger.info("[SessionResetUseCase.preFlight] Inicio", { leadId });

    const leadMap = toLeadFieldMap(normalizedLeadCF);
    const prevSeq = leadMap[SESSION_SEQ] || "";

    const nowMs = Date.now();
    const lastActiveStr = leadMap[CONVERSATION_LAST_ACTIVE_MS] || "0";
    const lastActiveMs = Number(lastActiveStr) || 0;
    const shouldTimeReset = nowMs - lastActiveMs >= SessionResetUseCase.RESET_WINDOW_MS;

    if (shouldTimeReset) {
      // Limpieza completa + nueva sesión (sin Salesbot)
      const patch = buildPreFlightPatch({ prevSessionSeq: prevSeq });
      await this.kommoService.updateLeadCustomFields({ botConfig, leadId, customFields: patch });

      // Verificar barrera de sesión (anti-race)
      const latest = await this.kommoService.getLeadById(leadId);
      const latestMap: Record<string, string> = {};
      for (const cf of latest?.custom_fields || []) {
        latestMap[cf.field_name] = cf.value == null ? "" : String(cf.value);
      }

      const sessionId = patch[SESSION_ID];
      const sessionSeq = patch[SESSION_SEQ];
      const ok = isSameSession(latestMap, sessionId);
      if (!ok) {
        Logger.warn("[SessionResetUseCase.preFlight] Abortado por race: sessionId no coincide", {
          leadId,
          expected: sessionId,
          got: latestMap[SESSION_ID] || "",
        });
        return { success: false, sessionId: "", sessionSeq: "" };
      }

      Logger.info("[SessionResetUseCase.preFlight] Listo (time reset)", { leadId, sessionId, sessionSeq });
      return { success: true, sessionId, sessionSeq };
    }

    // No hay reset temporal → abrir sesión (fase ACTIVE) sin limpiar efímeros
    const minimalPatch: Record<string, string> = {
      [SESSION_PHASE]: PHASE_ACTIVE,
      // No tocamos CONVERSATION_LAST_ACTIVE_MS aquí para conservar histograma fino de actividad
      // (se actualiza en postFlight con cierre ligero)
    };
    await this.kommoService.updateLeadCustomFields({ botConfig, leadId, customFields: minimalPatch });

    const sessionId = leadMap[SESSION_ID] || "";
    const sessionSeq = leadMap[SESSION_SEQ] || "";
    Logger.info("[SessionResetUseCase.preFlight] Listo (sin reset)", { leadId, sessionId, sessionSeq });
    return { success: true, sessionId, sessionSeq };
  }

  // --------------------
  // RENDERING PHASE
  // --------------------
  public async markRenderingPhase(input: SessionRenderingPhaseInput): Promise<{ success: boolean }> {
    const { botConfig, leadId } = input;
    Logger.info("[SessionResetUseCase.markRenderingPhase] Inicio", { leadId });

    const patch = buildRenderingPhasePatch();
    await this.kommoService.updateLeadCustomFields({ botConfig, leadId, customFields: patch });

    Logger.info("[SessionResetUseCase.markRenderingPhase] Listo", { leadId });
    return { success: true };
  }

  // --------------------
  // POST-FLIGHT
  // --------------------
  public async postFlight(input: SessionPostFlightInput): Promise<{ success: boolean }> {
    const { botConfig, leadId } = input;
    Logger.info("[SessionResetUseCase.postFlight] Inicio", { leadId });

    // Re-evaluar reset temporal respecto al LAST_ACTIVE antes de cerrar
    const latest = await this.kommoService.getLeadById(leadId);
    let lastActiveMs = 0;
    for (const cf of latest?.custom_fields || []) {
      if (cf.field_name === CONVERSATION_LAST_ACTIVE_MS) {
        lastActiveMs = Number(cf.value) || 0;
        break;
      }
    }
    const nowMs = Date.now();
    const shouldTimeReset = nowMs - lastActiveMs >= SessionResetUseCase.RESET_WINDOW_MS;

    if (shouldTimeReset) {
      // Limpieza completa + cierre (sin Salesbot), dejando lastActive ahora
      const patch = buildPostFlightPatch();
      await this.kommoService.updateLeadCustomFields({ botConfig, leadId, customFields: patch });
      Logger.info("[SessionResetUseCase.postFlight] Listo (full reset)", { leadId });
      return { success: true };
    }

    // Cierre ligero: mantener efímeros, solo marcar IDLE y actualizar lastActive
    const lightPatch = buildLightClosePatch();
    await this.kommoService.updateLeadCustomFields({ botConfig, leadId, customFields: lightPatch });

    Logger.info("[SessionResetUseCase.postFlight] Listo (light close)", { leadId });
    return { success: true };
  }
}