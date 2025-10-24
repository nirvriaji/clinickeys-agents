// packages/core/src/application/services/AvailabilityService/AvailabilityDateRankingService/AvailabilityDateRankingService.ts

import { DateTime } from "luxon";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import type { ExtractorFilter, ExtractorDateRange } from "@clinickeys-agents/core/application/services/types";

// =============================
// Tipos públicos
// =============================
export type ISODate = string; // YYYY-MM-DD

export interface DateRankingInput {
  /** Fecha "hoy" en ISO local-normalizado (YYYY-MM-DD) */
  nowISODate: ISODate;
  /** Fechas sueltas mencionadas explícitamente por la persona */
  explicitDates?: ISODate[];
  /** Rangos mencionados (inclusive) */
  ranges?: { start: ISODate; end: ISODate }[];
  /** Días de semana preferidos (ISO: 1=Lunes..7=Domingo). Ej.: [4,5] => Jueves/Viernes */
  weekdaysPreferred?: number[];
  /** Extensión hacia adelante por defecto cuando no hay tope explícito. Default 45 */
  forwardExtensionDays?: number;
}

export interface RankedDate {
  fecha: ISODate;
  rankBucket: "explicit" | "range_first" | "weekday_pref" | "range_rest" | "fill";
}

export interface DateRankingResult {
  orderedDates: RankedDate[]; // ordenado de mayor prioridad → menor
  horizonStart: ISODate; // hoy (clamp)
  horizonEnd: ISODate;   // límite calculado
}

// =============================
// API principal
// =============================
export class AvailabilityDateRankingService {
  /**
   * Construye la lista **ordenada** de fechas a consultar cumpliendo las reglas de negocio:
   * 1) Mayor ranking a fechas más cercanas al presente.
   * 2) Prioridad: fechas sueltas → primeras de cada rango → (si aplica) días de semana preferidos → resto de rangos → relleno hasta el horizonte.
   * 3) Horizonte: si el usuario no fija tope, hoy + 45d. Si existe una fecha máxima mencionada, el horizonte es **máxima + 45d**.
   * 4) Si el usuario menciona solo días de semana (p. ej. jueves/viernes), la lista se encabeza con **todas** las que caen en esos días dentro del horizonte y luego se rellena.
   */
  static buildRankedDates(input: DateRankingInput): DateRankingResult {
    const forward = Math.max(1, Math.floor(input.forwardExtensionDays ?? 45));
    const today = dt(input.nowISODate).startOf("day");

    // Normalizar entradas
    const explicit = uniqueISO(validDates(input.explicitDates));
    const ranges = normalizeRanges(validRanges(input.ranges));

    const maxUserDate = latestMentionedDate(explicit, ranges);
    const horizonEnd = maxUserDate
      ? dt(maxUserDate).plus({ days: forward })
      : today.plus({ days: forward });

    const horizonStart = today; // no consultamos fechas < hoy

    // Colecciones auxiliares
    const chosen = new Set<string>();
    const pushIfNew = (arr: RankedDate[], fecha: ISODate, rankBucket: RankedDate["rankBucket"]) => {
      if (!isWithin(fecha, horizonStart, horizonEnd)) return;
      if (chosen.has(fecha)) return;
      chosen.add(fecha);
      arr.push({ fecha, rankBucket });
    };

    // 1) EXPlicit dates (orden por cercanía al presente)
    const bucketExplicit = sortByCloseness(explicit, today);

    // 2) Ranges ordenados por cercanía de su start
    const sortedRanges = [...ranges].sort((a, b) => {
      const da = Math.abs(dt(a.start).diff(today, "days").days);
      const db = Math.abs(dt(b.start).diff(today, "days").days);
      if (da !== db) return da - db;
      return cmpISO(a.start, b.start);
    });

    // 2.a) Primer día de cada rango
    const bucketRangeFirst: ISODate[] = [];
    for (const r of sortedRanges) {
      const first = r.start;
      if (!bucketExplicit.includes(first)) bucketRangeFirst.push(first);
    }

    // 3) Weekday preferred (si aplica): todas las fechas dentro del horizonte que caigan en esos días
    const weekdaySet = new Set((input.weekdaysPreferred || []).map((x) => Math.floor(x)));
    const bucketWeekdayPref: ISODate[] = [];
    if (weekdaySet.size > 0) {
      for (let d = horizonStart; d <= horizonEnd; d = d.plus({ days: 1 })) {
        if (weekdaySet.has(d.weekday)) bucketWeekdayPref.push(iso(d));
      }
    }

    // 4) Resto de cada rango (orden natural dentro del rango, rangos en el orden ya ordenado)
    const bucketRangeRest: ISODate[] = [];
    for (const r of sortedRanges) {
      let cursor = dt(r.start).plus({ days: 1 });
      const end = dt(r.end);
      while (cursor <= end) {
        const f = iso(cursor);
        if (!bucketExplicit.includes(f) && !bucketRangeFirst.includes(f)) {
          bucketRangeRest.push(f);
        }
        cursor = cursor.plus({ days: 1 });
      }
    }

    // 5) Relleno: todas las fechas del horizonte que no hayan sido incluidas aún
    const bucketFill: ISODate[] = [];
    for (let d = horizonStart; d <= horizonEnd; d = d.plus({ days: 1 })) {
      const f = iso(d);
      if (
        !bucketExplicit.includes(f) &&
        !bucketRangeFirst.includes(f) &&
        !bucketWeekdayPref.includes(f) &&
        !bucketRangeRest.includes(f)
      ) {
        bucketFill.push(f);
      }
    }

    // Mezcla final por prioridad + orden interno
    const out: RankedDate[] = [];

    // A) Explícitas (por cercanía → si hay empates, cronológico)
    for (const f of bucketExplicit) pushIfNew(out, f, "explicit");

    // B) Primer día de rango (orden por cercanía del start del rango)
    for (const f of sortByCloseness(bucketRangeFirst, today)) pushIfNew(out, f, "range_first");

    // C) Días de semana preferidos (cronológicos y cercanos por ser ventana futura)
    for (const f of sortAsc(bucketWeekdayPref)) pushIfNew(out, f, "weekday_pref");

    // D) Resto de rangos (ya está en orden natural por rango)
    for (const f of bucketRangeRest) pushIfNew(out, f, "range_rest");

    // E) Relleno final (cronológico)
    for (const f of sortAsc(bucketFill)) pushIfNew(out, f, "fill");

    Logger.info("[AvailabilityDateRankingService] Ranking construido", {
      explicit: bucketExplicit.length,
      range_first: bucketRangeFirst.length,
      weekday_pref: bucketWeekdayPref.length,
      range_rest: bucketRangeRest.length,
      fill: bucketFill.length,
      ordered: out.length,
      horizonStart: iso(horizonStart),
      horizonEnd: iso(horizonEnd),
    });

    return { orderedDates: out, horizonStart: iso(horizonStart), horizonEnd: iso(horizonEnd) };
  }

