import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import {
  IBotConfigRepository,
  BotConfigType,
} from "@clinickeys-agents/core/domain/botConfig";

export interface DeleteBotInput {
  botConfigType: BotConfigType;
  botConfigId: string;
  clinicSource: string;
  clinicId: number;
}

interface DeleteBotDeps {
  botConfigRepo: IBotConfigRepository;
}

/**
 * DeleteBotUseCase
 */
export class DeleteBotUseCase {
  private readonly repo: IBotConfigRepository;

  constructor({ botConfigRepo }: DeleteBotDeps) {
    this.repo = botConfigRepo;
  }

  public async execute(input: DeleteBotInput): Promise<void> {
    const { botConfigType, botConfigId, clinicSource, clinicId } = input;

    Logger.info("[DeleteBotUseCase] Inicio", {
      botConfigType,
      botConfigId,
      clinicSource,
      clinicId,
    });

    try {
      // Opcional: verificar existencia para logs claros (no bloqueante)
      try {
        const existing = await this.repo.findByPrimaryKey(
          botConfigType,
          botConfigId,
          clinicSource,
          clinicId
        );
        if (!existing) {
          Logger.warn("[DeleteBotUseCase] BotConfig no encontrado; nada que borrar", {
            botConfigType,
            botConfigId,
            clinicSource,
            clinicId,
          });
          return; // idempotente
        }
      } catch (lookupErr) {
        // Si falla la lectura, continuamos al delete de todas formas (mejor esfuerzo)
        Logger.warn("[DeleteBotUseCase] Falló lookup previo; se intentará borrar igualmente", {
          error: lookupErr,
        });
      }

      await this.repo.delete(botConfigType, botConfigId, clinicSource, clinicId);

      Logger.info("[DeleteBotUseCase] Eliminado con éxito", {
        botConfigType,
        botConfigId,
        clinicSource,
        clinicId,
      });
    } catch (error) {
      Logger.error("[DeleteBotUseCase] Error eliminando BotConfig", { error });
      throw error;
    }
  }
}

export default DeleteBotUseCase;