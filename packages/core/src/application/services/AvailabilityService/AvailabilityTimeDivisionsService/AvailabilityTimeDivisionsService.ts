// packages/core/src/application/services/AvailabilityService/AvailabilityTimeDivisionsService/AvailabilityTimeDivisionsService.ts

/*
 * AvailabilityTimeDivisionsService
 * ---------------------------------
 * Servicio utilitario para dividir los slots de un día en "divisiones horarias"
 * estratégicas (mañana, mediodía, tarde) y operar sobre ellas.
 *
 * Objetivos:
 *  - Asignar cada slot a una y solo una división horaria (rangos inclusivos por inicio).
 *  - Proveer un resumen de cobertura por división.
 *  - Permitir seleccionar al menos un slot por división para garantizar variedad.
 *  - Mantener helpers puros y deterministas (sin I/O externo).
 */

import { Logger } from "@clinickeys-agents/core/infrastructure/external";

// =============================
// Tipos públicos
// =============================

export type HHMM = `${string}:${string}`; // "HH:mm"

/** Slot mínimo compatible con el dominio actual */
export interface DaySlot {
  fecha_cita: string; // YYYY-MM-DD
  hora_inicio: HHMM;  // HH:mm
  id_medico?: number | string;
  id_espacio?: number | string;
  [k: string]: unknown;
}

export interface DivisionConfig {
  /** Identificador estable de la división (ej. "mañana", "mediodía", "tarde") */
  key: string;
  /** Límite inferior inclusivo HH:mm */
  start: HHMM;
  /** Límite superior inclusivo HH:mm (se acepta 24:00 como alias de 23:59) */
  end: HHMM;
  /** Orden ascendente para presentación */
  order: number;
}

export interface DayDivisionsResult {
  /** Fecha de trabajo (YYYY-MM-DD) */
  date: string;
  /** Mapa key→slots pertenecientes a la división */
  buckets: Map<string, DaySlot[]>;
  /** Config usada (normalizada y ordenada) */
  config: DivisionConfig[];
  /** Métricas de cobertura */
  coverage: {
    totalSlots: number;
    nonEmptyDivisions: number;
    emptyDivisions: string[];
  };
}

export interface VarietyPickOptions {
  /** Prioridad de divisiones (si se indica, se intentará elegir primero de estas) */
  preferredDivisions?: string[];
  /** Máximo de slots a devolver (por defecto, uno por división no vacía) */
  maxTotal?: number;
  /** Si true, elige el slot más cercano a un conjunto de HH:mm objetivo por división */
  nearTargets?: HHMM[];
}

// =============================
// Utilidades de tiempo (HH:mm)
// =============================

const HHMM_RE = /^(\d{2}):(\d{2})$/;

function parseHHMM(val: string): { h: number; m: number } | null {
  const m = String(val).trim().match(HHMM_RE);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 24 || mm < 0 || mm > 59) return null;
  if (h === 24 && mm !== 0) return null; // solo 24:00 permitido
  return { h, m: mm };
}

function toMinutes(val: HHMM): number {
  const p = parseHHMM(val);
  if (!p) return Number.NaN;
  if (p.h === 24 && p.m === 0) return 24 * 60 - 1; // 24:00 ≈ 23:59 inclusivo
  return p.h * 60 + p.m;
}

function cmpHHMM(a: HHMM, b: HHMM): number {
  return toMinutes(a) - toMinutes(b);
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function inRangeInclusive(x: HHMM, start: HHMM, end: HHMM): boolean {
  const v = toMinutes(x);
  return v >= toMinutes(start) && v <= toMinutes(end);
}

function sortByTimeAsc<T extends { hora_inicio: HHMM }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => cmpHHMM(a.hora_inicio, b.hora_inicio));
}

function minutesToHHMM(totalMinutes: number): HHMM {
  const minutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hh = h < 10 ? `0${h}` : String(h);
  const mm = m < 10 ? `0${m}` : String(m);
  return `${hh}:${mm}` as HHMM;
}

