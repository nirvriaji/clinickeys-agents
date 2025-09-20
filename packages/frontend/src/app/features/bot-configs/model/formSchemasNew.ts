import { z } from "zod";

// ------------------------------------------------------------
// Esquemas Zod para formularios (Create / Edit) de BotConfig
// Incluye placeholders en ambos flujos para que no se descarten
// ------------------------------------------------------------

export const botConfigTypeSchema = z.enum(["notificationBot", "chatBot"]);

// Record utilitario para placeholders (opcional / nullable)
const placeholdersSchema = z.record(z.string()).optional().nullable();

// Record utilitario para assistants (opcional / nullable)
const assistantsSchema = z.record(z.string()).optional().nullable();

// Base con campos comunes. En edición puedes hacer PATCH parcial sobre estos.
// Nota: kommoSalesbotId es string (si la API trae number, conviértelo antes en adapters).
const baseSchema = z.object({
  description: z.string().trim().optional().nullable(),
  kommoSubdomain: z.string().min(1, "Subdominio Kommo requerido"),
  kommoLongLivedToken: z.string().min(1, "Token Kommo requerido"),
  kommoResponsibleUserId: z.number().min(1, "ID Responsable Kommo requerido"),
  kommoSalesbotId: z.string().min(1, "ID Salesbot Kommo requerido"),
  defaultCountry: z.string().min(1, "País requerido"),
  timezone: z.string().min(1, "Zona horaria requerida"),
  isEnabled: z.boolean(),
  clinicId: z.union([z.string(), z.number()]),
  superClinicId: z.union([z.string(), z.number()]),
  clinicSource: z.literal("legacy"),
  fieldsProfile: z.literal("default_kommo_profile"),
  assistants: assistantsSchema,
  placeholders: placeholdersSchema,
});

// ------------------
// CREATE (Wizard)
// ------------------
export const createSchema = baseSchema
  .extend({
    botConfigType: botConfigTypeSchema,
    openaiApikey: z.string().optional().nullable().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
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

// ---------------
// EDIT (Wizard)
// ---------------
// Para edición permitimos parcial (PATCH). Mantenemos literales fijos.
export const editSchema = baseSchema
  .extend({
    botConfigType: botConfigTypeSchema,
    openaiApikey: z.string().optional().nullable(),
  })
  .partial({
    description: true,
    kommoSubdomain: true,
    kommoLongLivedToken: true,
    kommoResponsibleUserId: true,
    kommoSalesbotId: true,
    defaultCountry: true,
    timezone: true,
    isEnabled: true,
    openaiApikey: true,
    assistants: true,
    placeholders: true, // <- MUY IMPORTANTE para que no se descarten
    // clinicId y superClinicId los fija el backend a partir del recurso (o adapters)
  });
