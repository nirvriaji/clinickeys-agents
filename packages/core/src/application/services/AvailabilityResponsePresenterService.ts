// packages/core/src/application/services/AvailabilityResponsePresenterService.ts

import { SelectorHorariosSchema, type SelectorHorarios, type SlotDisponibilidadType as SlotDisponibilidad } from "@clinickeys-agents/core/domain/availability";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import { readFile } from "fs/promises";
import path from "path";

// =============================
// Prompt caching (robusto)
// =============================
let cachedSystemPrompt: string | null = null;

async function loadSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;

  const promptsPath = path.resolve(
    __dirname,
    "packages/core/src/.ia/instructions/prompts/bot_presentador_disponibilidades.md"
  );

  try {
    const content = await readFile(promptsPath, "utf8");
    cachedSystemPrompt = content;
    Logger.info("[AvailabilityResponsePresenterService] Prompt cargado", { promptsPath });
    return cachedSystemPrompt;
  } catch (err) {
    Logger.error(
      "[AvailabilityResponsePresenterService] No se pudo leer el .md del prompt; usando fallback inline",
      err
    );
    // Fallback mínimo alineado al nuevo contrato (horarios_escogidos)
    cachedSystemPrompt = [
      "Asistente Selector de Horarios.",
      "Recibirás DISPONIBILIDADES_ORIGINALES (rango con hora_inicio_minima/hora_inicio_maxima) y ASISTENTE_AGENDA_CONFIG.",
      "Debes devolver un único JSON válido con shape { horarios_escogidos: Horario[], dias_mostrados?: string[], criterio_orden?: string, metadata?: object }.",
      "Cada Horario lleva: fecha_cita, hora_inicio (HH:mm), hora_fin (HH:mm), ids/nombres médico/espacio/tratamiento y duracion_tratamiento.",
      "No inventes datos; si aplicas reglas de minutos/franjas, materializa un inicio válido dentro del rango y calcula fin = inicio + duracion.",
      "Horas siempre en 24h HH:mm (sin segundos)."
    ].join("\n");
    return cachedSystemPrompt;
  }
}

// =============================
// Helpers
// =============================
function toHHmm(hhmmOrHHmmss: string): string {
  const m = /^(\d{2}:\d{2})(?::\d{2})?$/.exec(hhmmOrHHmmss);
  return m ? m[1] : hhmmOrHHmmss;
}

