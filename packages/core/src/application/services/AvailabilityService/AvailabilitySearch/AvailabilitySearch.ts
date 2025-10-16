/*
 * AvailabilitySearch.ts
 * Tipos y esquemas Zod del nuevo motor de búsqueda de disponibilidades
 * (sin compatibilidad legacy, sin sufijos "v2").
 */

import { z } from "zod";

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
// Rango de fechas
// =============================
export const DateRangeSchema = z
  .object({
    start: ISODateSchema, // inclusive
    end: ISODateSchema,   // inclusive
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
  "manana",     // 06:00–11:59
  "mediodia",   // 12:00–14:59
  "tarde",      // 15:00–17:59
  "noche",      // 18:00–23:59
]);

export type TimeDivisionKey = z.infer<typeof TimeDivisionKeySchema>;

export const TimeDivisionSchema = z
  .object({
    key: TimeDivisionKeySchema,
    start: HHMMSchema, // inclusive
    end: HHMMSchema,   // inclusive
  })
  .strict();

export type TimeDivision = z.infer<typeof TimeDivisionSchema>;

// Preset por defecto (usado por AvailabilityTimeDivisionsService)
export const DefaultTimeDivisions: Readonly<TimeDivision[]> = [
  { key: "manana", start: "06:00", end: "11:59" },
  { key: "mediodia", start: "12:00", end: "14:59" },
  { key: "tarde", start: "15:00", end: "17:59" },
  { key: "noche", start: "18:00", end: "23:59" },
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
  "explicit_single",        // fecha suelta que mencionó la persona
  "range_first_day",       // primer día de un rango mencionado
  "range_follow_up",       // resto de días del rango mencionado
  "weekday_preference",    // coincide con preferencias de días (jueves/viernes, etc.)
  "proximity_filler",      // fechas cercanas al presente no mencionadas
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
    id_medico: z.union([z.number(), z.string()]).nullable().default(null),
    nombre_medico: z.string().nullable().default(null),
    id_espacio: z.union([z.number(), z.string()]).nullable().default(null),
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
    divisions: z.array(TimeDivisionSchema).default(DefaultTimeDivisions as any),
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
  "exhausted",  // se agotó el horizonte (o fechas rankeadas) sin llegar al objetivo
  "error",      // falla no recuperable
]);

export type SearchStopReason = z.infer<typeof SearchStopReasonSchema>;

export const AvailabilitySearchSummarySchema = z
  .object({
    consultedDates: z.array(ISODateSchema),
    discardedDates: z.array(ISODateSchema),
    daysCompleted: z.array(ISODateSchema),
    daysPartial: z.array(ISODateSchema),
    divisionCoverageByDay: z.record(ISODateSchema, z.record(TimeDivisionKeySchema, DivisionCoverageItemSchema)),
    steps: z.array(SearchStepSchema),
    stopReason: SearchStopReasonSchema,
    totalSlots: z.number().int().min(0),
    cacheHits: z.number().int().min(0).default(0),
  })
  .strict();

export type AvailabilitySearchSummary = z.infer<typeof AvailabilitySearchSummarySchema>;

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

export type AvailabilitySearchResult = z.infer<typeof AvailabilitySearchResultSchema>;

// =============================
// Utilidades de types
// =============================
export function isISODate(s: string): boolean {
  return ISO_DATE_RE.test(String(s || ""));
}

export function isHHMM(s: string): boolean {
  return HHMM_RE.test(String(s || ""));
}