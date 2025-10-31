// packages/core/src/application/services/AvailabilityService/AvailabilitySearch/AvailabilitySearch.ts

import { z } from "zod";
import type { ExtractorTimeWindow } from "@clinickeys-agents/core/application/services/types/Availability";

// =============================
// Utiles comunes
// =============================
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // YYYY-MM-DDTHH:mm:ss.sssZ (o ISO sin TZ si ya normalizado)
export type HHMM = string; // "HH:mm"

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const ISODateSchema = z.string().regex(ISO_DATE_RE, "Debe ser YYYY-MM-DD");
export const HHMMSchema = z.string().regex(HHMM_RE, "Debe ser HH:mm");

// =============================
// Catálogos disponibles (para extractor / normalización)
// =============================
export interface CatalogosDisponibles {
  tratamientosDisponibles: string[];
  medicosDisponibles: string[];
  espaciosDisponibles: string[];
}

// =============================
// Rango de fechas
// =============================
export const DateRangeSchema = z
  .object({
    start: ISODateSchema, // inclusive
    end: ISODateSchema, // inclusive
  })
  .strict()
  .refine((o) => o.end >= o.start, {
    message: "end no puede ser menor que start",
    path: ["end"],
  });

export type DateRange = z.infer<typeof DateRangeSchema>;

// =============================
// Divisiones horarias canónicas
// =============================
export const TimeDivisionKeySchema = z.enum([
  "manana", // 07:00–11:59 (sin tilde para evitar incompatibilidades en claves)
  "mediodia", // 12:00–14:59
  "tarde", // 15:00–22:59
]);

export type TimeDivisionKey = z.infer<typeof TimeDivisionKeySchema>;

export const TimeDivisionSchema = z
  .object({
    key: TimeDivisionKeySchema,
    start: HHMMSchema, // inclusive
    end: HHMMSchema, // inclusive
  })
  .strict();

export type TimeDivision = z.infer<typeof TimeDivisionSchema>;

// Preset por defecto (usado por AvailabilityTimeDivisionsService)
export const DefaultTimeDivisions: Readonly<TimeDivision[]> = [
  { key: "manana", start: "07:00", end: "11:59" },
  { key: "mediodia", start: "12:00", end: "14:59" },
  { key: "tarde", start: "15:00", end: "22:59" },
] as const;

// =============================
// Entrada del ranking de fechas
// =============================
export const DateRankingInputSchema = z
  .object({
    nowISO: ISODateSchema, // hoy (local-UTC ya normalizado por la app)

    // Fechas explícitas interpretadas del mensaje (singles) – priorizadas
    explicitDates: z.array(ISODateSchema).default([]),

    // Rangos explícitos interpretados del mensaje – el primer día de cada rango se prioriza
    explicitRanges: z.array(DateRangeSchema).default([]),

    // Preferencias semanales opcionales (1=Lunes..7=Domingo, ISO-8601)
    preferredWeekdays: z.array(z.number().int().min(1).max(7)).default([]),

    // Horizonte: si el usuario NO indica fecha máxima
    defaultForwardDays: z.number().int().positive().max(365).default(45),

    // Si el usuario sí indica una fecha máxima, agregar hasta +N días extra sobre ese máximo
    extendBeyondUserMaxDays: z.number().int().min(0).max(90).default(45),

    // Cap absoluto del horizonte total contado desde nowISO (seguridad)
    absoluteMaxHorizonDays: z.number().int().min(30).max(365).default(120),

    // Filtro opcional por días de la semana permitidos (ej. "jueves" y "viernes")
    allowedWeekdaysOnly: z.array(z.number().int().min(1).max(7)).default([]),
  })
  .strict();

export type DateRankingInput = z.infer<typeof DateRankingInputSchema>;

