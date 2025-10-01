// packages/core/src/application/services/AvailabilityResponseRedactorService.ts

import { type HorarioEscogido } from "@clinickeys-agents/core/domain/availability";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import { readFile } from "fs/promises";
import path from "path";
import { z } from "zod";

// =============================
// Prompt caching (robusto)
// =============================
let cachedSystemPrompt: string | null = null;

async function loadSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;

  const promptsPath = path.resolve(
    __dirname,
    "packages/core/src/.ia/instructions/prompts/bot_redactor_disponibilidades.md"
  );

  try {
    const content = await readFile(promptsPath, "utf8");
    cachedSystemPrompt = content;
    Logger.info("[AvailabilityResponseRedactorService] Prompt cargado", { promptsPath });
    return cachedSystemPrompt;
  } catch {
    Logger.error(
      "[AvailabilityResponseRedactorService] No se pudo leer el .md del prompt; usando fallback inline"
    );
    cachedSystemPrompt = [
      "Asistente Redactor de Disponibilidades.",
      "Recibes SLOTS_SELECCIONADOS (0–3) y ASISTENTE_AGENDA_CONFIG.",
      "Construye un único JSON { mensaje: string, metadata?: object }.",
      "No filtras ni ordenas; respetas el orden de entrada.",
      "Horas en 24h HH:mm; sin IDs visibles; sin Markdown ni texto fuera de JSON.",
    ].join("\n");
    return cachedSystemPrompt;
  }
}

// =============================
// Schema de salida (validación)
// =============================
const JsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValue), z.record(JsonValue)])
);

const FinalRedactionSchema = z.object({
  mensaje: z.string().min(1, "El mensaje no puede estar vacío"),
  metadata: z.record(z.string(), JsonValue).nullish(),
});

export type FinalRedaction = z.infer<typeof FinalRedactionSchema>;

// =============================
// Helpers
// =============================
function normalizeBlock(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function toHHmm(hhmmOrHHmmss?: string | null): string {
  if (!hhmmOrHHmmss) return "";
  const m = /^(\d{2}:\d{2})(?::\d{2})?$/.exec(hhmmOrHHmmss);
  return m ? m[1] : hhmmOrHHmmss;
}

// =============================
// Main function
// =============================
export async function AvailabilityResponseRedactorService(
  openAIService: IOpenAIService,
  horariosEscogidos: HorarioEscogido[],
  asistenteAgendaConfig: string | Record<string, unknown>,
  extras?: { ahoraISO?: string; timezone?: string; contextoRedactor?: Record<string, unknown> }
): Promise<FinalRedaction> {
  const systemPrompt = await loadSystemPrompt();

  const safeSlots: HorarioEscogido[] = Array.isArray(horariosEscogidos) ? horariosEscogidos : [];
  const configBlock = normalizeBlock(asistenteAgendaConfig);
  const contextoRedactorBlock = extras?.contextoRedactor ? normalizeBlock(extras.contextoRedactor) : "";

  const parts: string[] = [];
  parts.push(`ASISTENTE_AGENDA_CONFIG:\n${configBlock}`);
  if (contextoRedactorBlock) parts.push(`CONTEXTO_REDACTOR:\n${contextoRedactorBlock}`);
  parts.push(`SLOTS_SELECCIONADOS:\n${JSON.stringify(safeSlots, null, 2)}`);
  if (extras?.ahoraISO) parts.push(`AHORA_LOCAL_ISO: ${extras.ahoraISO}`);
  if (extras?.timezone) parts.push(`TIMEZONE: ${extras.timezone}`);

  const userPrompt = parts.join("\n\n");

  Logger.info("[AvailabilityResponseRedactorService] Iniciando redacción final", {
    slotsCount: safeSlots.length,
    hasContextoRedactor: Boolean(extras?.contextoRedactor),
  });

  try {
    const result = await openAIService.getSchemaStructuredResponse(
      systemPrompt,
      userPrompt,
      FinalRedactionSchema,
      "FinalRedactionSchema",
      "gpt-4o-mini"
    );

    if (!result || typeof (result as any).mensaje !== "string" || !(result as any).mensaje.trim()) {
      Logger.warn(
        "[AvailabilityResponseRedactorService] Respuesta vacía o inválida del LLM; usando fallback"
      );
      return fallbackMessage(safeSlots);
    }

    const mensaje = String((result as any).mensaje).trim();
    const metadata = (result as any).metadata;

    Logger.info("[AvailabilityResponseRedactorService] Redacción generada con éxito", {
      mensajePreview: mensaje.slice(0, 160),
    });

    return { mensaje, metadata };
  } catch (error) {
    Logger.error("[AvailabilityResponseRedactorService] Error al generar redacción final:", error);
    return fallbackMessage(safeSlots);
  }
}

// =============================
// Fallback local (sin LLM)
// =============================
function fallbackMessage(slots: HorarioEscogido[]): FinalRedaction {
  if (!slots || slots.length === 0) {
    Logger.info("[AvailabilityResponseRedactorService] Fallback sin slots");
    return {
      mensaje:
        "Por ahora no encontré horarios disponibles cerca de las fechas indicadas. ¿Te gustaría que busque en otros días u horarios?",
      metadata: { fallback: true, slots: 0 },
    };
  }

  const lines = slots.slice(0, 3).map((s, idx) => {
    const fecha = (s as any).fecha_legible || s.fecha_cita || "";
    const hora = (s as any).hora_inicio || (s as any).hora || "";
    const medico = (s as any).nombre_medico || (s as any).medico?.nombre_medico || (s as any).medico || "";
    const espacio = (s as any).nombre_espacio || (s as any).espacio?.nombre_espacio || (s as any).espacio || "";
    const partes: string[] = [];
    if (fecha) partes.push(`${fecha}`);
    if (hora) partes.push(`${hora}`);
    if (medico) partes.push(`${medico}`);
    if (espacio) partes.push(`${espacio}`);
    const texto = partes.filter(Boolean).join(" • ");
    return `${idx + 1}. ${texto}`;
  });

  Logger.info("[AvailabilityResponseRedactorService] Fallback con slots disponibles", {
    opciones: lines,
  });

  return {
    mensaje: [
      "Aquí tienes las opciones disponibles:",
      ...lines,
      "¿Alguna de estas te acomoda?",
    ].join("\n"),
    metadata: { fallback: true, slots: slots.length },
  };
}