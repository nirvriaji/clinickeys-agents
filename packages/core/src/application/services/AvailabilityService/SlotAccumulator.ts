// packages/core/src/application/services/AvailabilityService/SlotAccumulator.ts

import type {
  AgendaPolicyResolved,
  SlotAccumulatorInput,
  SlotAccumulatorOutput,
} from '@clinickeys-agents/core/application/services';
import {
  AvailabilityTimeDivisionsService,
  getDefaultDivisionsConfig,
  getDivisionKeys,
  getDivisionMidpoint,
  normalizeDivisionKey,
  resolveDivisionForTime,
} from '@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityTimeDivisionsService';
import type { DaySlot, HHMM } from '@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityTimeDivisionsService';
import type { ISODate } from '@clinickeys-agents/core/application/services/AvailabilityService/AvailabilitySearch';

// =============================
// Public API (Nueva estrategia)
// =============================
export async function SlotAccumulator(input: SlotAccumulatorInput): Promise<SlotAccumulatorOutput> {
  const policy = (input.policy || ({} as AgendaPolicyResolved));

  // Defaults
  const minutosGlobales = toSet(
    policy.minutos_globales && policy.minutos_globales.length
      ? policy.minutos_globales.map(twoDigits)
      : DEFAULT_MINUTES_WHITELIST,
  );

  // Reglas por tratamiento (por id y por nombre exacto BD)
  const reglasPorId = new Map<number, Set<string>>();
  const reglasPorNombre = new Map<string, Set<string>>();
  for (const r of policy.reglas_minutos_por_tratamiento_resueltas || []) {
    const mins = new Set((r.minutos_permitidos || []).map(twoDigits));
    if (typeof r.id_tratamiento === 'number') reglasPorId.set(r.id_tratamiento, mins);
    if (r.nombre_tratamiento_bd && r.nombre_tratamiento_bd.length) {
      reglasPorNombre.set(r.nombre_tratamiento_bd, mins);
    }
  }

  // 1) Generar todos los inicios válidos a partir de windows
  const allSlots: AnySlot[] = [];
  for (const w of input.windows || []) {
    const fecha = String((w as any).fecha_cita || (w as any).fecha || '');
    const minRaw = String((w as any).hora_inicio_minima || '');
    const maxRaw = String((w as any).hora_inicio_maxima || '');
    const dur = toInt((w as any).duracion_tratamiento);
    if (!fecha || !dur || dur <= 0) continue;

    const min = toHHMM(minRaw);
    const max = toHHMM(maxRaw);
    if (!min || !max) continue;

    const minutosPermitidos = resolveMinutosPermitidos(
      w,
      reglasPorId,
      reglasPorNombre,
      minutosGlobales,
    );

    // Interpretación fija: max es último INICIO
    for (let t = min; ; t = addMinutesHHMM(t, dur)) {
      if (compareHHMM(t, max) > 0) break; // supera el último inicio
      // Verificar que t cae en la progresión exacta (sumando duración)
      const mm = t.substring(3, 5);
      if (minutosPermitidos.has(mm)) {
        allSlots.push(asSlot(w, fecha, t));
      }
      // Evitar loops infinitos por entradas malas
      const guard = 24 * 60 + 5;
      if (diffMinutesHHMM(min, t) > guard) break;
    }
  }

  // 2) Orden base: fecha↑, hora↑, desempate por id_espacio asc/alfabético estable
  allSlots.sort(slotChronoCmp);

  // Si no hay slots, salida inmediata
  if (!allSlots.length) {
    return buildOutput({
      universo: [],
      seleccionadas: [],
      dias: [],
      contexto: input.contexto,
      reglasAplicadas: {
        minutos_globales: Array.from(minutosGlobales),
        tratamientos_especificos: (policy.reglas_minutos_por_tratamiento_resueltas || []).length,
      },
      tipoBusqueda: 'bloques',
      warnings: ['sin_slots_entrada'],
    });
  }

  // 3) Priorización de días según filtros (si existen); fallback al orden natural de slots
  const dayOrderFromFilters = buildDayPriorityOrder(input.filters || []);
  const allDaysChrono = Array.from(new Set(allSlots.map(s => s.fecha_cita))).sort();

  const rankedDays = Array.isArray(input.contexto?.query_context?.fechas_rankeadas)
    ? input.contexto!.query_context!.fechas_rankeadas.filter((d): d is string => typeof d === 'string')
    : [];

  const combinedOrder = dayOrderFromFilters.length
    ? uniqPreserving([...dayOrderFromFilters, ...allDaysChrono])
    : allDaysChrono;

  const rankingPosition = new Map<string, number>();
  rankedDays.forEach((d, idx) => {
    if (!rankingPosition.has(d)) rankingPosition.set(d, idx);
  });

  const dayOrder = [...combinedOrder].sort((a, b) => {
    const pa = rankingPosition.has(a) ? rankingPosition.get(a)! : Number.MAX_SAFE_INTEGER;
    const pb = rankingPosition.has(b) ? rankingPosition.get(b)! : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  // 4) Agrupar por día y ordenar intra‑día con preferencias
  const perDayMap = groupByDate(allSlots);

  const preferencias = input.contexto?.horas_preferencia_usuario || [];

  const preferredDivisionKeys = preferencias
    .map(p => normalizeDivisionKey(p, DEFAULT_DIVISIONS))
    .filter((k): k is string => typeof k === 'string' && k.length > 0);
  const preferredDivisionSet = new Set(preferredDivisionKeys);
  const requestedDates = collectDatesFromFilters(input.filters || []);
  const nowAnchor = normalizeAnchorDate(input.contexto?.ahoraISO);
  const weekdayPreferenceSet = new Set<number>(
    Array.isArray(input.contexto?.weekday_preferences)
      ? (input.contexto!.weekday_preferences as number[])
          .map((n) => parseInt(String(n), 10))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
      : [],
  );
  const derivedMaxDays = determineMaxDays(dayOrder, requestedDates, weekdayPreferenceSet);
  const effectiveMaxDays = derivedMaxDays ?? MAX_SELECTED_DAYS;

  const dayInfos: DaySelectionInfo[] = [];

  for (const day of dayOrder) {
    const list = perDayMap.get(day) || [];
    if (!list.length) continue;

    const orderedIntra = orderIntraDia(list, preferencias);
    const daySlots: DaySlot[] = orderedIntra.map((slot) => ({
      fecha_cita: slot.fecha_cita,
      hora_inicio: slot.hora_inicio as HHMM,
      id_medico: slot.id_medico,
      id_espacio: slot.id_espacio,
    }));
    const assignment = AvailabilityTimeDivisionsService.assignDay(day, daySlots, DEFAULT_DIVISIONS);
    AvailabilityTimeDivisionsService.logCoverage(assignment);

    const prioritized = selectTopSlotsForDay(orderedIntra, preferredDivisionSet, MAX_SLOTS_PER_DAY);
    const rankPos = rankingPosition.get(day as ISODate) ?? Number.MAX_SAFE_INTEGER;
    const inRequestedRange = requestedDates.size === 0 ? true : requestedDates.has(day);
    const diffFromNow = daysDiffFrom(nowAnchor, day);
    const matchesPreferredWeekday = weekdayPreferenceSet.size === 0
      ? true
      : (() => {
          const weekday = deriveWeekdayFromISO(day);
          return weekday ? weekdayPreferenceSet.has(weekday) : false;
        })();

    dayInfos.push({
      date: day,
      prioritizedSlots: prioritized.slots,
      preferredCount: prioritized.preferredCount,
      isComplete: assignment.coverage.nonEmptyDivisions >= (DEFAULT_DIVISIONS.length || 1),
      inRequestedRange,
      rankPos,
      diffFromNow,
      matchesPreferredWeekday,
    });
  }

  dayInfos.sort(compareDayInfo);
  const topInfos = dayInfos.slice(0, effectiveMaxDays);

  const selectedDays: string[] = [];
  const selectedSlots: AnySlot[] = [];
  for (const info of topInfos) {
    selectedDays.push(info.date);
    selectedSlots.push(...info.prioritizedSlots);
  }

  // 6) Resultado
  const finalSelectedSlots = selectedSlots.sort(slotChronoCmp);

  return buildOutput({
    universo: allSlots,
    seleccionadas: finalSelectedSlots,
    dias: selectedDays,
    contexto: input.contexto,
    reglasAplicadas: {
      minutos_globales: Array.from(minutosGlobales),
      tratamientos_especificos: (policy.reglas_minutos_por_tratamiento_resueltas || []).length,
    },
    tipoBusqueda: 'bloques',
    warnings: [],
  });
}

export default SlotAccumulator;

// =============================
// Tipos internos mínimos
// =============================
interface AnySlot {
  fecha_cita: string;
  fecha_legible: string;
  hora_inicio: string; // HH:mm
  id_medico?: number | string;
  nombre_medico?: string;
  id_espacio?: number | string;
  nombre_espacio?: string;
  id_tratamiento?: number;
  nombre_tratamiento?: string;
  duracion_tratamiento?: number;
}

interface DaySelectionInfo {
  date: string;
  prioritizedSlots: AnySlot[];
  preferredCount: number;
  isComplete: boolean;
  inRequestedRange: boolean;
  rankPos: number;
  diffFromNow: number;
  matchesPreferredWeekday: boolean;
}

// =============================
// Utils — tiempo y slots
// =============================
const DEFAULT_MINUTES_WHITELIST = [
  '00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55',
];

const DEFAULT_DIVISIONS = getDefaultDivisionsConfig();
const DEFAULT_DIVISION_KEYS = getDivisionKeys(DEFAULT_DIVISIONS);
const MAX_SELECTED_DAYS = 3;
const MAX_SLOTS_PER_DAY = 3;

function toSet<T>(arr: T[]): Set<T> { return new Set(arr); }

function toInt(v: any): number { const n = parseInt(String(v), 10); return Number.isFinite(n) ? n : 0; }

function twoDigits(mm: string | number): string {
  const n = typeof mm === 'number' ? mm : parseInt(String(mm), 10);
  if (Number.isNaN(n)) return '00';
  const v = n % 60;
  return v < 10 ? `0${v}` : String(v);
}

function toHHMM(s: string): string | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${m[1]}:${m[2]}`;
}

function addMinutesHHMM(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = ((total % 60) + 60) % 60;
  return `${twoDigits(nh)}:${twoDigits(nm)}`;
}

function compareHHMM(a: string, b: string): number {
  if (a === b) return 0;
  const [ah, am] = a.split(':').map((x) => parseInt(x, 10));
  const [bh, bm] = b.split(':').map((x) => parseInt(x, 10));
  const av = ah * 60 + am;
  const bv = bh * 60 + bm;
  return av - bv;
}

function diffMinutesHHMM(from: string, to: string): number {
  const [fh, fm] = from.split(':').map((x) => parseInt(x, 10));
  const [th, tm] = to.split(':').map((x) => parseInt(x, 10));
  return (th * 60 + tm) - (fh * 60 + fm);
}

function slotChronoCmp(a: AnySlot, b: AnySlot): number {
  if (a.fecha_cita !== b.fecha_cita) return a.fecha_cita < b.fecha_cita ? -1 : 1;
  if (a.hora_inicio !== b.hora_inicio) return a.hora_inicio < b.hora_inicio ? -1 : 1;
  const ae = String(a.id_espacio ?? '');
  const be = String(b.id_espacio ?? '');
  if (ae !== be) return ae < be ? -1 : 1;
  return 0;
}

function asSlot(w: any, fecha: string, hora: string): AnySlot {
  return {
    fecha_cita: fecha,
    fecha_legible: (w as any).fecha_legible,
    hora_inicio: hora,
    id_medico: (w as any).id_medico,
    nombre_medico: (w as any).nombre_medico,
    id_espacio: (w as any).id_espacio,
    nombre_espacio: (w as any).nombre_espacio,
    id_tratamiento: (w as any).id_tratamiento,
    nombre_tratamiento: (w as any).nombre_tratamiento,
    duracion_tratamiento: toInt((w as any).duracion_tratamiento),
  };
}

function resolveMinutosPermitidos(
  w: any,
  reglasPorId: Map<number, Set<string>>,
  reglasPorNombre: Map<string, Set<string>>,
  minutosGlobal: Set<string>,
): Set<string> {
  const id = typeof (w as any).id_tratamiento === 'number' ? (w as any).id_tratamiento : undefined;
  const nombre = (w as any).nombre_tratamiento;
  if (typeof id === 'number' && reglasPorId.has(id)) return reglasPorId.get(id)!;
  if (typeof nombre === 'string' && reglasPorNombre.has(nombre)) return reglasPorNombre.get(nombre)!;
  return minutosGlobal;
}

// =============================
// Priorización por rangos y orden intra‑día
// =============================
function buildDayPriorityOrder(filters: any[]): string[] {
  const seen = new Set<string>();
  const buckets: string[][] = [];

  for (const f of filters) {
    const drs = Array.isArray((f as any).date_ranges) ? (f as any).date_ranges : [];
    for (const r of drs) {
      const start = r?.start_date;
      const end = r?.end_date || r?.start_date;
      if (!isISODate(start) || !isISODate(end)) continue;
      const days = enumerateDates(start, end);
      // regla: primero el primer día, luego el resto del rango
      const ordered = [days[0], ...days.slice(1)];
      buckets.push(ordered);
    }
  }

  // Fusión de buckets preservando orden y unicidad
  const out: string[] = [];
  for (const bucket of buckets) {
    for (const d of bucket) {
      if (!seen.has(d)) { seen.add(d); out.push(d); }
    }
  }

  return out;
}

function uniqPreserving<T>(arr: T[]): T[] {
  const res: T[] = [];
  const seen = new Set<any>();
  for (const x of arr) {
    if (!seen.has(x as any)) { seen.add(x as any); res.push(x); }
  }
  return res;
}

function isISODate(s: any): s is string { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function enumerateDates(start: string, end: string): string[] {
  const res: string[] = [];
  const d0 = new Date(start + 'T00:00:00Z');
  const d1 = new Date(end + 'T00:00:00Z');
  for (let d = d0; d.getTime() <= d1.getTime(); d = new Date(d.getTime() + 86400000)) {
    const iso = d.toISOString().slice(0, 10);
    res.push(iso);
  }
  return res;
}

function groupByDate(slots: AnySlot[]): Map<string, AnySlot[]> {
  const m = new Map<string, AnySlot[]>();
  for (const s of slots) {
    if (!m.has(s.fecha_cita)) m.set(s.fecha_cita, []);
    m.get(s.fecha_cita)!.push(s);
  }
  return m;
}

function orderIntraDia(slots: AnySlot[], preferencias: string[] = []): AnySlot[] {
  const targets = buildPreferenceTargets(preferencias);
  return [...slots].sort((a, b) => intraCmp(a, b, targets));
}

function intraCmp(a: AnySlot, b: AnySlot, targets: string[]): number {
  // 1) Cercanía a preferencias si existen
  const sa = scorePreference(a.hora_inicio, targets);
  const sb = scorePreference(b.hora_inicio, targets);
  if (sa !== sb) return sa - sb;
  // 2) Hora más temprana
  if (a.hora_inicio !== b.hora_inicio) return a.hora_inicio < b.hora_inicio ? -1 : 1;
  // 3) Desempate por espacio
  const ae = String(a.id_espacio ?? '');
  const be = String(b.id_espacio ?? '');
  if (ae !== be) return ae < be ? -1 : 1;
  return 0;
}

function buildPreferenceTargets(prefs: string[]): string[] {
  const targets = new Set<string>();
  for (const pref of prefs) {
    const raw = String(pref || '').trim();
    if (!raw) continue;

    if (/^\d{2}:\d{2}$/.test(raw)) {
      targets.add(raw);
      continue;
    }

    const normalizedKey = normalizeDivisionKey(raw, DEFAULT_DIVISIONS);
    if (normalizedKey) {
      const midpoint = getDivisionMidpoint(normalizedKey, DEFAULT_DIVISIONS);
      if (midpoint) targets.add(midpoint);
    }
  }
  return Array.from(targets);
}

function scorePreference(hhmm: string, targets: string[]): number {
  if (!targets.length) return 0;
  // Distancia mínima en minutos a cualquiera de los targets
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  const v = h * 60 + m;
  let best = Number.MAX_SAFE_INTEGER;
  for (const t of targets) {
    const [th, tm] = t.split(':').map((x) => parseInt(x, 10));
    const tv = th * 60 + tm;
    const d = Math.abs(v - tv);
    if (d < best) best = d;
  }
  return best; // menor es mejor
}

function selectTopSlotsForDay(
  orderedSlots: AnySlot[],
  preferredDivisions: Set<string>,
  maxPerDay: number,
): { slots: AnySlot[]; preferredCount: number } {
  if (!orderedSlots.length || maxPerDay <= 0) {
    return { slots: [], preferredCount: 0 };
  }

  const preferred: AnySlot[] = [];
  const others: AnySlot[] = [];

  for (const slot of orderedSlots) {
    const divisionKey = resolveDivisionForTime(slot.hora_inicio as HHMM, DEFAULT_DIVISIONS);
    if (divisionKey && preferredDivisions.has(divisionKey)) {
      preferred.push(slot);
    } else {
      others.push(slot);
    }
  }

  const buckets = preferredDivisions.size > 0 ? [preferred, others] : [orderedSlots];
  const picked: AnySlot[] = [];
  let preferredCount = 0;

  for (const bucket of buckets) {
    for (const slot of bucket) {
      if (picked.length >= maxPerDay) break;
      picked.push(slot);
      const divisionKey = resolveDivisionForTime(slot.hora_inicio as HHMM, DEFAULT_DIVISIONS);
      if (divisionKey && preferredDivisions.has(divisionKey)) {
        preferredCount += 1;
      }
    }
    if (picked.length >= maxPerDay) break;
  }

  if (!picked.length) {
    const fallback = orderedSlots.slice(0, maxPerDay);
    return { slots: fallback, preferredCount: 0 };
  }

  return { slots: picked, preferredCount };
}

function compareDayInfo(a: DaySelectionInfo, b: DaySelectionInfo): number {
  if (a.rankPos !== b.rankPos) return a.rankPos - b.rankPos;
  if (a.diffFromNow !== b.diffFromNow) return a.diffFromNow - b.diffFromNow;
  if (a.inRequestedRange !== b.inRequestedRange) return a.inRequestedRange ? -1 : 1;
  if (a.matchesPreferredWeekday !== b.matchesPreferredWeekday) return a.matchesPreferredWeekday ? -1 : 1;
  if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
  if (a.preferredCount !== b.preferredCount) return b.preferredCount - a.preferredCount;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return 0;
}

function collectDatesFromFilters(filters: any[]): Set<string> {
  const result = new Set<string>();
  for (const f of filters || []) {
    const drs = Array.isArray((f as any)?.date_ranges) ? (f as any).date_ranges : [];
    for (const r of drs) {
      const start = r?.start_date || r?.start;
      const end = r?.end_date || r?.end || start;
      if (!isISODate(start) || !isISODate(end)) continue;
      for (const d of enumerateDates(start, end)) result.add(d);
    }
  }
  return result;
}

function normalizeAnchorDate(raw: unknown): Date {
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function daysDiffFrom(anchor: Date, targetISO: string): number {
  const targetMs = Date.parse(`${targetISO}T00:00:00Z`);
  if (Number.isNaN(targetMs)) return Number.MAX_SAFE_INTEGER;
  const anchorUtc = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const diff = Math.floor((targetMs - anchorUtc) / 86400000);
  if (diff < 0) return Math.abs(diff) + 1000;
  return diff;
}

function deriveWeekdayFromISO(date: string): number | null {
  if (!isISODate(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const dow = parsed.getUTCDay(); // 0=domingo ... 6=sábado
  return dow === 0 ? 7 : dow;
}

function determineMaxDays(
  orderedDays: string[],
  requestedDates: Set<string>,
  preferredWeekdays: Set<number>,
): number | null {
  if (requestedDates.size > 0) {
    return Math.max(MAX_SELECTED_DAYS, requestedDates.size);
  }

  if (preferredWeekdays.size === 0) return null;

  const matchingDays = orderedDays.filter((day) => {
    const weekday = deriveWeekdayFromISO(day);
    return weekday ? preferredWeekdays.has(weekday) : false;
  });

  if (matchingDays.length === 0) return null;
  return matchingDays.length;
}

// =============================
// Builder de salida
// =============================
function buildOutput(args: {
  universo: AnySlot[];
  seleccionadas: AnySlot[];
  dias: string[];
  contexto?: SlotAccumulatorInput['contexto'];
  reglasAplicadas: Record<string, unknown>;
  tipoBusqueda: string;
  warnings: string[];
}): SlotAccumulatorOutput {
  return {
    universo_opciones: args.universo,
   opciones_top10: args.seleccionadas, // ahora sin corte: todas las del/los días completos
    dias_mostrados: args.dias,
    query_context: args.contexto?.query_context,
    tipo_busqueda_final: args.tipoBusqueda,
    metadata: {
      reglas_aplicadas: args.reglasAplicadas,
      criterios: {
        orden: 'fecha↑, hora↑, id_espacio↑',
        estrategia: 'dias_completos_sin_topes',
        max_dias_mostrados: MAX_SELECTED_DAYS,
        divisiones: DEFAULT_DIVISION_KEYS.join('/'),
      },
      conteos: {
        total_original: args.universo.length,
        total_derivados: args.universo.length, // ya derivado arriba
        total_filtrados: args.seleccionadas.length,
        dias_presentados: args.dias.length,
      },
      warnings: args.warnings,
    },
  } as any;
}