export const RankedDateReasonSchema = z.enum([
  "explicit_single", // fecha suelta que mencionó la persona
  "range_first_day", // primer día de un rango mencionado
  "range_follow_up", // resto de días del rango mencionado
  "weekday_preference", // coincide con preferencias de días (jueves/viernes, etc.)
  "proximity_filler", // fechas cercanas al presente no mencionadas
]);

export type RankedDateReason = z.infer<typeof RankedDateReasonSchema>;

export const RankedDateSchema = z
  .object({
    date: ISODateSchema,
    rank: z.number().int(), // menor es más prioritario
    reason: RankedDateReasonSchema,
    sourceRange: DateRangeSchema.nullable().default(null),
  })
  .strict();

export type RankedDate = z.infer<typeof RankedDateSchema>;

export const DateRankingResultSchema = z
  .object({
    orderedDates: z.array(ISODateSchema),
    details: z.array(RankedDateSchema),
    horizonStart: ISODateSchema,
    horizonEnd: ISODateSchema,
    discarded: z.array(ISODateSchema), // fuera de horizonte, duplicadas, o no permitidas
  })
  .strict();

export type DateRankingResult = z.infer<typeof DateRankingResultSchema>;

// =============================
// División horaria por día (cobertura)
// =============================
export const DivisionCoverageItemSchema = z
  .object({
    hasOption: z.boolean(),
    count: z.number().int().min(0),
  })
  .strict();

export type DivisionCoverageItem = z.infer<typeof DivisionCoverageItemSchema>;

export const DayDivisionCoverageSchema = z
  .object({
    date: ISODateSchema,
    divisions: z.record(TimeDivisionKeySchema, DivisionCoverageItemSchema),
  })
  .strict();

export type DayDivisionCoverage = z.infer<typeof DayDivisionCoverageSchema>;

// =============================
// Slot mínimo (independiente del dominio interno)
// =============================
export const MinimalSlotSchema = z
  .object({
    fecha_cita: ISODateSchema,
    fecha_legible: z.string().nullable().default(null),
    hora_inicio: HHMMSchema,
    id_medico: z.number().nullable().default(null),
    nombre_medico: z.string().nullable().default(null),
    id_espacio: z.number().nullable().default(null),
    nombre_espacio: z.string().nullable().default(null),
    id_tratamiento: z.number().nullable().default(null),
    nombre_tratamiento: z.string().nullable().default(null),
    duracion_tratamiento: z.number().int().positive().nullable().default(null),
  })
  .strict();

export type MinimalSlot = z.infer<typeof MinimalSlotSchema>;

// =============================
// Objetivo de búsqueda
// =============================
export const SearchTargetSchema = z
  .object({
    targetFullDays: z.number().int().min(1).max(10).default(3),
    // Asegurar variedad: al menos 1 opción por división horaria cuando sea posible
    requireDivisionVariety: z.boolean().default(true),
  })
  .strict();

export type SearchTarget = z.infer<typeof SearchTargetSchema>;

// =============================
// Plan de búsqueda (resultado del planner)
// =============================
export const SearchPlanSchema = z
  .object({
    datesRanked: z.array(ISODateSchema),
    batches: z.array(z.array(ISODateSchema)), // grupos secuenciales a consultar
    divisions: z.array(TimeDivisionSchema).default(
      DefaultTimeDivisions as unknown as TimeDivision[]
    ),
    target: SearchTargetSchema,
  })
  .strict();

export type SearchPlan = z.infer<typeof SearchPlanSchema>;

// =============================
// Paso ejecutado y métrica
// =============================
export const SearchStepSchema = z
  .object({
    batchIndex: z.number().int().min(0),
    dates: z.array(ISODateSchema),
    consultedAt: z.string(),
    cacheHit: z.boolean().default(false),
    slotsFound: z.number().int().min(0),
    blocksRanges: z.array(DateRangeSchema).default([]), // si se usa segmentación por bloques
  })
  .strict();

export type SearchStep = z.infer<typeof SearchStepSchema>;

