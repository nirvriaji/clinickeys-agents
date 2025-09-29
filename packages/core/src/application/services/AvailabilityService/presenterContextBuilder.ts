// packages/core/src/application/services/AvailabilityService/presenterContextBuilder.ts

import { Logger } from "@clinickeys-agents/core/infrastructure/external";

export type ISODate = string; // YYYY-MM-DD

export type DateRange = {
  start: ISODate; // inclusive
  end: ISODate;   // inclusive
};

export interface PresenterContextInput {
  /** Zona horaria IANA de la clínica (opcional pero recomendado) */
  timezone?: string | null;
  /** Fechas exactas buscadas (normalizadas a YYYY-MM-DD) */
  fechasBuscadas?: ISODate[];
  /** Rangos de fechas consultados (para disclaimer) */
  rangosConsultados?: DateRange[];
  /** Anclas (primer día de cada rango detectado) */
  anchors?: ISODate[];
  /** Sede canónica si aplica */
  sedeValida?: string | null;
  /** Identificadores de contexto útiles para depuración */
  clinicId?: number;
  superClinicId?: number;
  /** Parámetros efectivos del planificador */
  planner?: { blockDays?: number; forwardMaxDays?: number };
  /** Límite global de opciones que finalmente se mostrarán (puede guiar al presentador) */
  maxOpciones?: number;
  /** Campo libre para futuros metadatos */
  extra?: Record<string, unknown>;
}

export interface PresenterContext {
  timezone?: string | null;
  fechas_buscadas?: ISODate[];
  rangos_consultados?: DateRange[];
  anchors?: ISODate[];
  sede_valida?: string | null;
  clinic_id?: number;
  super_clinic_id?: number;
  planner?: { blockDays?: number; forwardMaxDays?: number };
  max_opciones?: number;
  // Espacio para datos adicionales que el presentador pueda usar sin romperse
  extras?: Record<string, unknown>;
}

/**
 * Normaliza un arreglo de fechas en formato ISO (YYYY-MM-DD). Descarta entradas inválidas.
 */
function normalizeISODateArray(values?: unknown): ISODate[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: ISODate[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    // Validación simple de YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) out.push(v as ISODate);
  }
  return out.length ? out : undefined;
}

function normalizeRanges(values?: unknown): DateRange[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const out: DateRange[] = [];
  for (const r of values) {
    if (!r || typeof r !== "object") continue;
    const start = (r as any).start;
    const end = (r as any).end;
    if (typeof start === "string" && typeof end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      out.push({ start, end });
    }
  }
  return out.length ? out : undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function pickPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  return n > 0 ? n : undefined;
}

/**
 * Crea un objeto de CONTEXTO estable y explícito para el presentador.
 * No interpreta reglas de minutos (eso es parte de CONFIGURACION_DE_DISPONIBILIDADES),
 * pero sí entrega metadatos de búsqueda (fechas, anclas, rangos) y parámetros efectivos.
 */
export function buildPresenterContext(input: PresenterContextInput): PresenterContext {
  const {
    timezone,
    fechasBuscadas,
    rangosConsultados,
    anchors,
    sedeValida,
    clinicId,
    superClinicId,
    planner,
    maxOpciones,
    extra,
  } = input || {};

  Logger.info("[presenterContextBuilder] Armando CONTEXTO para presentador", {
    timezone,
    fechasBuscadas,
    rangosConsultados,
    anchors,
    sedeValida,
    clinicId,
    superClinicId,
    planner,
    maxOpciones,
    extraKeys: extra ? Object.keys(extra) : [],
  });

  const ctx: PresenterContext = {};

  // Campos principales
  if (timezone && typeof timezone === "string") ctx.timezone = timezone;
  const fechasNorm = normalizeISODateArray(fechasBuscadas);
  if (fechasNorm) ctx.fechas_buscadas = fechasNorm;

  const rangosNorm = normalizeRanges(rangosConsultados);
  if (rangosNorm) ctx.rangos_consultados = rangosNorm;

  const anchorsNorm = normalizeISODateArray(anchors);
  if (anchorsNorm) ctx.anchors = anchorsNorm;

  const sede = pickString(sedeValida);
  if (sede) ctx.sede_valida = sede;

  if (typeof clinicId === "number") ctx.clinic_id = clinicId;
  if (typeof superClinicId === "number") ctx.super_clinic_id = superClinicId;

  if (planner && (pickPositiveInt(planner.blockDays) || pickPositiveInt(planner.forwardMaxDays))) {
    ctx.planner = {
      ...(pickPositiveInt(planner.blockDays) ? { blockDays: Math.floor(planner.blockDays!) } : {}),
      ...(pickPositiveInt(planner.forwardMaxDays) ? { forwardMaxDays: Math.floor(planner.forwardMaxDays!) } : {}),
    };
  }

  if (pickPositiveInt(maxOpciones)) ctx.max_opciones = Math.floor(maxOpciones!);

  if (extra && typeof extra === "object") {
    // Filtrar valores no serializables de forma conservadora
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(extra)) {
      const t = typeof v;
      if (v == null || t === "string" || t === "number" || t === "boolean") {
        safe[k] = v as any;
      } else if (Array.isArray(v)) {
        try { safe[k] = JSON.parse(JSON.stringify(v)); } catch { /* ignore */ }
      } else if (t === "object") {
        try { safe[k] = JSON.parse(JSON.stringify(v)); } catch { /* ignore */ }
      }
    }
    if (Object.keys(safe).length) ctx.extras = safe;
  }

  Logger.info("[presenterContextBuilder] CONTEXTO armado", ctx);
  return ctx;
}
