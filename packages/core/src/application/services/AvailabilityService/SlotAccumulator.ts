import type {
  AgendaPolicyResolved,
  SlotAccumulatorInput,
  SlotAccumulatorOutput,
} from '@clinickeys-agents/core/application/services';

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
  const dayOrder = dayOrderFromFilters.length
    ? uniqPreserving([...dayOrderFromFilters, ...allDaysChrono])
    : allDaysChrono;

  // 4) Agrupar por día y ordenar intra‑día con preferencias
  const perDayMap = groupByDate(allSlots);

  const preferencias = input.contexto?.horas_preferencia_usuario || [];

  // 5) Selección bajo la NUEVA estrategia:
  //    - Tomar días completos (todas sus opciones válidas) siguiendo el ranking de días
  //    - Parar cuando tengamos al menos 3 días completos
  //    - Además, procurar cubrir divisiones horarias (mañana/mediodía/tarde/noche) en el universo seleccionado global
  const MIN_DIAS_OBJETIVO = 3;
  const selectedDays: string[] = [];
  const selectedSlots: AnySlot[] = [];

  // Seguimiento de cobertura por divisiones horarias globales
  const divisionCoverage = new Map<string, number>();

  for (const day of dayOrder) {
    const list = perDayMap.get(day) || [];
    if (!list.length) continue;

    const orderedIntra = orderIntraDia(list, preferencias);

    // Día completo: agregamos TODAS las opciones válidas del día (sin truncar)
    for (const s of orderedIntra) {
      selectedSlots.push(s);
      const div = getDivisionId(s.hora_inicio);
      divisionCoverage.set(div, (divisionCoverage.get(div) || 0) + 1);
    }
    selectedDays.push(day);

    // Criterio de parada mínimo
    if (selectedDays.length >= MIN_DIAS_OBJETIVO) {
      // Si ya cubrimos al menos 1 opción en cada división principal, podemos cortar
      if (hasGlobalDivisionVariety(divisionCoverage)) break;
      // Si no, seguimos añadiendo días hasta cubrir variedad o agotar días
    }
  }

  // 6) Resultado
  return buildOutput({
    universo: allSlots,
    seleccionadas: selectedSlots,
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

// =============================
// Utils — tiempo y slots
// =============================
const DEFAULT_MINUTES_WHITELIST = [
  '00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55',
];

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
  const targets: string[] = [];
  for (const p of prefs) {
    const s = String(p || '').trim().toLowerCase();
    if (!s) continue;
    if (/^\d{2}:\d{2}$/.test(s)) { targets.push(s); continue; }
    if (s === 'mañana' || s === 'manana') { targets.push('09:00', '10:00', '11:00'); continue; }
    if (s === 'mediodia' || s === 'mediodía') { targets.push('12:00', '13:00', '14:00'); continue; }
    if (s === 'tarde') { targets.push('15:00', '16:00', '17:00'); continue; }
    if (s === 'noche') { targets.push('18:00', '19:00', '20:00'); continue; }
  }
  return targets;
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

function getDivisionId(hhmm: string): string {
  // Divisiones simples y estables
  // madrugada: 00:00-05:59 (no exigida), mañana: 06:00-11:59, mediodía: 12:00-14:59, tarde: 15:00-17:59, noche: 18:00-21:59, tardía: 22:00-23:59
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10));
  const mins = h * 60 + m;
  if (mins >= 360 && mins <= 719) return 'mañana';
  if (mins >= 720 && mins <= 899) return 'mediodía';
  if (mins >= 900 && mins <= 1079) return 'tarde';
  if (mins >= 1080 && mins <= 1319) return 'noche';
  if (mins < 360) return 'madrugada';
  return 'tardía';
}

function hasGlobalDivisionVariety(coverage: Map<string, number>): boolean {
  // Requerimos al menos 1 en cada una de las divisiones principales
  const main = ['mañana', 'mediodía', 'tarde', 'noche'];
  return main.every(id => (coverage.get(id) || 0) > 0);
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
    disclaimer_fechas: args.contexto?.disclaimer_fechas,
    tipo_busqueda_final: args.tipoBusqueda,
    metadata: {
      reglas_aplicadas: args.reglasAplicadas,
      criterios: {
        orden: 'fecha↑, hora↑, id_espacio↑',
        estrategia: 'dias_completos_sin_topes',
        min_dias_objetivo: 3,
        divisiones: 'mañana/mediodía/tarde/noche',
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