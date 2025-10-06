// packages/core/src/availability/SlotAccumulator.ts

import type {
  AgendaPolicyResolved,
  SlotAccumulatorInput,
  SlotAccumulatorOutput,
} from '@clinickeys-agents/core/application/services';

// =============================
// Public API
// =============================
export async function SlotAccumulator(input: SlotAccumulatorInput): Promise<SlotAccumulatorOutput> {
  const policy = input.policy || ({} as AgendaPolicyResolved);

  // Defaults
  const minutosGlobales = toSet(
    policy.minutos_globales && policy.minutos_globales.length
      ? policy.minutos_globales.map(twoDigits)
      : DEFAULT_MINUTES_WHITELIST,
  );
  const limites = {
    tope_global: policy?.limites?.tope_global ?? 10,
    tope_por_dia: policy?.limites?.tope_por_dia ?? 3,
    tope_dias: policy?.limites?.tope_dias ?? 3,
  };

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
  const allSlots = [] as AnySlot[];
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
      // Verificar que t cae en la progresión exacta (siempre, porque partimos de min y sumamos dur)
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

  // 3) Priorización por rangos y selección por día
  const dayOrder = buildDayPriorityOrder(input.filters || []);
  const perDayMap = groupByDate(allSlots);

  const diasSeleccionados: string[] = [];
  const opciones: AnySlot[] = [];

  for (const day of dayOrder) {
    if (diasSeleccionados.length >= limites.tope_dias) break;
    const list = perDayMap.get(day) || [];
    if (!list.length) continue;

    // Orden intra-día con preferencia de horas
    const orderedIntra = orderIntraDia(list, input.contexto?.horas_preferencia_usuario || []);

    const take = Math.min(limites.tope_por_dia, orderedIntra.length);
    const picked = orderedIntra.slice(0, take);
    if (picked.length) {
      diasSeleccionados.push(day);
      for (const s of picked) {
        opciones.push(s);
        if (opciones.length >= limites.tope_global) break;
      }
    }
    if (opciones.length >= limites.tope_global) break;
  }

  // Si aún no llegamos al tope global, completar recorriendo el resto cronológico (sin romper días ya añadidos)
  if (opciones.length < limites.tope_global) {
    for (const s of allSlots) {
      if (opciones.length >= limites.tope_global) break;
      const d = s.fecha_cita;
      if (
        diasSeleccionados.includes(d) &&
        opciones.filter((x) => x.fecha_cita === d).length >= limites.tope_por_dia
      ) {
        continue; // ya alcanzamos tope del día
      }
      if (!diasSeleccionados.includes(d)) {
        if (diasSeleccionados.length >= limites.tope_dias) continue; // no agregar más días
        diasSeleccionados.push(d);
      }
      // Evitar duplicados exactos por seguridad
      const key = slotKey(s);
      if (!opciones.some((x) => slotKey(x) === key)) opciones.push(s);
    }
  }

  // Salida
  const out: SlotAccumulatorOutput = {
    universo_opciones: allSlots,
    opciones_top10: opciones.slice(0, limites.tope_global),
    dias_mostrados: diasSeleccionados,
    disclaimer_fechas: input.contexto?.disclaimer_fechas,
    tipo_busqueda_final: 'bloques',
    metadata: {
      reglas_aplicadas: {
        minutos_globales: Array.from(minutosGlobales),
        tratamientos_especificos: (policy.reglas_minutos_por_tratamiento_resueltas || []).length,
      },
      conteos: {
        total_original: (input.windows || []).length,
        total_derivados: allSlots.length,
        total_filtrados: opciones.length,
        dias_presentados: diasSeleccionados.length,
      },
      criterios: {
        orden: 'fecha↑, hora↑, id_espacio↑',
        tope_dias: limites.tope_dias,
        tope_por_dia: limites.tope_por_dia,
        tope_global: limites.tope_global,
      },
      warnings: [],
    },
  } as any;

  return out;
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
  const nh = Math.floor(total / 60);
  const nm = total % 60;
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
// Priorización por rangos y orden intra-día
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

  // Como respaldo, si no hubo rangos, orden natural de los slots
  return out.length ? out : [];
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
  const prefTargets = buildPreferenceTargets(preferencias);
  return [...slots].sort((a, b) => intraCmp(a, b, prefTargets));
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

function slotKey(s: AnySlot): string {
  return `${s.fecha_cita}T${s.hora_inicio}|${s.id_medico || ''}|${s.id_espacio || ''}`;
}
