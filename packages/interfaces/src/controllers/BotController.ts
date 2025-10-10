import { BotConfigDTO, BotConfigType } from "@clinickeys-agents/core/domain/botConfig";
import {
  AddBotUseCase,
  DeleteBotUseCase,
  UpdateBotConfigUseCase,
  GetBotConfigUseCase,
  ListGlobalBotConfigsUseCase,
  type AddBotInput,
  type UpdateBotConfigInput,
  type ListGlobalBotConfigsInput,
} from "@clinickeys-agents/core/application/usecases";

export interface BotControllerProps {
  addUseCase: AddBotUseCase;
  deleteUseCase: DeleteBotUseCase;
  updateUseCase: UpdateBotConfigUseCase;
  getUseCase: GetBotConfigUseCase;
  listGlobalUseCase: ListGlobalBotConfigsUseCase;
}

/**
 * BotController
 *
 * Capa delgada de orquestación para exponer los casos de uso de configuración de bots
 * a los handlers HTTP. No contiene lógica de negocio.
 */
export class BotController {
  private readonly addUseCase: AddBotUseCase;
  private readonly deleteUseCase: DeleteBotUseCase;
  private readonly updateUseCase: UpdateBotConfigUseCase;
  private readonly getUseCase: GetBotConfigUseCase;
  private readonly listGlobalUseCase: ListGlobalBotConfigsUseCase;

  constructor(props: BotControllerProps) {
    this.addUseCase = props.addUseCase;
    this.deleteUseCase = props.deleteUseCase;
    this.updateUseCase = props.updateUseCase;
    this.getUseCase = props.getUseCase;
    this.listGlobalUseCase = props.listGlobalUseCase;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CHAT BOT (config + creación de artefactos OpenAI si aplica)
  // ───────────────────────────────────────────────────────────────────────────
  addChatBot(input: AddBotInput): Promise<BotConfigDTO> {
    // El AddBotUseCase valida y crea tanto la config como los artefactos necesarios
    return this.addUseCase.execute({ ...input, botConfigType: BotConfigType.ChatBot });
  }

  deleteChatBot(botConfigId: string, clinicSource: string, clinicId: number): Promise<void> {
    return this.deleteUseCase.execute({
      botConfigType: BotConfigType.ChatBot,
      botConfigId,
      clinicSource,
      clinicId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // NOTIFICATION BOT (solo registro de config)
  // ───────────────────────────────────────────────────────────────────────────
  addNotificationBot(input: AddBotInput): Promise<BotConfigDTO> {
    return this.addUseCase.execute({ ...input, botConfigType: BotConfigType.NotificationBot });
  }

  deleteNotificationBot(botConfigId: string, clinicSource: string, clinicId: number): Promise<void> {
    return this.deleteUseCase.execute({
      botConfigType: BotConfigType.NotificationBot,
      botConfigId,
      clinicSource,
      clinicId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // BOT-CONFIG (lectura / actualización)
  // ───────────────────────────────────────────────────────────────────────────
  updateBotConfig(input: UpdateBotConfigInput): Promise<void> {
    return this.updateUseCase.execute(input);
  }

  getBotConfig(
    botConfigType: BotConfigType,
    botConfigId: string,
    clinicSource: string,
    clinicId: number,
  ): Promise<BotConfigDTO | null> {
    return this.getUseCase.execute(botConfigType, botConfigId, clinicSource, clinicId);
  }

  listGlobalBotConfigs(input: ListGlobalBotConfigsInput) {
    return this.listGlobalUseCase.execute(input);
  }
}

export default BotController;