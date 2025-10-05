// packages/core/src/application/services/types/Availability.ts

import { z } from "zod";

// ============================
// Utilidades de validación
// ============================

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD (validación leve)
export const TWO_DIGIT_MINUTE_RE = /^\d{2}$/; // "00".."59" (validación leve)

/**
 * Rango de fechas [start_date, end_date] en formato ISO (YYYY-MM-DD).
 * - Para día único: start_date == end_date.
 */
export const ExtractorDateRangeSchema = z
  .object({
    start_date: z
      .string()
      .regex(ISO_DATE_RE, "start_date debe tener formato YYYY-MM-DD"),
    end_date: z
      .string()
      .regex(ISO_DATE_RE, "end_date debe tener formato YYYY-MM-DD"),
  })
  .strict()
  .refine((o) => o.end_date >= o.start_date, {
    message: "end_date no puede ser anterior a start_date",
    path: ["end_date"],
  });

export type ExtractorDateRange = z.infer<typeof ExtractorDateRangeSchema>;

/**
 * Filtro individual del extractor (una alternativa OR).
 *
 * Notas:
 * - `tratamientos`, `medicos`, `espacios`, `aparatologias`, `especialidades` son
 *   listas normalizadas contra los catálogos del Contexto.
 * - `date_ranges` contiene uno o varios rangos (OR interno entre rangos).
 * - `time_preferences` es opcional y textual; no lista de horas.
 */
export const ExtractorFilterSchema = z
  .object({
    tratamientos: z.array(z.string()),
    medicos: z.array(z.string()),
    espacios: z.array(z.string()),
    aparatologias: z.array(z.string()),
    especialidades: z.array(z.string()),
    date_ranges: z.array(ExtractorDateRangeSchema).min(1),
    time_preferences: z.string().trim().nullable().optional(),
  })
  .strict();

export type ExtractorFilter = z.infer<typeof ExtractorFilterSchema>;

/**
 * Resultado completo del extractor.
 * - `filters` es un array de alternativas OR.
 */
export const ExtractorResultSchema = z
  .object({
    filters: z.array(ExtractorFilterSchema),
  })
  .strict();

export type ExtractorResult = z.infer<typeof ExtractorResultSchema>;

/**
 * Cabecera opcional para el prompt del extractor (solo para construcción del prompt).
 * Sirve para indicar el tope por defecto de días hacia adelante cuando el paciente
 * no especifica fin del rango.
 */
export interface ExtractorPromptHeader {
  /**
   * Sugerencia de días a añadir por defecto al último end_date cuando el
   * paciente no acota el final del rango (p. ej. 45 o 90). El extractor debe
   * respetar valores explícitos indicados por el paciente por encima de este tope.
   */
  default_forward_days: number;
}

// ============================
// Policy de Agenda — Tipos TS
// ============================

export type MostrarMedicos = "auto" | "siempre" | "nunca";

export interface AgendaPolicyLimits {
  tope_global?: number; // default 10
  tope_por_dia?: number; // default 3
  tope_dias?: number; // default 3
}

export interface AgendaPolicyPresentation {
  mostrar_sede?: boolean; // si true y hay sedes.lista_clinica no vacía, el redactor puede imprimir "Sede: ..."
  mostrar_medicos?: MostrarMedicos; // auto|siempre|nunca
}

export interface AgendaPolicyPrioritizacionRangos {
  metodo: string; // p.ej. "primer_dia_luego_resto_por_rango"
  descripcion?: string;
}

export interface AgendaPolicyReglaTratamiento {
  id_tratamiento?: number; // opcional, si viene desde analisis_agenda
  nombre_tratamiento_bd?: string; // nombre exacto tal cual BD
  minutos_permitidos: string[]; // ["00","30"], dos dígitos
}

export interface AgendaPolicyResolved {
  version: "1.0";
  interpretacion_maximo: "ultimo_inicio";
  minutos_globales?: string[]; // whitelist por defecto (si falta, el acumulador aplica la suya)
  reglas_minutos_por_tratamiento_resueltas?: AgendaPolicyReglaTratamiento[];
  priorizacion_rangos?: AgendaPolicyPrioritizacionRangos;
  limites?: AgendaPolicyLimits;
  presentacion?: AgendaPolicyPresentation;
  sedes?: { lista_clinica: string[] };
  metadata?: {
    criterios?: Record<string, unknown>;
    conteos?: Record<string, unknown>;
    warnings?: string[];
  };
}

