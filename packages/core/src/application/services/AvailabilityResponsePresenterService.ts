// packages/core/src/application/services/AvailabilityResponsePresenterService.ts

import { PresentacionYDisponibilidades, PresentacionYDisponibilidadesSchema } from "@clinickeys-agents/core/domain/availability";
import { SlotDisponibilidad } from "@clinickeys-agents/core/domain/availability";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import { readFile } from "fs/promises";
import path from "path";

// =============================
// Prompt caching
// =============================

let cachedSystemPrompt: string | null = null;

async function loadSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;

  const promptsPath = path.resolve(
    __dirname,
    "packages/core/src/.ia/instructions/prompts/bot_presentador_disponibilidades.md"
  );

  try {
    cachedSystemPrompt = await readFile(promptsPath, "utf8");
    Logger.info("[AvailabilityResponsePresenterService] Prompt cargado desde archivo .md");
    return cachedSystemPrompt;
  } catch (err) {
    Logger.error(
      "[AvailabilityResponsePresenterService] No se pudo leer el .md del prompt; usando fallback inline",
      err
    );
    cachedSystemPrompt =
      "Eres un presentador de disponibilidades médicas.\n" +
      "Recibirás un array de disponibilidades y un conjunto de restricciones.\n" +
      "Debes filtrar, ordenar y luego generar un texto para el paciente con las reglas definidas.\n" +
      "Responde siempre en JSON cumpliendo el schema indicado.";
    return cachedSystemPrompt;
  }
}

// =============================
// Helpers
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

export async function AvailabilityResponsePresenterService(
  openAIService: IOpenAIService,
  raw_disponibilidades: SlotDisponibilidad[],
  contexto: string
): Promise<PresentacionYDisponibilidades> {
  const systemPrompt = await loadSystemPrompt();

  const contextoBlock = normalizeContext(contexto);

  const userPrompt = `CONFIGURACION_DE_DISPONIBILIDADES:\n\nCONTEXTO:\n${contextoBlock}\n\nDISPONIBILIDADES_ORIGINALES:\n${JSON.stringify(
    raw_disponibilidades,
    null,
    2
  )}`;

  Logger.info("[AvailabilityResponsePresenterService] Iniciando con datos", {
    totalDisponibilidades: Array.isArray(raw_disponibilidades) ? raw_disponibilidades.length : 0,
    // contexto: contextoBlock, // dejar comentado para evitar logs excesivos
  });

  try {
    const result = await openAIService.getSchemaStructuredResponse(
      systemPrompt,
      userPrompt,
      PresentacionYDisponibilidadesSchema,
      "PresentacionYDisponibilidadesSchema"
    );

    const {
      presentacion,
      disponibilidades,
      disclaimer_fechas,
      dias_mostrados,
      criterio_orden,
      metadata,
    } = result as PresentacionYDisponibilidades;

    Logger.info("[AvailabilityResponsePresenterService] Respuesta del presentador recibida", {
      presentacion_ok: typeof presentacion === "string" && presentacion.length > 0,
      disponibilidadesCount: Array.isArray(disponibilidades) ? disponibilidades.length : 0,
      dias_mostrados: Array.isArray(dias_mostrados) ? dias_mostrados : [],
      criterio_orden,
    });

    // Validaciones mínimas de seguridad
    if (typeof presentacion !== "string" || !presentacion.trim()) {
      Logger.warn(
        "[AvailabilityResponsePresenterService] Respuesta sin 'presentacion' válida; devolviendo fallback"
      );
      return {
        presentacion: "Lo siento, no encontré horarios que cumplan tus preferencias.",
        disponibilidades: [],
        disclaimer_fechas: disclaimer_fechas ?? null,
        dias_mostrados: Array.isArray(dias_mostrados) ? dias_mostrados : [],
        criterio_orden: criterio_orden ?? null,
        metadata: { extras: { fallback: true } },
      } as PresentacionYDisponibilidades;
    }

    return {
      presentacion,
      disponibilidades: Array.isArray(disponibilidades) ? disponibilidades : [],
      disclaimer_fechas: disclaimer_fechas ?? null,
      dias_mostrados: Array.isArray(dias_mostrados) ? dias_mostrados : [],
      criterio_orden: criterio_orden ?? null,
      metadata: metadata ?? undefined,
    } as PresentacionYDisponibilidades;
  } catch (error) {
    Logger.error(
      "[AvailabilityResponsePresenterService] Error al procesar disponibilidades:",
      error
    );
    return {
      presentacion: "Lo siento, ocurrió un error al procesar las disponibilidades.",
      disponibilidades: [],
      disclaimer_fechas: null,
      dias_mostrados: [],
      criterio_orden: null,
      metadata: { extras: { error: true } },
    } as PresentacionYDisponibilidades;
  }
}