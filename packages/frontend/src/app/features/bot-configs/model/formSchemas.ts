// packages/frontend/src/app/features/bot-configs/model/formSchemas.ts

import { z } from "zod";

/**
 * Esquemas de validación para los formularios de BotConfig
 */
export const botConfigTypeSchema = z.enum(["notificationBot", "chatBot"]);

export const baseBotConfigSchema = z.object({
  description: z.string().trim().nullable().optional(),
  kommoSubdomain: z.string().min(1, "Subdominio Kommo requerido"),
  kommoLongLivedToken: z.string().min(1, "Token Kommo requerido"),
  kommoResponsibleUserId: z.number().min(1, "ID Responsable Kommo requerido"),
  kommoSalesbotId: z.string().min(1, "ID Salesbot Kommo requerido"),
  defaultCountry: z.string().min(1, "País requerido"),
  timezone: z.string().min(1, "Zona horaria requerida"),
  isEnabled: z.boolean(),
  fieldsProfile: z.literal("default_kommo_profile"),
  clinicSource: z.literal("legacy"),
  clinicId: z.union([z.string(), z.number()]),
  superClinicId: z.union([z.string(), z.number()]),
});

export const createBotConfigSchema = baseBotConfigSchema.extend({
  botConfigType: botConfigTypeSchema,
  openaiApikey: z.string().nullable().optional().or(z.literal("")),
  placeholders: z.record(z.string()).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.botConfigType === "chatBot") {
    if (!data.openaiApikey || data.openaiApikey.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["openaiApikey"],
        message: "Token OpenAI es obligatorio para chatBot",
      });
    }
  }
});

export const updateBotConfigSchema = baseBotConfigSchema
  .omit({ clinicSource: true, fieldsProfile: true }) // quitamos estos para que no se hagan opcionales
  .partial()
  .extend({
    clinicSource: z.literal("legacy"),                 // siempre "legacy"
    fieldsProfile: z.literal("default_kommo_profile"), // siempre "default_kommo_profile"
    botConfigType: botConfigTypeSchema,
    openaiApikey: z.string().nullable().optional(),
    assistants: z.record(z.string(), z.string()).nullable().optional(),
  });

export const placeholderSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string().nullable().optional(),
});

export const placeholdersArraySchema = z.array(placeholderSchema);
