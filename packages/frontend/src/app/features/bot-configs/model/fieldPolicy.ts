import type { BotConfigType } from "@/app/entities/bot-config/types";

export type Field =
  | "clinicId"
  | "timezone"
  | "defaultCountry"
  | "openaiApikey"
  | "kommoSubdomain"
  | "kommoLongLivedToken"
  | "kommoResponsibleUserId"
  | "kommoSalesbotId"
  | "description";

export type FieldPolicy = (ctx: { botType?: BotConfigType }) => Record<Field, boolean>;

/**
 * Politicas de editabilidad para creación
 */
export const canEditCreate: FieldPolicy = ({ botType }) => ({
  clinicId: true,
  timezone: true,
  defaultCountry: true,
  openaiApikey: botType === "chatBot",
  kommoSubdomain: true,
  kommoLongLivedToken: true,
  kommoResponsibleUserId: true,
  kommoSalesbotId: true,
  description: true,
});

/**
 * Politicas de editabilidad para edición
 */
export const canEditEdit: FieldPolicy = ({ botType }) => ({
  clinicId: false, // no editable en edición por ahora
  timezone: true,
  defaultCountry: true,
  openaiApikey: botType === "chatBot",
  kommoSubdomain: true,
  kommoLongLivedToken: true,
  kommoResponsibleUserId: true,
  kommoSalesbotId: true,
  description: true,
});