  /**
   * Helper: Construir ranking a partir de los filtros del extractor.
   * Toma todos los `date_ranges` (start==end cuenta como fecha suelta) y deduce el horizonte.
   */
  static fromExtractorFilters(params: {
    filters: ExtractorFilter[];
    nowISODate: ISODate;
    weekdaysPreferred?: number[];
    forwardExtensionDays?: number;
  }): DateRankingResult {
    const { filters, nowISODate, weekdaysPreferred, forwardExtensionDays } = params;

    const explicit: ISODate[] = [];
    const ranges: { start: ISODate; end: ISODate }[] = [];

    for (const f of filters ?? []) {
      const drs: ExtractorDateRange[] = Array.isArray(f.date_ranges) ? f.date_ranges : [];
      for (const r of drs) {
        const start = r?.start_date;
        const end = r?.end_date ?? r?.start_date;
        if (!isISO(start) || !isISO(end)) continue;
        if (start === end) explicit.push(start);
        ranges.push({ start, end });
      }
    }

    return AvailabilityDateRankingService.buildRankedDates({
      nowISODate,
      explicitDates: explicit,
      ranges,
      weekdaysPreferred,
      forwardExtensionDays,
    });
  }
}

// =============================
// Utilidades internas
// =============================
function dt(d: ISODate): DateTime {
  return DateTime.fromISO(d, { zone: "utc" }).startOf("day");
}
function iso(d: DateTime): ISODate { return d.toISODate() as ISODate; }
function isISO(s: unknown): s is ISODate { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function cmpISO(a: ISODate, b: ISODate): number {
  const da = dt(a).toMillis();
  const db = dt(b).toMillis();
  return da - db;
}

function isWithin(fecha: ISODate, start: DateTime, end: DateTime): boolean {
  const d = dt(fecha);
  return d >= start && d <= end;
}

function validDates(arr?: ISODate[] | null): ISODate[] {
  return (arr || []).filter(isISO);
}

function validRanges(arr?: { start: ISODate; end: ISODate }[] | null): { start: ISODate; end: ISODate }[] {
  return (arr || []).filter((r) => isISO(r.start) && isISO(r.end));
}

function uniqueISO(arr: ISODate[]): ISODate[] {
  return Array.from(new Set(arr)).sort(cmpISO);
}

function normalizeRanges(ranges: { start: ISODate; end: ISODate }[]): { start: ISODate; end: ISODate }[] {
  return ranges
    .map((r) => ({ start: r.start, end: dt(r.start) <= dt(r.end) ? r.end : r.start })) // corrige si viene invertido
    .sort((a, b) => cmpISO(a.start, b.start));
}

function latestMentionedDate(explicit: ISODate[], ranges: { start: ISODate; end: ISODate }[]): ISODate | null {
  let maxStr: ISODate | null = null;
  for (const d of explicit || []) if (!maxStr || cmpISO(d, maxStr) > 0) maxStr = d;
  for (const r of ranges || []) {
    if (!maxStr || cmpISO(r.end, maxStr) > 0) maxStr = r.end;
  }
  return maxStr;
}

function sortByCloseness(dates: ISODate[], base: DateTime): ISODate[] {
  return [...dates].sort((a, b) => {
    const da = Math.abs(dt(a).diff(base, "days").days);
    const db = Math.abs(dt(b).diff(base, "days").days);
    if (da !== db) return da - db;
    return cmpISO(a, b);
  });
}

function sortAsc(dates: ISODate[]): ISODate[] {
  return [...dates].sort(cmpISO);
}