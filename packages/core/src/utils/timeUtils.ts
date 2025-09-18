import { DateTime } from "luxon";

/**
 * Convierte una cadena HH:mm:ss a minutos desde la medianoche.
 * Ejemplo: "01:30:00" -> 90
 */
export function toMinutes(hhmmss: string): number {
  if (!hhmmss) return 0;
  const [hRaw, mRaw, sRaw] = hhmmss.split(":");
  const h = parseInt(hRaw || "0", 10);
  const m = parseInt(mRaw || "0", 10);
  const s = parseInt(sRaw || "0", 10);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m) + Math.floor((isNaN(s) ? 0 : s) / 60);
}

/**
 * Convierte minutos desde la medianoche a formato HH:mm:ss.
 * Ejemplo: 90 -> "01:30:00"
 */
export function toHHMMSS(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:00`;
}

/**
 * Devuelve la parte YYYY-MM-DD de una fecha en string o DateTime.
 */
export function ymd(date: string | DateTime): string {
  if (typeof date === "string") {
    return DateTime.fromISO(date).toISODate() ?? date.slice(0, 10);
  }
  return date.toISODate() ?? "";
}

/**
 * Compara si dos fechas (string o DateTime) son el mismo día calendario.
 */
export function isSameYMD(a: string | DateTime, b: string | DateTime): boolean {
  return ymd(a) === ymd(b);
}

/**
 * Parsea una fecha (YYYY-MM-DD o ISO) y una hora (HH:mm:ss) a un DateTime.
 * @param date Fecha en formato YYYY-MM-DD o ISO.
 * @param time Hora en formato HH:mm:ss.
 * @param zone Zona horaria opcional.
 */
export function parseDateTime(
  date: string,
  time: string,
  zone?: string
): DateTime {
  const [h, m, s] = time.split(":").map((v) => parseInt(v, 10) || 0);
  return DateTime.fromISO(date, { zone }).set({
    hour: h,
    minute: m,
    second: s,
  });
}

/**
 * Calcula la intersección entre dos rangos de minutos.
 * Devuelve [start, end) si hay traslape, o null si no lo hay.
 */
export function intersectRange(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): [number, number] | null {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return start < end ? [start, end] : null;
}

/**
 * Resta un conjunto de rangos bloqueados a un rango base.
 * Devuelve los segmentos libres.
 */
export function subtractRanges(
  base: { start: number; end: number },
  blocks: { start: number; end: number }[]
): { start: number; end: number }[] {
  if (!blocks.length) return [base];
  const sorted = [...blocks].sort((x, y) => x.start - y.start);
  const result: { start: number; end: number }[] = [];
  let cursor = base.start;

  for (const b of sorted) {
    if (b.end <= cursor) continue;
    if (b.start >= base.end) break;

    if (b.start > cursor) {
      result.push({ start: cursor, end: Math.min(b.start, base.end) });
    }
    cursor = Math.max(cursor, b.end);
    if (cursor >= base.end) break;
  }

  if (cursor < base.end) {
    result.push({ start: cursor, end: base.end });
  }

  return result.filter((r) => r.end > r.start);
}
