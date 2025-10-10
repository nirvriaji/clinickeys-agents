// packages/frontend/src/app/features/bot-configs/model/formAdapters.ts

import type { BotConfig } from "@/app/entities/bot-config/types";
import type {
  CreateBotConfigPayload,
  UpdateBotConfigPayload,
} from "@/app/features/bot-configs/model/types";

/**
 * Valores por defecto para creación
 */
export function toCreateDefaults(): CreateBotConfigPayload {
  return {
    botConfigType: "chatBot",
    description: "",
    kommoSubdomain: "",
    kommoLongLivedToken: "",
    kommoResponsibleUserId: 0,
    kommoSalesbotId: "",
    defaultCountry: "ES",
    timezone: "Europe/Madrid",
    isEnabled: true,
    fieldsProfile: "default_kommo_profile",
    clinicSource: "legacy",
    clinicId: 0,
    superClinicId: 0,
    openaiApikey: "",
  };
}

/**
 * Adaptar valores iniciales desde BotConfig para edición
 */
export function toEditDefaults(bot: BotConfig): UpdateBotConfigPayload {
  return {
    botConfigType: bot.botConfigType,
    description: bot.description,
    kommoSubdomain: bot.kommo.subdomain,
    kommoLongLivedToken: bot.kommo.longLivedToken,
    kommoResponsibleUserId: bot.kommo.responsibleUserId,
    kommoSalesbotId: String(bot.kommo.salesbotId ?? ""),
    defaultCountry: bot.defaultCountry,
    timezone: bot.timezone,
    isEnabled: bot.isEnabled,
    clinicSource: "legacy",
    fieldsProfile: "default_kommo_profile",
    clinicId: bot.clinicId,
    superClinicId: bot.superClinicId,
    openaiApikey: bot.openai?.apiKey ?? "",
    placeholders: bot.placeholders ?? {},
  };
}

/**
 * Transformar valores del formulario en payload de creación
 */
export function toCreatePayload(values: any): CreateBotConfigPayload {
  return {
    botConfigType: values.botConfigType,
    description: values.description,
    kommoSubdomain: values.kommoSubdomain,
    kommoLongLivedToken: values.kommoLongLivedToken,
    kommoResponsibleUserId: values.kommoResponsibleUserId,
    kommoSalesbotId: values.kommoSalesbotId,
    defaultCountry: values.defaultCountry,
    timezone: values.timezone,
    isEnabled: values.isEnabled,
    fieldsProfile: "default_kommo_profile",
    clinicSource: "legacy",
    clinicId: values.clinicId,
    superClinicId: values.superClinicId,
    openaiApikey: values.openaiApikey,
    placeholders: values.botConfigType === "chatBot" ? values.placeholders : undefined,
  };
}

/**
 * Transformar valores del formulario en payload de edición
 */
export function toEditPayload(values: any, initialData: BotConfig): UpdateBotConfigPayload {
  return {
    botConfigType: values.botConfigType,
    description: values.description,
    kommoSubdomain: values.kommoSubdomain,
    kommoLongLivedToken: values.kommoLongLivedToken,
    kommoResponsibleUserId: values.kommoResponsibleUserId,
    kommoSalesbotId: values.kommoSalesbotId,
    defaultCountry: values.defaultCountry,
    timezone: values.timezone,
    isEnabled: values.isEnabled,
    clinicSource: "legacy",
    fieldsProfile: "default_kommo_profile",
    clinicId: initialData.clinicId,
    superClinicId: initialData.superClinicId,
    openaiApikey: values.openaiApikey,
    placeholders: values.botConfigType === "chatBot" ? values.placeholders : undefined,
  };
}