// ============================
// Policy de Agenda — Zod Schemas (compatibles con Responses API)
// Reglas: todos los campos "required", y cuando algo puede faltar usamos `.nullable()`
// en vez de `.optional()`.
// ============================

export const MostrarMedicosSchema = z.enum(["auto", "siempre", "nunca"]);

// Subtipos
export const AgendaPolicyLimitsSchema = z
  .object({
    tope_global: z.number().int().positive().max(999).nullable(),
    tope_por_dia: z.number().int().positive().max(99).nullable(),
    tope_dias: z.number().int().positive().max(99).nullable(),
  })
  .strict();

export const AgendaPolicyPresentationSchema = z
  .object({
    mostrar_sede: z.boolean().nullable(),
    mostrar_medicos: MostrarMedicosSchema.nullable(),
  })
  .strict();

export const AgendaPolicyPrioritizacionRangosSchema = z
  .object({
    metodo: z.string().min(1),
    descripcion: z.string().min(1).nullable(),
  })
  .strict();

export const AgendaPolicyReglaTratamientoSchema = z
  .object({
    id_tratamiento: z.number().int().nullable(),
    nombre_tratamiento_bd: z.string().min(1).nullable(),
    minutos_permitidos: z.array(z.string().regex(TWO_DIGIT_MINUTE_RE)).min(1),
  })
  .strict()
  .refine(
    (o) =>
      typeof o.id_tratamiento === "number" ||
      (typeof o.nombre_tratamiento_bd === "string" && o.nombre_tratamiento_bd.length > 0),
    { message: "Se requiere id_tratamiento o nombre_tratamiento_bd" },
  );

export const AgendaPolicySedesSchema = z
  .object({
    lista_clinica: z.array(z.string().min(1)).min(1),
  })
  .strict();

// Para cumplir con Responses API, `additionalProperties` debe tener `type`.
// Usamos un dominio de valores escalar seguro.
const ScalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const AgendaPolicyMetadataSchema = z
  .object({
    criterios: z.record(ScalarValueSchema).nullable(),
    conteos: z.record(ScalarValueSchema).nullable(),
    warnings: z.array(z.string()).nullable(),
  })
  .strict();

export const AgendaPolicyResolvedSchema = z
  .object({
    version: z.literal("1.0"),
    interpretacion_maximo: z.literal("ultimo_inicio"),
    minutos_globales: z.array(z.string().regex(TWO_DIGIT_MINUTE_RE)).nullable(),
    reglas_minutos_por_tratamiento_resueltas: z
      .array(AgendaPolicyReglaTratamientoSchema)
      .nullable(),
    priorizacion_rangos: AgendaPolicyPrioritizacionRangosSchema.nullable(),
    limites: AgendaPolicyLimitsSchema.nullable(),
    presentacion: AgendaPolicyPresentationSchema.nullable(),
    sedes: AgendaPolicySedesSchema.nullable(),
    metadata: AgendaPolicyMetadataSchema.nullable(),
  })
  .strict();

export type AgendaPolicyResolvedParsed = z.infer<typeof AgendaPolicyResolvedSchema>;

// =============================
// Slot Accumulator — contratos (TS)
// =============================
export interface SlotAccumulatorContext {
  timezone?: string;
  sede_elegida?: string | null;
  horas_preferencia_usuario?: string[]; // ["mañana","tarde","19:00"]
  disclaimer_fechas?: any; // ranges colapsados (lo que devuelve collapseBlocksToRanges)
  ahoraISO?: string; // opcional, informativo
}

export interface SlotAccumulatorInput {
  policy: AgendaPolicyResolved;
  filters: any[]; // AvailabilityFilterResult[]; se usa solo para priorización de días
  windows: any[]; // analisis_agenda (ventanas crudas del dominio)
  contexto?: SlotAccumulatorContext;
}

export interface SlotAccumulatorOutput {
  universo_opciones: any[]; // todos los inicios válidos (ordenados)
  opciones_top10: any[]; // top N (tope_global)
  dias_mostrados: string[]; // YYYY-MM-DD
  disclaimer_fechas?: any;
  tipo_busqueda_final: string; // p.ej. "bloques" | otros si en el futuro se usa
  metadata?: {
    reglas_aplicadas?: Record<string, unknown>;
    criterios?: Record<string, unknown>;
    conteos?: {
      total_original?: number;
      total_derivados?: number;
      total_filtrados?: number;
      dias_presentados?: number;
      [k: string]: unknown;
    };
    warnings?: string[];
  };
}