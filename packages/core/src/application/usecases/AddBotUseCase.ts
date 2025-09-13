// packages/core/src/application/usecases/AddBotUseCase.ts

import { BotConfigDTO, BotConfigType, ChatBotConfigDTO, NotificationBotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";
import { defaultPlaceholders, generateInstructionsRaw } from "@clinickeys-agents/core/utils";
import { IOpenAIAssistantRepository } from "@clinickeys-agents/core/domain/openai";
import { IBotConfigRepository } from "@clinickeys-agents/core/domain/botConfig";
import { ulid } from "ulidx";
import path from "path";
import fs from "fs";

export interface AddBotInput {
  botConfigType: BotConfigType;
  clinicSource: string;
  superClinicId: number;
  clinicId: number;
  kommoSubdomain: string;
  kommoResponsibleUserId: number;
  kommoLongLivedToken: string;
  kommoSalesbotId: number;
  openaiApikey?: string;
  defaultCountry: string;
  timezone: string;
  description: string;
  fieldsProfile: string;
  placeholders?: Record<string, string>;
}

export class AddBotUseCase {
  private readonly botConfigRepo: IBotConfigRepository;
  private readonly openaiRepoFactory: (apiKey: string) => IOpenAIAssistantRepository;

  constructor(
    botConfigRepo: IBotConfigRepository,
    openaiRepoFactory: (apiKey: string) => IOpenAIAssistantRepository
  ) {
    this.botConfigRepo = botConfigRepo;
    this.openaiRepoFactory = openaiRepoFactory;
  }

  async execute(input: AddBotInput): Promise<BotConfigDTO> {
    const botConfigId = ulid();

    if (input.botConfigType === BotConfigType.ChatBot) {
      if (!input.openaiApikey) {
        throw new Error("openaiApikey es obligatorio para chatBot");
      }

      const placeholders: Record<string, string> = { ...defaultPlaceholders, ...(input.placeholders || {}) };

      const templateDir = path.resolve(__dirname, "packages/core/src/.ia/instructions/templates");
      const assistantFiles = fs.readdirSync(templateDir).filter((file) => file.endsWith(".md"));
      if (assistantFiles.length === 0) {
        throw new Error("No hay templates .md disponibles para crear assistants.");
      }

      const assistants: ChatBotConfigDTO["openai"]["assistants"] = {} as ChatBotConfigDTO["openai"]["assistants"];
      if (!assistants) {
        throw new Error("Error al inicializar assistants");
      }

      const openaiRepo = this.openaiRepoFactory(input.openaiApikey);

      for (const fileName of assistantFiles) {
        const assistantKey = path.basename(fileName, ".md");
        // Usamos generateInstructionsRaw para dejar los placeholders intactos
        const instructionText = generateInstructionsRaw(assistantKey);
        const assistant = await openaiRepo.createAssistant({
          name: assistantKey,
          instructions: instructionText,
          top_p: 0.01,
          temperature: 0.01,
        });
        assistants[assistantKey] = assistant.id;
      }

      if (!assistants.speakingBot) {
        throw new Error("El assistant 'speakingBot' es obligatorio en ChatBot");
      }

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
          assistants,
        },
        placeholders,
        isEnabled: true,
      };

      const savedDto = await this.botConfigRepo.create(toSave);
      return savedDto;
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
      return savedDto;
    }

    throw new Error("Tipo de botConfigType no soportado en AddBotUseCase");
  }
}