// =============================
// Resumen de ejecución de búsqueda
// =============================
export const SearchStopReasonSchema = z.enum([
  "target_met", // se alcanzaron >= targetFullDays completos con variedad
  "exhausted", // se agotó el horizonte (o fechas rankeadas) sin llegar al objetivo
  "error", // falla no recuperable
]);

export type SearchStopReason = z.infer<typeof SearchStopReasonSchema>;

export const AvailabilitySearchSummarySchema = z
  .object({
    consultedDates: z.array(ISODateSchema),
    discardedDates: z.array(ISODateSchema),
    daysCompleted: z.array(ISODateSchema),
    daysPartial: z.array(ISODateSchema),
    divisionCoverageByDay: z.record(
      ISODateSchema,
      z.record(TimeDivisionKeySchema, DivisionCoverageItemSchema)
    ),
    steps: z.array(SearchStepSchema),
    stopReason: SearchStopReasonSchema,
    totalSlots: z.number().int().min(0),
    cacheHits: z.number().int().min(0).default(0),
  })
  .strict();

export type AvailabilitySearchSummary = z.infer<
  typeof AvailabilitySearchSummarySchema
>;

// =============================
// Resultado final del motor (para pasar al redactor)
// =============================
export const AvailabilitySearchResultSchema = z
  .object({
    plan: SearchPlanSchema,
    slotsByDate: z.record(ISODateSchema, z.array(MinimalSlotSchema)), // días completos sin recortes
    summary: AvailabilitySearchSummarySchema,
  })
  .strict();

export type AvailabilitySearchResult = z.infer<
  typeof AvailabilitySearchResultSchema
>;

// =============================
// Tipos de filtro del extractor (dos variantes bien separadas)
// =============================
export interface ExtractorFilterDateRange {
  start_date: ISODate;
  end_date: ISODate;
  time_windows?: ExtractorTimeWindow[];
}

export interface ExtractorFilterNames {
  tratamientos: string[];
  medicos: string[];
  espacios: string[];
  aparatologias: string[];
  especialidades: string[];
  date_ranges: ExtractorFilterDateRange[];
}

export interface ExtractorFilterIds {
  tratamiento_ids: number[];
  medico_ids: number[];
  espacio_ids: number[];
  aparatologias: string[];
  especialidades: string[];
  date_ranges: ExtractorFilterDateRange[];
}

// En la app usamos la variante por NOMBRES para normalización previa.
export type ExtractorFilter = ExtractorFilterNames;

// =============================
// Normalización y matching
// =============================
/**
 * Normaliza un texto para matching:
 *  - trim
 *  - minúsculas
 *  - sin tildes/diacríticos
 *  - colapsa espacios
 *  - elimina puntuación simple
 *  - elimina títulos médicos comunes (dr, dra, doctor, doctora)
 */
export function normalizeForMatch(raw: string): string {
  const base = String(raw || "");
  const lower = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita diacríticos
    .toLowerCase();

  // elimina puntuación ligera y puntos sueltos, mantiene letras/números/espacios
  const noPunct = lower.replace(/[^a-z0-9\s]/g, " ");

  // elimina títulos/marcadores frecuentes
  const removedTitles = noPunct
    .replace(/\bdr\.\b/g, " ")
    .replace(/\bdra\.\b/g, " ")
    .replace(/\bdr\b/g, " ")
    .replace(/\bdra\b/g, " ")
    .replace(/\bdoctor(a)?\b/g, " ")
    .replace(/\bmedico(a)?\b/g, " ");

  // colapsa espacios
  return removedTitles.replace(/\s+/g, " ").trim();
}

