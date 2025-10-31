import { DateTime } from "luxon";

export type ISODate = string; // YYYY-MM-DD

export type DateRange = {
  start: ISODate; // inclusive
  end: ISODate;   // inclusive
};

export type Block = DateRange & {
  direction: "backward" | "forward";
  anchor: ISODate;
};

export type PlannerOptions = {
  /** Tamaño del bloque en días (default 5) */
  blockDays?: number;
  /** Límite hacia adelante desde X en días (default 45) */
  forwardMaxDays?: number;
  /** Si true, permite incluir hoy en el rango backward (por defecto sí) */
  includeToday?: boolean;
};

export type FechasItem = { fecha: ISODate };

// =============================
// Utilidades de fecha
// =============================
function dt(date: ISODate): DateTime {
  return DateTime.fromISO(date, { zone: "utc" }).startOf("day");
}

function iso(d: DateTime): ISODate {
  return d.toISODate() as ISODate; // YYYY-MM-DD
}

function cmpDatesAsc(a: ISODate, b: ISODate): number {
  const da = dt(a).toMillis();
  const db = dt(b).toMillis();
  return da - db;
}

function addDays(d: ISODate, n: number): ISODate {
  return iso(dt(d).plus({ days: n }));
}

function clampRangeToToday(range: DateRange, today: ISODate, includeToday = true): DateRange | null {
  const start = dt(range.start);
  const end = dt(range.end);
  const t = dt(today);

  // Si todo el rango termina antes de hoy, no hay nada que buscar
  if (end < t) return null;

  const clampedStart = start < t ? (includeToday ? t : t.plus({ days: 1 })) : start;
  const clampedEnd = end < t ? (includeToday ? t : t.plus({ days: 1 })) : end;

  if (clampedStart > clampedEnd) return null;
  return { start: iso(clampedStart), end: iso(clampedEnd) };
}

// =============================
// Segmentación: fechas contiguas -> rangos
// =============================
export function segmentContiguousRanges(sortedDates: ISODate[]): DateRange[] {
  if (!sortedDates.length) return [];
  const res: DateRange[] = [];
  let runStart = sortedDates[0];
  let prev = sortedDates[0];

  for (let i = 1; i < sortedDates.length; i++) {
    const cur = sortedDates[i];
    const expectedNext = addDays(prev, 1);
    if (cur === expectedNext) {
      prev = cur;
      continue;
    }
    // cerramos rango
    res.push({ start: runStart, end: prev });
    // iniciamos nuevo
    runStart = cur;
    prev = cur;
  }
  res.push({ start: runStart, end: prev });
  return res;
}

// =============================
// Anclas (primera fecha de cada rango)
// =============================
export function pickAnchorsFromExtractorDates(fechas: FechasItem[]): ISODate[] {
  const uniqueSorted = Array.from(
    new Set(
      (fechas || [])
        .map((f) => f?.fecha)
        .filter((x): x is ISODate => !!x)
        .sort(cmpDatesAsc)
    )
  );
  const ranges = segmentContiguousRanges(uniqueSorted);
  return ranges.map((r) => r.start);
}

export function orderAnchorsByCloseness(anchors: ISODate[], nowISO: ISODate): ISODate[] {
  const arr = [...anchors];
  arr.sort((a, b) => {
    const da = Math.abs(dt(a).diff(dt(nowISO), "days").days);
    const db = Math.abs(dt(b).diff(dt(nowISO), "days").days);
    if (da !== db) return da - db;
    return cmpDatesAsc(a, b);
  });
  return arr;
}

export function chooseClosestDate(dates: ISODate[], nowISO: ISODate): ISODate | null {
  if (!dates.length) return null;
  return orderAnchorsByCloseness(dates, nowISO)[0] || null;
}

