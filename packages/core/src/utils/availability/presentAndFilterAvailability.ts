// packages/core/src/utils/availability/presentAndFilterAvailability.ts

import { z } from "zod";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { readFile } from "fs/promises";
import path from "path";

// =============================
// Schemas
// =============================

const DisponibilidadSchema = z.object({
  hora_inicio_minima: z.string(),
  hora_inicio_maxima: z.string(),
  id_medico: z.number(),
  nombre_medico: z.string(),
  id_espacio: z.number(),
  nombre_espacio: z.string(),
  id_tratamiento: z.number(),
  nombre_tratamiento: z.string(),
  duracion_tratamiento: z.number(),
  especifica: z.boolean(),
  fecha_legible: z.string().nullable().optional(),
  fecha_cita: z.string(),
});

export type Disponibilidad = z.infer<typeof DisponibilidadSchema>;

const PresentacionYDisponibilidadesSchema = z.object({
  presentacion: z.string(),
  disponibilidades: z.array(DisponibilidadSchema),
  disclaimer_fechas: z.string().nullable().optional(),
  dias_mostrados: z.array(z.string()).nullable().optional(),
  criterio_orden: z.string().nullable().optional(),
  metadata: z.record(z.any()).nullable().optional(),
});

export type PresentacionYDisponibilidades = z.infer<typeof PresentacionYDisponibilidadesSchema>;

// =============================
// Prompt caching
// =============================

let cachedSystemPrompt: string | null = null;

async function loadSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;

  const promptsPath = path.resolve(__dirname, "packages/core/src/.ia/instructions/prompts/bot_presentador_disponibilidades.md");

  try {
    const content = await readFile(promptsPath, "utf8");
    cachedSystemPrompt = content;
    Logger.info("[presentAndFilterAvailability] Prompt de sistema cargado", { promptsPath });
    return cachedSystemPrompt;
  } catch (err) {
    Logger.error("[presentAndFilterAvailability] No se pudo leer el .md del prompt; usando fallback inline", err);
    cachedSystemPrompt = `Eres un presentador de disponibilidades médicas.\nRecibirás un array de disponibilidades y un conjunto de restricciones.\nDebes filtrar, ordenar y luego generar un texto para el paciente con las reglas definidas.\nResponde siempre en JSON cumpliendo el schema indicado.`;
    return cachedSystemPrompt;
  }
}

// =============================
// Main function
// =============================

export async function presentAndFilterAvailability(
  openAIService: IOpenAIService,
  disponibilidades: Disponibilidad[],
  contexto: string,
): Promise<PresentacionYDisponibilidades> {
  const systemPrompt = await loadSystemPrompt();

  const userPrompt = `CONFIGURACION_DE_DISPONIBILIDADES:\n\nCONTEXTO:\n${JSON.stringify(contexto || {}, null, 2)}\n\nDISPONIBILIDADES_ORIGINALES:\n${JSON.stringify(disponibilidades, null, 2)}`;

  try {
    const { parsed } = await openAIService.getSchemaStructuredResponse(
      systemPrompt,
      userPrompt,
      PresentacionYDisponibilidadesSchema,
      "PresentacionYDisponibilidadesSchema"
    );

    if (!parsed) {
      Logger.warn("[presentAndFilterAvailability] No se pudo parsear respuesta de OpenAI, devolviendo fallback");
      return {
        presentacion: "Lo siento, no encontré horarios que cumplan tus preferencias.",
        disponibilidades,
        metadata: { fallback: true },
      };
    }

    return parsed;
  } catch (error) {
    Logger.error("[presentAndFilterAvailability] Error al procesar disponibilidades:", error);
    return {
      presentacion: "Lo siento, ocurrió un error al procesar las disponibilidades.",
      disponibilidades,
      metadata: { error: true },
    };
  }
}