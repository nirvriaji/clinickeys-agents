// packages/frontend/src/app/features/bot-configs/api/botConfigsApi.ts

import fetchJson from "@/app/shared/lib/fetchJson";
import type { Paginated } from "@/app/shared/types/api";
import type { BotConfig } from "@/app/entities/bot-config/types";
import type {
  CreateBotConfigPayload,
  UpdateBotConfigPayload,
  Placeholder,
} from "@/app/features/bot-configs/model/types";

/** Identificadores compuestos que describen un BotConfig único */
export interface BotIdParams {
  botConfigType: string;
  botConfigId: string;
  clinicSource?: string;
  clinicId: string | number;
}

/** Opciones de paginación para `listBotConfigs` */
export interface ListBotConfigsOptions {
  limit?: number;
  cursor?: string | null;
}

/**
 * Helper interno para construir la ruta de un recurso BotConfig.
 * Ej: /bot-configs/chatBot/123/legacy/456
 */
function getBotConfigPath(
  { botConfigType, botConfigId, clinicSource, clinicId }: BotIdParams,
  opts?: { section?: string },
) {
  let path = `/bot-configs/${botConfigType}/${botConfigId}/${clinicSource}/${clinicId}`;
  if (opts?.section) path += `/${opts.section}`;
  return path;
}

/**
 * Helper interno para construir la ruta de un recurso Bot (alias de acción).
 * Ej: /bots/chatBot/123/legacy/456
 */
function getBotPath(
  { botConfigType, botConfigId, clinicSource, clinicId }: BotIdParams,
  opts?: { section?: string },
) {
  let path = `/bots/${botConfigType}/${botConfigId}/${clinicSource}/${clinicId}`;
  if (opts?.section) path += `/${opts.section}`;
  return path;
}

export const botConfigsApi = {
  /**
   * Lista paginada de BotConfigs (cursor‑based).
   * @example
   * const { items, nextCursor } = await botConfigsApi.listBotConfigs({ limit: 50 });
   */
  async listBotConfigs({ limit, cursor }: ListBotConfigsOptions = {}): Promise<Paginated<BotConfig>> {
    return fetchJson<Paginated<BotConfig>>("/bot-configs", {
      query: {
        ...(limit ? { limit } : {}),
        ...(cursor ? { cursor } : {}),
      },
    });
  },

  /** Obtiene un BotConfig individual */
  async getBotConfig(params: BotIdParams): Promise<BotConfig> {
    return fetchJson<BotConfig>(getBotConfigPath(params));
  },

  /** Crea un nuevo BotConfig */
  async createBotConfig(payload: CreateBotConfigPayload): Promise<BotConfig> {
    return fetchJson<BotConfig>("/bots", {
      method: "POST",
      body: payload,
    });
  },

  /** Actualiza un BotConfig existente */
  async updateBotConfig(params: BotIdParams, payload: UpdateBotConfigPayload): Promise<BotConfig> {
    return fetchJson<BotConfig>(getBotConfigPath(params), {
      method: "PATCH",
      body: payload,
    });
  },

  /** Elimina un BotConfig */
  async deleteBotConfig(params: BotIdParams): Promise<void> {
    await fetchJson<void>(getBotPath(params), {
      method: "DELETE",
    });
  },

  /** Activa / desactiva un Bot */
  async toggleIsEnabled(params: BotIdParams, isEnabled: boolean): Promise<BotConfig> {
    return fetchJson<BotConfig>(getBotPath(params, { section: "enabled" }), {
      method: "PATCH",
      body: { isEnabled },
    });
  },

  /** Obtiene placeholders por defecto (para paso de creación de chatBot) */
  async getDefaultPlaceholders(): Promise<Placeholder[]> {
    return fetchJson<Placeholder[]>("/bot-configs/default-placeholders");
  },
};
