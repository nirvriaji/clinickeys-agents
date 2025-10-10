import { BotConfigDTO, BotConfigType, ChatBotConfigDTO, NotificationBotConfigDTO, IBotConfigRepository } from "@clinickeys-agents/core/domain/botConfig";
import { defaultPlaceholders } from "@clinickeys-agents/core/utils";
import { ulid } from "ulidx";

export interface AddBotInput {
  botConfigType: BotConfigType;
  clinicSource: string;
  superClinicId: number;
  clinicId: number;
  kommoSubdomain: string;
  kommoResponsibleUserId: number;
  kommoLongLivedToken: string;
  kommoSalesbotId: number;
  /**
   * Requerido SOLO para ChatBot. Para NotificationBot se ignora.
   */
  openaiApikey?: string;
  defaultCountry: string;
  timezone: string;
  description: string;
  fieldsProfile: string;
  /**
   * Placeholders iniciales (se fusionan con defaultPlaceholders). Solo aplica a ChatBot.
   */
  placeholders?: Record<string, string>;
}

/**
 * AddBotUseCase (versión Responses API)
 */
export class AddBotUseCase {
  private readonly botConfigRepo: IBotConfigRepository;

  constructor(botConfigRepo: IBotConfigRepository) {
    this.botConfigRepo = botConfigRepo;
  }

  async execute(input: AddBotInput): Promise<BotConfigDTO> {
    const botConfigId = ulid();

    if (input.botConfigType === BotConfigType.ChatBot) {
      // Validación mínima: ChatBot requiere apiKey de OpenAI
      if (!input.openaiApikey) {
        throw new Error("openaiApikey es obligatorio para chatBot");
      }

      const placeholders: Record<string, unknown> = {
        ...defaultPlaceholders,
        ...(input.placeholders ?? {}),
      };

      const toSave: Omit<ChatBotConfigDTO, "pk" | "sk" | "bucket" | "createdAt" | "updatedAt"> = {
        botConfigType: input.botConfigType,
        botConfigId,
        superClinicId: input.superClinicId,
        clinicSource: input.clinicSource,
        clinicId: input.clinicId,
        kommoSubdomain: input.kommoSubdomain,
        kommo: {
          responsibleUserId: input.kommoResponsibleUserId,
          subdomain: input.kommoSubdomain,
          longLivedToken: input.kommoLongLivedToken,
          salesbotId: input.kommoSalesbotId,
        },
        defaultCountry: input.defaultCountry,
        timezone: input.timezone,
        description: input.description,
        fieldsProfile: input.fieldsProfile,
        openai: {
          apiKey: input.openaiApikey,
        },
        placeholders,
        isEnabled: true,
      };

      const savedDto = await this.botConfigRepo.create(toSave);
      return savedDto as BotConfigDTO;
    }

    if (input.botConfigType === BotConfigType.NotificationBot) {
      const toSave: Omit<NotificationBotConfigDTO, "pk" | "sk" | "bucket" | "createdAt" | "updatedAt"> = {
        botConfigType: input.botConfigType,
        botConfigId,
        superClinicId: input.superClinicId,
        clinicSource: input.clinicSource,
        clinicId: input.clinicId,
        kommoSubdomain: input.kommoSubdomain,
        kommo: {
          responsibleUserId: input.kommoResponsibleUserId,
          subdomain: input.kommoSubdomain,
          longLivedToken: input.kommoLongLivedToken,
          salesbotId: input.kommoSalesbotId,
        },
        defaultCountry: input.defaultCountry,
        timezone: input.timezone,
        description: input.description,
        fieldsProfile: input.fieldsProfile,
        isEnabled: true,
      };

      const savedDto = await this.botConfigRepo.create(toSave);
      return savedDto as BotConfigDTO;
    }

    throw new Error("Tipo de botConfigType no soportado en AddBotUseCase");
  }
}

export default AddBotUseCase;