// =============================
// Config por defecto (ES)
// =============================

const RAW_DEFAULT_DIVISIONS: DivisionConfig[] = [
  { key: "mañana", start: "07:00", end: "11:59", order: 10 },
  { key: "mediodía", start: "12:00", end: "14:59", order: 20 },
  { key: "tarde", start: "15:00", end: "22:59", order: 30 },
];

/**
 * Devuelve una configuración por defecto pensada para clínicas en ES (24h).
 *
 * Bloques:
 *  - mañana:     07:00–11:59
 *  - mediodía:   12:00–14:59
 *  - tarde:      15:00–22:59
 */
export function getDefaultDivisionsConfig(): DivisionConfig[] {
  return validateAndNormalizeConfig(RAW_DEFAULT_DIVISIONS.map((d) => ({ ...d })));
}

/**
 * Valida, normaliza y ordena una lista de divisiones.
 * - Garantiza HH:mm válidos y orden creciente por `order`.
 * - Lanza error si hay solapes.
 */
export function validateAndNormalizeConfig(input: DivisionConfig[]): DivisionConfig[] {
  if (!Array.isArray(input) || !input.length) throw new Error("DivisionConfig vacío");

  const seen = new Set<string>();
  const out = input.map((d) => ({ ...d }))
    .map((d) => {
      if (!parseHHMM(d.start) || !parseHHMM(d.end)) {
        throw new Error(`DivisionConfig inválido en ${d.key}: start/end`);
      }
      if (cmpHHMM(d.start, d.end) > 0) {
        throw new Error(`DivisionConfig con start>end en ${d.key}`);
      }
      const key = String(d.key || "").trim();
      if (!key) throw new Error("DivisionConfig.key requerido");
      if (seen.has(key)) throw new Error(`DivisionConfig.key duplicado: ${key}`);
      seen.add(key);
      return { ...d, key };
    })
    .sort((a, b) => a.order - b.order);

  // validar solapes
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (toMinutes(cur.start) <= toMinutes(prev.end)) {
      throw new Error(`Divisiones solapadas: ${prev.key} ↔ ${cur.key}`);
    }
  }
  return out;
}

const DIVISION_ALIAS_MAP: Record<string, string> = {
  manana: "mañana",
  "mañana": "mañana",
  morning: "mañana",
  temprano: "mañana",
  "primer turno": "mañana",
  mediodia: "mediodía",
  "medio dia": "mediodía",
  "medio-dia": "mediodía",
  almuerzo: "mediodía",
  lunch: "mediodía",
  tarde: "tarde",
  tardes: "tarde",
  evening: "tarde",
  tardeada: "tarde",
  noche: "tarde",
  nocturno: "tarde",
  atardecer: "tarde",
  vespertino: "tarde",
};

function normalizeDivisionToken(raw: string): string {
  return stripAccents(String(raw || "")).trim().toLowerCase();
}

export function normalizeDivisionKey(
  value: string,
  config: DivisionConfig[] = getDefaultDivisionsConfig(),
): string | null {
  const normValue = normalizeDivisionToken(value);
  if (!normValue) return null;

  const configMap = new Map<string, string>();
  for (const division of validateAndNormalizeConfig(config.map((d) => ({ ...d })))) {
    configMap.set(normalizeDivisionToken(division.key), division.key);
  }

  if (configMap.has(normValue)) return configMap.get(normValue)!;

  const aliasTarget = DIVISION_ALIAS_MAP[normValue];
  if (aliasTarget) {
    const canonical = configMap.get(normalizeDivisionToken(aliasTarget));
    if (canonical) return canonical;
  }

  return null;
}

export function resolveDivisionForTime(
  time: HHMM,
  config: DivisionConfig[] = getDefaultDivisionsConfig(),
): string | null {
  const normCfg = validateAndNormalizeConfig(config.map((d) => ({ ...d })));
  for (const division of normCfg) {
    if (inRangeInclusive(time, division.start, division.end)) return division.key;
  }
  return null;
}

