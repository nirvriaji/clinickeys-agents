// packages/core/src/application/services/AvailabilityResponseRedactorService.ts

import { SlotDisponibilidad } from "@clinickeys-agents/core/domain/availability";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { readFile } from "fs/promises";
import path from "path";
import { z } from "zod";

// =============================
// Prompt caching
// =============================
let cachedSystemPrompt: string | null = null;

async function loadSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;

  const promptsPath = path.resolve(
    __dirname,
    "packages/core/src/.ia/instructions/prompts/bot_redactor_disponibilidades.md"
  );

  try {
    cachedSystemPrompt = await readFile(promptsPath, "utf8");
    Logger.info("[AvailabilityResponseRedactorService] Prompt cargado desde archivo .md");
    return cachedSystemPrompt;
  } catch (err) {
    Logger.error(
      "[AvailabilityResponseRedactorService] No se pudo leer el .md del prompt; usando fallback inline",
      err
    );
    cachedSystemPrompt = [
      "Eres un redactor de disponibilidades médicas.",
      "Recibes una lista de 0 a 3 SLOTS_SELECCIONADOS (cada uno con fecha/hora, médico, espacio y metadatos)",
      "y una CONFIGURACION_DE_DISPONIBILIDADES que define criterios, tono y formato.",
      "Tu salida debe ser un JSON válido con el siguiente schema:",
      "{ mensaje: string, metadata?: object }",
      "Reglas:",
      "- Si no hay slots, responde con un mensaje empático indicando que no hay horarios en las fechas cercanas y proponiendo alternativas.",
      "- Si hay 1–3 slots, preséntalos de forma clara y breve (puntos o líneas cortas).",
      "- Respeta tono/formato de CONFIGURACION_DE_DISPONIBILIDADES (por ejemplo, orden, etiquetas, emojis permitidos, etc.).",
      "- No inventes horarios ni datos.",
    ].join("\n");
    return cachedSystemPrompt;
  }
}

// =============================
// Schema de salida (validación mejorada)
// =============================
// JSON genérico seguro (sin recurrir a any) y permitiendo null/undefined en metadata
const JsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValue), z.record(JsonValue)])
);

const FinalRedactionSchema = z.object({
  mensaje: z.string().min(1, "El mensaje no puede estar vacío"),
  metadata: z.record(z.string(), JsonValue).nullish(),
});

export type FinalRedaction = z.infer<typeof FinalRedactionSchema>;

// =============================
// Helper: normalizar contexto
// =============================
function normalizeContext(contexto: unknown): string {
  if (typeof contexto === "string") return contexto;
  try {
    return JSON.stringify(contexto ?? {}, null, 2);
  } catch {
    return String(contexto ?? "");
  }
}

// =============================
// Main function
// =============================
export async function AvailabilityResponseRedactorService(
  openAIService: IOpenAIService,
  slotsSeleccionados: SlotDisponibilidad[],
  configuracionDisponibilidades: string | Record<string, unknown>,
  extras?: { ahoraISO?: string; timezone?: string }
): Promise<FinalRedaction> {
  const systemPrompt = await loadSystemPrompt();

  const safeSlots: SlotDisponibilidad[] = Array.isArray(slotsSeleccionados)
    ? slotsSeleccionados
    : [];

  const contexto = normalizeContext(configuracionDisponibilidades);

  const userPrompt = [
    `CONFIGURACION_DE_DISPONIBILIDADES:\n${contexto}`,
    `SLOTS_SELECCIONADOS:\n${JSON.stringify(safeSlots, null, 2)}`,
    extras?.ahoraISO ? `AHORA_LOCAL_ISO: ${extras.ahoraISO}` : "",
    extras?.timezone ? `TIMEZONE: ${extras.timezone}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  Logger.info("[AvailabilityResponseRedactorService] Iniciando redacción final", {
    slotsCount: safeSlots.length,
    // configuracion: contexto,
    userPrompt,
  });

  try {
    const result = await openAIService.getSchemaStructuredResponse(
      systemPrompt,
      userPrompt,
      FinalRedactionSchema,
      "FinalRedactionSchema"
    );

    if (!result || typeof result.mensaje !== "string" || !result.mensaje.trim()) {
      Logger.warn(
        "[AvailabilityResponseRedactorService] Respuesta vacía o inválida del LLM; usando fallback"
      );
      return fallbackMessage(safeSlots);
    }

    Logger.info("[AvailabilityResponseRedactorService] Redacción generada con éxito", {
      mensaje: result.mensaje,
      metadata: result.metadata,
    });

    return {
      mensaje: result.mensaje.trim(),
      metadata: result.metadata,
    };
  } catch (error) {
    Logger.error(
      "[AvailabilityResponseRedactorService] Error al generar redacción final:",
      error
    );
    return fallbackMessage(safeSlots);
  }
}

// =============================
// Fallback local (sin LLM)
// =============================
function fallbackMessage(slots: SlotDisponibilidad[]): FinalRedaction {
  if (!slots || slots.length === 0) {
    Logger.info("[AvailabilityResponseRedactorService] Fallback sin slots");
    return {
      mensaje:
        "Por ahora no encontré horarios disponibles cerca de las fechas indicadas. ¿Te gustaría que busque en otros días u horarios?",
      metadata: { fallback: true, slots: 0 },
    };
  }

  const lines = slots.slice(0, 3).map((s, idx) => {
    const fecha = (s as any).fecha_inicio || (s as any).fecha || "";
    const hora = (s as any).hora_inicio || (s as any).hora || "";
    const medico = (s as any).medico?.nombre_medico || (s as any).medico || "";
    const espacio = (s as any).espacio?.nombre_espacio || (s as any).espacio || "";
    const partes: string[] = [];
    if (fecha) partes.push(`${fecha}`);
    if (hora) partes.push(`${hora}`);
    if (medico) partes.push(`${medico}`);
    if (espacio) partes.push(`${espacio}`);
    const texto = partes.filter(Boolean).join(" • ");
    return `${idx + 1}. ${texto}`;
  });

  Logger.info("[AvailabilityResponseRedactorService] Fallback con slots disponibles", { opciones: lines });

  return {
    mensaje: [
      "Aquí tienes las opciones disponibles:",
      ...lines,
      "¿Alguna de estas te acomoda?",
    ].join("\n"),
    metadata: { fallback: true, slots: slots.length },
  };
}
