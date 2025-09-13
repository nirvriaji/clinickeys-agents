// packages/core/src/interface/controllers/BotController.ts

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

  // --- CHAT BOT (config + assistants) --------------------------------------
  addChatBot(input: AddBotInput): Promise<BotConfigDTO> {
    // Aquí se asume que input ya es validado y corresponde a chatBot
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

  // --- NOTIFICATION BOT (sólo registro) -----------------------------------
  addNotificationBot(input: AddBotInput): Promise<BotConfigDTO> {
    // Aquí se asume que input ya es validado y corresponde a notificationBot
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

  // --- BOT-CONFIG (sólo configuración) -------------------------------------
  updateBotConfig(input: UpdateBotConfigInput): Promise<void> {
    return this.updateUseCase.execute(input);
  }

  getBotConfig(
    botConfigType: BotConfigType,
    botConfigId: string,
    clinicSource: string,
    clinicId: number
  ): Promise<BotConfigDTO | null> {
    return this.getUseCase.execute(botConfigType, botConfigId, clinicSource, clinicId);
  }

  listGlobalBotConfigs(input: ListGlobalBotConfigsInput) {
    return this.listGlobalUseCase.execute(input);
  }
}