export function getDivisionRangeMap(
  config: DivisionConfig[] = getDefaultDivisionsConfig(),
): Map<string, { start: HHMM; end: HHMM }> {
  const map = new Map<string, { start: HHMM; end: HHMM }>();
  for (const division of validateAndNormalizeConfig(config.map((d) => ({ ...d })))) {
    map.set(division.key, { start: division.start, end: division.end });
  }
  return map;
}

export function getDivisionMidpoint(
  key: string,
  config: DivisionConfig[] = getDefaultDivisionsConfig(),
): HHMM | null {
  const normCfg = validateAndNormalizeConfig(config.map((d) => ({ ...d })));
  const division = normCfg.find((d) => d.key === key);
  if (!division) return null;
  const avg = Math.floor((toMinutes(division.start) + toMinutes(division.end)) / 2);
  return minutesToHHMM(avg);
}

export function getDivisionKeys(config: DivisionConfig[] = getDefaultDivisionsConfig()): string[] {
  return validateAndNormalizeConfig(config.map((d) => ({ ...d }))).map((d) => d.key);
}

// =============================
// Núcleo: asignación y cobertura
// =============================

export function assignDaySlotsToDivisions(
  date: string,
  slots: DaySlot[],
  config: DivisionConfig[] = getDefaultDivisionsConfig(),
): DayDivisionsResult {
  const normCfg = validateAndNormalizeConfig(config);
  const buckets = new Map<string, DaySlot[]>();
  for (const d of normCfg) buckets.set(d.key, []);

  const sameDateSlots = (slots || []).filter((s) => s && String(s.fecha_cita) === date);
  for (const s of sameDateSlots) {
    // asignar a la primera división cuyo rango lo contenga
    const found = normCfg.find((d) => inRangeInclusive(s.hora_inicio as HHMM, d.start, d.end));
    if (found) {
      const arr = buckets.get(found.key)!;
      arr.push(s);
    }
  }

  // ordenar intra-bucket por hora ascendente
  for (const key of buckets.keys()) buckets.set(key, sortByTimeAsc(buckets.get(key)!));

  const nonEmptyKeys: string[] = [];
  for (const d of normCfg) if ((buckets.get(d.key) || []).length > 0) nonEmptyKeys.push(d.key);

  const res: DayDivisionsResult = {
    date,
    buckets,
    config: normCfg,
    coverage: {
      totalSlots: sameDateSlots.length,
      nonEmptyDivisions: nonEmptyKeys.length,
      emptyDivisions: normCfg.map((d) => d.key).filter((k) => !nonEmptyKeys.includes(k)),
    },
  };

  return res;
}

// =============================
// Selección de variedad
// =============================

/**
 * Elige hasta `maxTotal` slots asegurando, en lo posible, al menos 1 por división no vacía.
 * - Si `preferredDivisions` está definido, intenta cubrir esas primero.
 * - Dentro de una división elige el slot más cercano a `nearTargets` (si existen),
 *   o el más temprano por defecto.
 */
export function pickVarietySlots(
  day: DayDivisionsResult,
  opts?: VarietyPickOptions,
): DaySlot[] {
  const preferred = dedupeStrings((opts?.preferredDivisions || []).map(normalizeKey));
  const maxTotal = Math.max(1, Math.floor(opts?.maxTotal ?? Number.POSITIVE_INFINITY));
  const nearTargets = (opts?.nearTargets || []).filter((t) => !!parseHHMM(t));

  const orderKeys = resolveDivisionOrder(day.config, preferred);
  const picked: DaySlot[] = [];
  const seen = new Set<string>();

  for (const key of orderKeys) {
    if (picked.length >= maxTotal) break;
    const bucket = day.buckets.get(key) || [];
    if (!bucket.length) continue;

    const chosen = chooseFromBucket(bucket, nearTargets);
    const uniq = slotKey(chosen);
    if (!seen.has(uniq)) {
      seen.add(uniq);
      picked.push(chosen);
    }
  }

  // Si aún falta para maxTotal, completar cronológico entre todos los buckets
  if (picked.length < maxTotal) {
    const all = Array.from(day.buckets.values()).flat();
    for (const s of sortByTimeAsc(all)) {
      if (picked.length >= maxTotal) break;
      const k = slotKey(s);
      if (!seen.has(k)) { seen.add(k); picked.push(s); }
    }
  }

  return picked;
}

