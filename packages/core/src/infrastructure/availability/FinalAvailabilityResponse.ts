// packages/core/src/infrastructure/availability/finalAvailabilityResponse.ts

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
    return cachedSystemPrompt;
  } catch (err) {
    Logger.error(
      "[finalAvailabilityResponse] No se pudo leer el .md del prompt; usando fallback inline",
      err
    );
    cachedSystemPrompt =
      "Eres un presentador de disponibilidades médicas.\nRecibirás un array de disponibilidades y un conjunto de restricciones.\nDebes filtrar, ordenar y luego generar un texto para el paciente con las reglas definidas.\nResponde siempre en JSON cumpliendo el schema indicado.";
    return cachedSystemPrompt;
  }
}

// =============================
// Main function
// =============================

export async function finalAvailabilityResponse(
  openAIService: IOpenAIService,
  raw_disponibilidades: SlotDisponibilidad[],
  contexto: string
): Promise<PresentacionYDisponibilidades> {
  const systemPrompt = await loadSystemPrompt();

  const userPrompt = `CONFIGURACION_DE_DISPONIBILIDADES:\n\nCONTEXTO:\n${JSON.stringify(
    contexto || {},
    null,
    2
  )}\n\nDISPONIBILIDADES_ORIGINALES:\n${JSON.stringify(
    raw_disponibilidades,
    null,
    2
  )}`;

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
    } = result;

    if (!presentacion) {
      Logger.warn(
        "[finalAvailabilityResponse] No se pudo parsear respuesta de OpenAI, devolviendo fallback"
      );
      return {
        presentacion:
          "Lo siento, no encontré horarios que cumplan tus preferencias.",
        disponibilidades: [],
        disclaimer_fechas,
        dias_mostrados,
        criterio_orden,
        metadata: { extras: { fallback: true } },
      };
    }

    return {
      presentacion,
      disponibilidades,
      disclaimer_fechas,
      dias_mostrados,
      criterio_orden,
      metadata,
    };
  } catch (error) {
    Logger.error(
      "[finalAvailabilityResponse] Error al procesar disponibilidades:",
      error
    );
    return {
      presentacion:
        "Lo siento, ocurrió un error al procesar las disponibilidades.",
      disponibilidades: [],
      disclaimer_fechas: null,
      dias_mostrados: null,
      criterio_orden: null,
      metadata: { extras: { error: true } },
    };
  }
}