// =============================
// Planificación de bloques alrededor de un ancla
// =============================
export function planBlocksAroundAnchor(
  anchor: ISODate,
  nowISO: ISODate,
  opts?: PlannerOptions
): Block[] {
  const blockDays = Math.max(1, Math.floor(opts?.blockDays ?? 5));
  const forwardMaxDays = Math.max(blockDays, Math.floor(opts?.forwardMaxDays ?? 45));
  const includeToday = opts?.includeToday ?? true;

  const blocks: Block[] = [];
  const today = nowISO; // hoy en local-UTC (ya normalizado por la app)

  // BACKWARD: desde X hacia atrás hasta hoy (sin incluir días < hoy)
  // Primer bloque incluye X y cubre blockDays días hacia atrás, p.ej. [X-4..X]
  let backEnd = anchor;
  let backStart = iso(dt(anchor).minus({ days: blockDays - 1 }));

  while (dt(backEnd) >= dt(today)) {
    const rawRange: DateRange = { start: backStart, end: backEnd };
    const clamped = clampRangeToToday(rawRange, today, includeToday);
    if (clamped) {
      blocks.push({ ...clamped, direction: "backward", anchor });
    }
    // siguiente bloque atrás (no solapado)
    backEnd = iso(dt(backStart).minus({ days: 1 }));
    backStart = iso(dt(backEnd).minus({ days: blockDays - 1 }));
  }

  // FORWARD: desde X+1 hasta X+forwardMaxDays en bloques de blockDays
  let fwdStart = iso(dt(anchor).plus({ days: 1 }));
  let fwdEnd = iso(dt(fwdStart).plus({ days: blockDays - 1 }));
  const forwardLimit = iso(dt(anchor).plus({ days: forwardMaxDays }));

  while (dt(fwdStart) <= dt(forwardLimit)) {
    const end = dt(fwdEnd) > dt(forwardLimit) ? forwardLimit : fwdEnd;
    blocks.push({ start: fwdStart, end, direction: "forward", anchor });
    // siguiente bloque adelante (no solapado)
    fwdStart = iso(dt(end).plus({ days: 1 }));
    fwdEnd = iso(dt(fwdStart).plus({ days: blockDays - 1 }));
  }

  return blocks;
}

// =============================
// Colapsar rangos superpuestos o contiguos
// =============================
export function collapseRanges(ranges: DateRange[]): DateRange[] {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a, b) => cmpDatesAsc(a.start, b.start));
  const res: DateRange[] = [];

  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    const curEndNext = addDays(cur.end, 1);
    if (dt(r.start) <= dt(curEndNext)) {
      // superpone o es contiguo → extender
      if (dt(r.end) > dt(cur.end)) cur.end = r.end;
    } else {
      res.push({ ...cur });
      cur = { ...r };
    }
  }
  res.push({ ...cur });
  return res;
}

// =============================
// Expandir rango a lista de fechas {fecha}
// =============================
export function expandRangeToFechas(range: DateRange): FechasItem[] {
  const out: FechasItem[] = [];
  let d = dt(range.start);
  const end = dt(range.end);
  while (d <= end) {
    out.push({ fecha: iso(d) });
    d = d.plus({ days: 1 });
  }
  return out;
}

export function expandBlocksToFechas(blocks: Block[]): FechasItem[][] {
  return blocks.map((b) => expandRangeToFechas(b));
}

// =============================
// Planificador completo (anclas + bloques)
// =============================
export function planAllBlocks(
  extractorFechas: FechasItem[],
  nowISO: ISODate,
  opts?: PlannerOptions
): { anchors: ISODate[]; blocksByAnchor: Map<ISODate, Block[]> } {
  const anchors = orderAnchorsByCloseness(
    pickAnchorsFromExtractorDates(extractorFechas),
    nowISO
  );
  const blocksByAnchor = new Map<ISODate, Block[]>();
  for (const a of anchors) {
    blocksByAnchor.set(a, planBlocksAroundAnchor(a, nowISO, opts));
  }
  return { anchors, blocksByAnchor };
}

// =============================
// Helper para colapsar todos los bloques a rangos compactos
// =============================
export function collapseBlocksToRanges(blocks: Block[]): DateRange[] {
  const ranges = blocks.map(({ start, end }) => ({ start, end }));
  return collapseRanges(ranges);
}