import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { BotConfigService } from "@clinickeys-agents/core/application/services/BotConfigService";
import { BotConfigDTO, BotConfigType } from "@clinickeys-agents/core/domain/botConfig";

export interface GetBotConfigUseCaseDeps {
  botConfigService: BotConfigService;
  logger?: typeof Logger;
}

export class GetBotConfigUseCase {
  private readonly botConfigService: BotConfigService;
  private readonly logger: typeof Logger;

  constructor({ botConfigService, logger = Logger }: GetBotConfigUseCaseDeps) {
    this.botConfigService = botConfigService;
    this.logger = logger;
  }

  /**
   * Obtiene un BotConfig por clave primaria completa.
   * No enriquece ni valida campos faltantes: devuelve lo que esté almacenado.
   */
  async execute(
    botConfigType: BotConfigType,
    botConfigId: string,
    clinicSource: string,
    clinicId: number
  ): Promise<BotConfigDTO | null> {
    this.logger.info("[GetBotConfigUseCase] Fetching bot config", {
      botConfigType,
      botConfigId,
      clinicSource,
      clinicId,
    });

    try {
      const cfg = await this.botConfigService.getBotConfig(
        botConfigType,
        botConfigId,
        clinicSource,
        clinicId
      );

      if (!cfg) {
        this.logger.warn("[GetBotConfigUseCase] BotConfig not found", {
          botConfigType,
          botConfigId,
          clinicSource,
          clinicId,
        });
        return null;
      }

      this.logger.info("[GetBotConfigUseCase] BotConfig retrieved", {
        botConfigType: cfg.botConfigType,
        clinicId: cfg.clinicId,
        clinicSource: cfg.clinicSource,
      });

      return cfg;
    } catch (error) {
      this.logger.error("[GetBotConfigUseCase] Error while fetching bot config", error as Error);
      throw error;
    }
  }
}

export default GetBotConfigUseCase;