function addMinutesHHmm(hhmmOrHHmmss: string, minutes: number): string {
  const base = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(hhmmOrHHmmss);
  if (!base) return hhmmOrHHmmss;
  const h = parseInt(base[1], 10);
  const m = parseInt(base[2], 10);
  const total = h * 60 + m + (Number.isFinite(minutes) ? minutes : 0);
  const norm = ((total % 1440) + 1440) % 1440; // wrap 24h de forma segura
  const hh = String(Math.floor(norm / 60)).padStart(2, "0");
  const mm = String(norm % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function stringifyJSONSafe(obj: unknown): string {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

// =============================
// Main function
// =============================
/**
 * Selector/Presentador de disponibilidades.
 *
 * @param openAIService Servicio OpenAI que soporta salida validada por Zod
 * @param raw_disponibilidades Slots con rango (hora_inicio_minima / hora_inicio_maxima)
 * @param contexto Texto libre de ASISTENTE_AGENDA_CONFIG (config externa redactada por negocio)
 */
export async function AvailabilityResponsePresenterService(
  openAIService: IOpenAIService,
  raw_disponibilidades: SlotDisponibilidad[],
  contexto: string
): Promise<SelectorHorarios> {
  const systemPrompt = await loadSystemPrompt();

  // Compatibilidad: `contexto` contiene el bloque de configuración en texto libre
  const configTexto: string = typeof contexto === "string" ? contexto : String(contexto ?? "");

  // CONTEXTO técnico: opcional (punto de extensión futuro)
  const contextoTecnico = {} as Record<string, unknown>;

  const userPrompt =
    `ASISTENTE_AGENDA_CONFIG:\n${configTexto}\n\n` +
    `CONTEXTO:\n${stringifyJSONSafe(contextoTecnico)}\n\n` +
    `DISPONIBILIDADES_ORIGINALES:\n${JSON.stringify(raw_disponibilidades ?? [], null, 2)}`;

  Logger.info("[AvailabilityResponsePresenterService] Inicio selección", {
    totalDisponibilidades: Array.isArray(raw_disponibilidades) ? raw_disponibilidades.length : 0,
  });

  try {
    const result = await openAIService.getSchemaStructuredResponse(
      systemPrompt,
      userPrompt,
      SelectorHorariosSchema,
      "SelectorHorariosSchema",
      "gpt-4o-mini"
    );

    const { horarios_escogidos, dias_mostrados, criterio_orden, metadata } =
      result as SelectorHorarios;

    Logger.info("[AvailabilityResponsePresenterService] Selección recibida del LLM", {
      horariosCount: Array.isArray(horarios_escogidos) ? horarios_escogidos.length : 0,
      dias_mostrados: Array.isArray(dias_mostrados) ? dias_mostrados : [],
      criterio_orden,
    });

    if (!Array.isArray(horarios_escogidos)) {
      Logger.warn(
        "[AvailabilityResponsePresenterService] Respuesta sin 'horarios_escogidos' válido; aplicando fallback"
      );
      return fallbackFromRaw(raw_disponibilidades);
    }

    return {
      horarios_escogidos,
      dias_mostrados: Array.isArray(dias_mostrados) ? dias_mostrados : undefined,
      criterio_orden: criterio_orden ?? undefined,
      metadata: metadata ?? undefined,
    } as SelectorHorarios;
  } catch (error) {
    Logger.error("[AvailabilityResponsePresenterService] Error al seleccionar horarios:", error);
    return fallbackFromRaw(raw_disponibilidades);
  }
}

// =============================
// Fallback local (sin LLM)
// =============================
function fallbackFromRaw(raw: SlotDisponibilidad[]): SelectorHorarios {
  const source = Array.isArray(raw) ? raw : [];

  // Orden determinista por fecha y hora_inicio_minima
  const ordered = [...source].sort((a, b) => {
    const fa = (a.fecha_cita || "").localeCompare(b.fecha_cita || "");
    if (fa !== 0) return fa;
    const ha = toHHmm(a.hora_inicio_minima || "00:00");
    const hb = toHHmm(b.hora_inicio_minima || "00:00");
    return ha.localeCompare(hb);
  });

  const picked = ordered.slice(0, 3).map((s) => {
    const inicio = toHHmm(s.hora_inicio_minima || "00:00");
    const fin = addMinutesHHmm(inicio, Number(s.duracion_tratamiento || 0));
    return {
      fecha_cita: s.fecha_cita,
      hora_inicio: inicio,
      hora_fin: fin,
      id_medico: s.id_medico,
      nombre_medico: s.nombre_medico,
      id_espacio: s.id_espacio,
      nombre_espacio: s.nombre_espacio,
      id_tratamiento: s.id_tratamiento,
      nombre_tratamiento: s.nombre_tratamiento,
      duracion_tratamiento: s.duracion_tratamiento,
      fecha_legible: s.fecha_legible ?? null,
      especifica: s.especifica,
    };
  });

  const dias = Array.from(new Set(picked.map((p) => p.fecha_cita).filter(Boolean)));

  Logger.info("[AvailabilityResponsePresenterService] Fallback aplicado", {
    seleccionados: picked.length,
    dias_mostrados: dias,
  });

  return {
    horarios_escogidos: picked,
    dias_mostrados: dias,
    criterio_orden: "fecha_ascendente_hora_ascendente",
    metadata: {
      extras: { fallback: true },
      conteos: {
        total_original: source.length,
        total_filtrado: picked.length,
        dias_presentados: dias.length,
      },
    },
  };
}