// =============================
// Helpers internos
// =============================

function dedupeStrings(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of arr) if (!seen.has(s)) { seen.add(s); out.push(s); }
  return out;
}

function normalizeKey(k: string): string {
  return normalizeDivisionToken(k);
}

function resolveDivisionOrder(config: DivisionConfig[], preferred: string[]): string[] {
  const cfgKeys = config.map((c) => normalizeKey(c.key));
  const preferredValid = preferred.filter((k) => cfgKeys.includes(k));
  const rest = cfgKeys.filter((k) => !preferredValid.includes(k));
  return [...preferredValid, ...rest];
}

function chooseFromBucket(bucket: DaySlot[], nearTargets: HHMM[]): DaySlot {
  if (!nearTargets.length) return bucket[0]; // más temprano
  // elegir el slot cuya hora esté más cerca a cualquier target
  let best: DaySlot = bucket[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of bucket) {
    const v = toMinutes(s.hora_inicio as HHMM);
    for (const t of nearTargets) {
      const d = Math.abs(v - toMinutes(t));
      if (d < bestDist) { bestDist = d; best = s; }
    }
  }
  return best;
}

function slotKey(s: DaySlot): string {
  return `${s.fecha_cita}T${s.hora_inicio}|${s.id_medico ?? ""}|${s.id_espacio ?? ""}`;
}

// =============================
// Fachada del servicio
// =============================

export class AvailabilityTimeDivisionsService {
  /** Config por defecto (validada) */
  static defaultConfig(): DivisionConfig[] { return getDefaultDivisionsConfig(); }

  /**
   * Asigna slots de UN día a divisiones.
   */
  static assignDay(date: string, slots: DaySlot[], config?: DivisionConfig[]): DayDivisionsResult {
    return assignDaySlotsToDivisions(date, slots, config || getDefaultDivisionsConfig());
  }

  /**
   * Asigna slots de MUCHOS días. Devuelve un Map fecha→resultado.
   */
  static assignMany(
    byDate: Map<string, DaySlot[]>,
    config?: DivisionConfig[],
  ): Map<string, DayDivisionsResult> {
    const out = new Map<string, DayDivisionsResult>();
    const normCfg = validateAndNormalizeConfig(config || getDefaultDivisionsConfig());
    for (const [date, slots] of byDate.entries()) {
      out.set(date, assignDaySlotsToDivisions(date, slots, normCfg));
    }
    return out;
  }

  /**
   * Selecciona variedad por día (mín. 1 por división no vacía), con tope opcional.
   */
  static pickVarietyForDay(day: DayDivisionsResult, opts?: VarietyPickOptions): DaySlot[] {
    return pickVarietySlots(day, opts);
  }

  /**
   * Log amigable para diagnóstico (no bloqueante).
   */
  static logCoverage(day: DayDivisionsResult): void {
    try {
      const nonEmpty = Array.from(day.buckets.entries())
        .filter(([_, arr]) => (arr || []).length > 0)
        .map(([k, arr]) => `${k}(${arr.length})`)
        .join(", ");
      Logger.info("[TimeDivisions] Cobertura", {
        date: day.date,
        total: day.coverage.totalSlots,
        nonEmpty: day.coverage.nonEmptyDivisions,
        nonEmptyKeys: nonEmpty,
        empty: day.coverage.emptyDivisions,
      });
    } catch { /* noop */ }
  }
}

export default AvailabilityTimeDivisionsService;
