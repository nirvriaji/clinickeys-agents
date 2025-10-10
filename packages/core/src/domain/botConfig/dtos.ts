import { KommoCustomFieldExistence, KommoAccountUser } from "@clinickeys-agents/core/application/services";

export enum BotConfigType {
  NotificationBot = "notificationBot",
  ChatBot = "chatBot",
}

// ========== DTOs para CREACIÓN de Bots ==========

export interface CreateChatBotConfigDTO {
  botConfigType: BotConfigType.ChatBot;
  kommo: {
    subdomain: string;
    longLivedToken: string;
    responsibleUserId: number;
    salesbotId: number;
  };
  kommoSubdomain: string;
  clinicSource: string;
  clinicId: number;
  superClinicId: number;
  openai: {
    apiKey: string;
  };
  defaultCountry: string;
  timezone: string;
  description?: string;
  isEnabled?: boolean;
  fieldsProfile: string;
  placeholders: Record<string, any>;
}

export interface CreateNotificationBotConfigDTO {
  botConfigType: BotConfigType.NotificationBot;
  kommo: {
    subdomain: string;
    longLivedToken: string;
    responsibleUserId: number;
    salesbotId: number;
  };
  kommoSubdomain: string;
  clinicSource: string;
  clinicId: number;
  superClinicId: number;
  defaultCountry: string;
  timezone: string;
  description?: string;
  isEnabled?: boolean;
  fieldsProfile: string;
}

// ========== DTOs para LECTURA (persistidos en Dynamo) ==========

type BaseBotConfigDTO = {
  pk: string;
  sk: string;
  bucket: number;
  botConfigId: string;
  clinicSource: string;
  clinicId: number;
  superClinicId: number;
  kommoSubdomain: string;
  kommo: {
    subdomain: string;
    longLivedToken: string;
    responsibleUserId: number;
    salesbotId: number;
  };
  defaultCountry: string;
  timezone: string;
  description?: string;
  isEnabled?: boolean;
  fieldsProfile: string;
  createdAt: number;
  updatedAt: number;
  placeholders?: Record<string, any>;
};

export type ChatBotConfigDTO = BaseBotConfigDTO & {
  botConfigType: BotConfigType.ChatBot;
  openai: {
    apiKey: string;
  };
};

export type NotificationBotConfigDTO = BaseBotConfigDTO & {
  botConfigType: BotConfigType.NotificationBot;
  openai?: undefined;
};

export type BotConfigDTO = ChatBotConfigDTO | NotificationBotConfigDTO;

export type BotConfigEnrichedDTO = BotConfigDTO & {
  kommoLeadsCustomFields: KommoCustomFieldExistence[];
  isReady: boolean;
};