/** Devuelve el nombre canónico (exacto) del catálogo si hay match flexible; si no, null. */
export function matchCanonical(
  value: string | null | undefined,
  catalog: string[]
): string | null {
  if (!value) return null;
  const needle = normalizeForMatch(value);
  if (!needle) return null;

  let candidate: string | null = null;
  let candidateLen = Infinity; // preferimos el match más corto (e.g., evita arrastres)

  for (const item of catalog || []) {
    const norm = normalizeForMatch(item);
    if (!norm) continue;
    if (norm === needle) {
      // match exacto tras normalización ⇒ mejor caso
      return item;
    }
    // Coincidencia flexible: contiene todas las palabras del needle (AND)
    const words = needle.split(" ");
    const ok = words.every((w) => norm.includes(w));
    if (ok) {
      // preferimos el ítem con menor longitud normalizada (más canónico/conciso)
      if (norm.length < candidateLen) {
        candidate = item;
        candidateLen = norm.length;
      }
    }
  }
  return candidate;
}

// =============================
// Mapeos a canónico
// =============================
/** Mapea arrays de campos a sus nombres canónicos exactos de catálogo. */
export function mapFilterFieldsToCanonical(
  f: ExtractorFilterNames,
  cat: CatalogosDisponibles
): ExtractorFilterNames {
  const cloneRanges = (
    ranges: ExtractorFilterDateRange[] | undefined
  ): ExtractorFilterDateRange[] => {
    if (!Array.isArray(ranges)) return [];
    return ranges
      .map((r) => {
        const start = String(r?.start_date || "").slice(0, 10) as ISODate;
        const end = String(r?.end_date || "").slice(0, 10) as ISODate;
        const windows = Array.isArray(r?.time_windows)
          ? r.time_windows.map((tw) => ({ ...tw }))
          : [];
        return { start_date: start, end_date: end, time_windows: windows };
      })
      .filter((r) => ISO_DATE_RE.test(r.start_date) && ISO_DATE_RE.test(r.end_date));
  };

  const mapArray = (arr: string[] | undefined, catalog: string[]) => {
    const out: string[] = [];
    for (const v of arr || []) {
      const m = matchCanonical(v, catalog);
      if (m && !out.includes(m)) out.push(m);
    }
    return out;
  };

  return {
    tratamientos: mapArray(f.tratamientos, cat.tratamientosDisponibles),
    medicos: mapArray(f.medicos, cat.medicosDisponibles),
    espacios: mapArray(f.espacios, cat.espaciosDisponibles),
    aparatologias: Array.isArray(f.aparatologias) ? [...f.aparatologias] : [],
    especialidades: Array.isArray(f.especialidades) ? [...f.especialidades] : [],
    date_ranges: cloneRanges(f.date_ranges),
  };
}

export interface ToolCallingParamsLike {
  tratamiento: string;
  medico?: string | null;
  espacio?: string | null;
  fechas?: string; // libre, no se toca aquí
  horas?: string; // libre, no se toca aquí
}

/**
 * Selecciona valores canónicos a partir de tool‑calling params (no obliga a extractor).
 *  - Si no hay match, devuelve null para ese campo (no inventa).
 */
export function canonicalFromParams(
  params: ToolCallingParamsLike,
  cat: CatalogosDisponibles
): { tratamiento?: string; medico?: string | null; espacio?: string | null } {
  const tratamiento =
    matchCanonical(params.tratamiento, cat.tratamientosDisponibles) || undefined;
  const medico =
    params.medico != null
      ? matchCanonical(params.medico, cat.medicosDisponibles) || null
      : undefined;
  const espacio =
    params.espacio != null
      ? matchCanonical(params.espacio, cat.espaciosDisponibles) || null
      : undefined;
  return { tratamiento, medico, espacio };
}

/**
 * Garantiza el contrato de que solo se usará filters[0] (por nombres) y devuelve una copia
 * mapeada a canónico. Si el extractor envió valores no canónicos, aquí se corrigen.
 */
