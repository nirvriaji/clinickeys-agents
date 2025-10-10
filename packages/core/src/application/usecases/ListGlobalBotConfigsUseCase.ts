import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { BotConfigService } from "@clinickeys-agents/core/application/services/BotConfigService";
import type { BotConfigEnrichedDTO } from "@clinickeys-agents/core/domain/botConfig";

export interface ListGlobalBotConfigsInput {
  /** Máximo de items a devolver (default: 100) */
  limit?: number;
  /** Cursor para paginación. Puede venir como objeto (ExclusiveStartKey) o string ya serializado. */
  cursor?: Record<string, any> | string;
}

export interface ListGlobalBotConfigsOutput {
  items: BotConfigEnrichedDTO[];
  nextCursor?: string;
}

export class ListGlobalBotConfigsUseCase {
  constructor(
    private readonly deps: { botConfigService: BotConfigService; logger?: typeof Logger },
  ) {}

  public async execute(input: ListGlobalBotConfigsInput): Promise<ListGlobalBotConfigsOutput> {
    const logger = this.deps.logger ?? Logger;

    try {
      const limit = Number.isFinite(input?.limit as number) && (input!.limit as number) > 0
        ? (input!.limit as number)
        : 100;

      // Normalizar cursor a string (el servicio/infra lo espera así)
      let cursorStr: string | undefined = undefined;
      if (typeof input?.cursor === "string") {
        cursorStr = input.cursor as string;
      } else if (input?.cursor && typeof input.cursor === "object") {
        try {
          cursorStr = JSON.stringify(input.cursor);
        } catch {
          // Si no se puede serializar, ignoramos el cursor para no romper la lista
          cursorStr = undefined;
        }
      }

      logger.info("[ListGlobalBotConfigsUseCase] Listando configs globales", {
        limit,
        hasCursor: !!cursorStr,
      });

      const { items, nextCursor } = await this.deps.botConfigService.listGlobal(limit, cursorStr);

      logger.info("[ListGlobalBotConfigsUseCase] Resultado", {
        count: items.length,
        hasNext: !!nextCursor,
      });

      return { items, nextCursor };
    } catch (error) {
      const msg = (error as any)?.message || String(error);
      (this.deps.logger ?? Logger).error("[ListGlobalBotConfigsUseCase] Error", { error: msg });
      throw error;
    }
  }
}

export default ListGlobalBotConfigsUseCase;