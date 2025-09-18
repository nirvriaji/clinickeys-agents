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

const FlexibleValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const MetadataSchema = z.object({
  tipo_busqueda: z.enum(["original", "original_filtrado", "sin_disponibilidad"]).nullable().optional(),
  reglas_aplicadas: z.record(FlexibleValue).nullable().optional(),
  warnings: z.array(z.string()).nullable().optional(),
  sugerencias: z.array(z.string()).nullable().optional(),
  conteos: z.object({
    total_original: z.number(),
    total_filtrado: z.number(),
    dias_presentados: z.number()
  }).nullable().optional(),
  primer_hueco: z.object({
    fecha: z.string(),
    hora: z.string()
  }).nullable().optional(),
  criterios: z.record(FlexibleValue).nullable().optional(),
  extras: z.record(FlexibleValue).nullable().optional()
}).strict().nullable().optional();

const PresentacionYDisponibilidadesSchema = z.object({
  presentacion: z.string(),
  disponibilidades: z.array(DisponibilidadSchema),
  disclaimer_fechas: z.string().nullable().optional(),
  dias_mostrados: z.array(z.string()).nullable().optional(),
  criterio_orden: z.string().nullable().optional(),
  metadata: MetadataSchema
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
    const result = await openAIService.getSchemaStructuredResponse(
      systemPrompt,
      userPrompt,
      PresentacionYDisponibilidadesSchema,
      "PresentacionYDisponibilidadesSchema"
    );
    const {
      presentacion,
      disponibilidades: disponibilidadesInJSON,
      disclaimer_fechas,
      dias_mostrados,
      criterio_orden,
      metadata
    } = result;

    if (!presentacion) {
      Logger.warn("[presentAndFilterAvailability] No se pudo parsear respuesta de OpenAI, devolviendo fallback");
      return {
        presentacion: "Lo siento, no encontré horarios que cumplan tus preferencias.",
        disponibilidades,
        metadata: { extras: { fallback: true } },
      };
    }

    return {
      presentacion,
      disponibilidades,
      metadata: { extras: { fallback: true } },
    };
  } catch (error) {
    Logger.error("[presentAndFilterAvailability] Error al procesar disponibilidades:", error);
    return {
      presentacion: "Lo siento, ocurrió un error al procesar las disponibilidades.",
      disponibilidades,
      metadata: { extras: { error: true } },
    };
  }
}