export function ensureSingleCanonicalFilter(
  filters: ReadonlyArray<ExtractorFilterNames>,
  params: ToolCallingParamsLike,
  cat: CatalogosDisponibles
): ExtractorFilterNames {
  const f0: ExtractorFilterNames | undefined =
    Array.isArray(filters) && filters.length ? filters[0] : undefined;

  // Fallback mínimo cuando no hay filtro válido del extractor
  if (!f0) {
    const canon = canonicalFromParams(params, cat);
    return {
      tratamientos: canon.tratamiento ? [canon.tratamiento] : [],
      medicos: canon.medico ? [canon.medico] : [],
      espacios: canon.espacio ? [canon.espacio] : [],
      aparatologias: [],
      especialidades: [],
      date_ranges: [], // el use case maneja ausencia/derivación de rangos
    };
  }

  // 1) mapear a nombres canónicos exactos
  const mapped = mapFilterFieldsToCanonical(f0, cat);

  // 2) Si tratamiento llega vacío por extractor, intentar rescatar desde params
  if (!mapped.tratamientos?.length) {
    const canon = canonicalFromParams(params, cat);
    if (canon.tratamiento) mapped.tratamientos = [canon.tratamiento];
  }

  // 3) No mezclar categorías: ya garantizado por mapeo por catálogo distinto
  return mapped;
}

// =============================
// Construcción de inputs para caché (por NOMBRES)
// =============================
export interface FechasItem {
  fecha: ISODate;
}

export interface AvailabilitySearchInputKeyLike {
  id_clinica: number;
  tratamientos: string[]; // nombres exactos
  medicos: string[]; // nombres exactos
  espacios: string[]; // nombres exactos
  fechas: FechasItem[]; // YYYY-MM-DD
}

/**
 * Construye el input clave para la AvailabilitySearchCache garantizando:
 *  - arrays presentes (posiblemente vacíos) con nombres exactos
 *  - fechas normalizadas (YYYY-MM-DD)
 */
export function buildCacheInputKeyLike(
  clinicId: number,
  f0: ExtractorFilterNames,
  fechas: FechasItem[],
  paramsFallback: ToolCallingParamsLike
): AvailabilitySearchInputKeyLike {
  const tratamientos = Array.isArray(f0.tratamientos) ? f0.tratamientos : [];
  const medicos = Array.isArray(f0.medicos) ? f0.medicos : [];
  const espacios = Array.isArray(f0.espacios) ? f0.espacios : [];

  const fechasNorm: FechasItem[] = (fechas || [])
    .map((x) => ({ fecha: String(x?.fecha || "").slice(0, 10) as ISODate }))
    .filter((x) => ISO_DATE_RE.test(x.fecha));

  // Si no hay tratamiento canónico en el filtro, intenta rescatar desde params.
  const tratamientosFinal =
    tratamientos.length > 0
      ? tratamientos
      : (() => {
          // En este contexto no tenemos catálogos, por lo que no podemos rescatar aquí.
          // El rescate en caliente se hace en ensureSingleCanonicalFilter.
          return [] as string[];
        })();

  return {
    id_clinica: clinicId,
    tratamientos: tratamientosFinal,
    medicos,
    espacios,
    fechas: fechasNorm,
  };
}

// =============================
// Pequeñas utilidades de ayuda
// =============================
export function isISODate(s: string): boolean {
  return ISO_DATE_RE.test(String(s || ""));
}

export function isHHMM(s: string): boolean {
  return HHMM_RE.test(String(s || ""));
}

export function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function pickFirst<T>(arr: T[] | undefined | null): T | undefined {
  return Array.isArray(arr) && arr.length ? arr[0] : undefined;
}

/**
 * Determina si hay al menos un nombre no canónico (útil para telemetría).
 */
export function hasNonCanonical(
  values: string[] | undefined,
  catalog: string[]
): boolean {
  if (!Array.isArray(values) || !values.length) return false;
  const set = new Set(catalog);
  return values.some((v) => !set.has(v));
}
