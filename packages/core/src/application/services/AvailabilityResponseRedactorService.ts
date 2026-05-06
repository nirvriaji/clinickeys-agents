// packages/core/src/application/services/AvailabilityResponseRedactorService.ts

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import type { AgendaPolicyResolved } from '@clinickeys-agents/core/application/services';
import type { QueryContext } from '@clinickeys-agents/core/application/services/AvailabilityService/types/QueryContext';

// =============================
// Zod schema de salida (compatible con Responses API)
// - Todos los campos required
// - Para permitir "ausencia", usar `.nullable()` en vez de `.optional()`
// =============================
const ScalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const RedactorHorariosSchema = z
  .object({
    mensaje: z.string(),
    metadata: z.record(ScalarValueSchema).nullable(),
  })
  .strict();

export type RedactorHorariosParsed = z.infer<typeof RedactorHorariosSchema>;

/**
 * Redactor de disponibilidades (JSON-first)
 * - Recibe universo de slots ya válidos (generados por código)
 * - Recibe la política ya compilada (AgendaPolicyResolved)
 * - Redacta el mensaje final (24h, español neutro, sin IDs)
 *
 * Importante: esta versión solo acepta JSON (policy).
 */
export async function AvailabilityResponseRedactorService(
  openAIService: any,
  slots: any[],
  policyCarrier: { policy: AgendaPolicyResolved },
  opts: { ahoraISO: string; timezone?: string; contextoRedactor?: Record<string, unknown>; model?: string },
): Promise<{ mensaje: string; metadata?: Record<string, unknown> }> {
  if (!policyCarrier || !policyCarrier.policy) {
    throw new Error('[AvailabilityResponseRedactorService] policy (AgendaPolicyResolved) es obligatorio');
  }

  const policy = policyCarrier.policy;

  // Cargar prompt del redactor
  const promptsPath = path.resolve(
    __dirname,
    'packages/core/src/prompts/bot_redactor_disponibilidades.md',
  );

  let systemPrompt = '';
  try {
    systemPrompt = fs.readFileSync(promptsPath, 'utf8');
    Logger.info('[AvailabilityResponseRedactorService] Prompt cargado', { promptsPath });
  } catch (err) {
    Logger.error('[AvailabilityResponseRedactorService] No se pudo cargar el prompt del redactor', {
      promptsPath,
      err,
    });
    // Fallback mínimo para no romper el flujo
    systemPrompt = 'Eres un redactor de horarios. Responde SOLO con JSON {"mensaje": string, "metadata": object }.';
  }

  // Banderas de presentación desde policy
  const mostrar_medicos = (policy?.presentacion?.mostrar_medicos as 'auto' | 'siempre' | 'nunca') || 'auto';
  const sedes_lista = Array.isArray(policy?.sedes?.lista_clinica) ? policy!.sedes!.lista_clinica : [];
  const mostrar_sede = !!(policy?.presentacion?.mostrar_sede && sedes_lista.length > 0);

  // Contexto adicional
  const contexto = (opts?.contextoRedactor || {}) as Record<string, unknown>;
  const tipo_busqueda_final = String(contexto['tipo_busqueda'] || 'bloques');
  const horas_preferencia_usuario = String(contexto['horas_preferencia_usuario'] || '');
  const queryContext = normalizeQueryContext(contexto['query_context']);
  const dias_mostrados_ctx = Array.isArray(contexto['dias_mostrados']) ? (contexto['dias_mostrados'] as string[]) : [];
  const dias_mostrados = queryContext.fechas_entregadas_al_asistente.length > 0
    ? queryContext.fechas_entregadas_al_asistente
    : dias_mostrados_ctx;
  const divisiones_cubiertas = Array.isArray(contexto['divisiones_cubiertas']) ? (contexto['divisiones_cubiertas'] as string[]) : [];

  // Payload del usuario (fuente de verdad para el modelo)
  const userPayload = {
    policy, // JSON fuente de verdad
    slots_universo: Array.isArray(slots) ? slots : [],
    tipo_busqueda_final,
    horas_preferencia_usuario,
    query_context: queryContext,
    dias_mostrados,
    divisiones_cubiertas, // informativo: p.ej. ["mañana","mediodía","tarde"]
    timezone: opts?.timezone || undefined,
    ahoraISO: opts?.ahoraISO,

    // Derivados para simplificar el trabajo del modelo
    mostrar_medicos,
    sedes_lista,
    mostrar_sede,
  } as const;

  Logger.info('[AvailabilityResponseRedactorService] Solicitando redacción (JSON-first)', {
    slots: Array.isArray(slots) ? slots.length : 0,
    mostrar_medicos: userPayload.mostrar_medicos,
    sedes: userPayload.sedes_lista.length,
    tipo_busqueda_final: userPayload.tipo_busqueda_final,
    queryContextCoverage: queryContext.coverage,
  });

  // Llamada al modelo con firma posicional + schema Zod real
  const schemaLabel = 'RedactorHorariosSchema';
  const model = opts?.model || 'gpt-5.4-mini';

  try {
    const parsed: RedactorHorariosParsed = await openAIService.getSchemaStructuredResponse(
      systemPrompt,
      JSON.stringify(userPayload),
      RedactorHorariosSchema,
      schemaLabel,
      model,
    );

    const mensaje = parsed && typeof parsed.mensaje === 'string' ? parsed.mensaje : '';
    const metadata = parsed && typeof parsed === 'object' ? (parsed.metadata || {}) : {};

    return { mensaje, metadata };
  } catch (err) {
    Logger.error('[AvailabilityResponseRedactorService] Error al redactar con el modelo. Se usa fallback.', { err });

    // Fallback ultra‑conservador si el modelo falla: generamos un texto mínimo
    const textoFallback = construirFallback(slots, { mostrar_sede, mostrar_medicos, sedes_lista });
    return { mensaje: textoFallback, metadata: { fallback: true } };
  }
}

export default AvailabilityResponseRedactorService;

// =============================
// Fallback local (mínimo, neutro, 24h)
// =============================
function construirFallback(
  slots: any[],
  flags: { mostrar_sede: boolean; mostrar_medicos: 'auto' | 'siempre' | 'nunca'; sedes_lista: string[] },
): string {
  if (!Array.isArray(slots) || slots.length === 0) {
    return 'No hay horarios disponibles para esas fechas/horas. ¿Quiere que busque disponibilidad en otros días o prefiere apuntarse en una lista de espera por si alguien cancela?';
  }

  // Agrupar por fecha (YYYY-MM-DD)
  const map = new Map<string, any[]>();
  for (const s of slots) {
    const d = String(s.fecha_cita || s.fecha || '');
    if (!d) continue;
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(s);
  }

  // Ordenar días y horas
  const dias = Array.from(map.keys()).sort();
  const partes: string[] = [];

  for (const dia of dias) {
    const lista = (map.get(dia) || []).sort((a, b) => {
      const ha = String(a.hora_inicio || '').slice(0, 5);
      const hb = String(b.hora_inicio || '').slice(0, 5);
      if (ha !== hb) return ha < hb ? -1 : 1;
      const ea = String(a.id_espacio ?? '');
      const eb = String(b.id_espacio ?? '');
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });

    // Encabezado del día (simple ISO → el redactor real lo convierte a fecha legible)
    partes.push(`**${dia}**`);

    for (const it of lista) {
      const hhmm = String(it.hora_inicio || '').slice(0, 5);
      const medico = String(it.nombre_medico || '');
      const espacio = String(it.nombre_espacio || '');

      const showMed = flags.mostrar_medicos === 'siempre' || (flags.mostrar_medicos === 'auto' && medico);

      const detalles: string[] = [`• ${hhmm}`];
      if (showMed && medico) detalles.push(`— ${medico}`);
      if (flags.mostrar_sede && espacio) detalles.push(`(${espacio})`);

      partes.push(detalles.join(' '));
    }

    partes.push(''); // línea en blanco entre días
  }

  partes.push('¿Cuál prefiere?');
  return partes.join('\n');
}

const EMPTY_QUERY_CONTEXT: QueryContext = {
  fechas_rankeadas: [],
  consultas_ejecutadas: [],
  fechas_entregadas_al_asistente: [],
  criterios: {},
  caducidad: {
    ttl_ms: 0,
    generated_at_iso: new Date(0).toISOString(),
    timezone: 'UTC',
  },
  coverage: {
    dates_consulted_count: 0,
    dates_with_results_count: 0,
    selected_days_count: 0,
  },
  anchors: {},
};

function normalizeQueryContext(raw: unknown): QueryContext {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_QUERY_CONTEXT };

  const source = raw as Record<string, unknown>;

  const consultas =
    Array.isArray(source.consultas_ejecutadas)
      ? normalizeRangeArray(source.consultas_ejecutadas)
      : normalizeRangeArray((source as any).dates_consulted);

  const entregadas =
    Array.isArray(source.fechas_entregadas_al_asistente)
      ? normalizeDateArray(source.fechas_entregadas_al_asistente)
      : normalizeDateArray((source as any).days_selected);

  const ranking =
    Array.isArray(source.fechas_rankeadas)
      ? normalizeDateArray(source.fechas_rankeadas)
      : normalizeDateArray((source as any).ranking_primary);

  const criterios =
    source.criterios && typeof source.criterios === 'object'
      ? { ...(source.criterios as Record<string, unknown>) }
      : {};

  const legacyHorizon = typeof (source as any).horizon_end === 'string' ? (source as any).horizon_end : null;
  if (legacyHorizon && typeof criterios === 'object' && criterios && !Object.prototype.hasOwnProperty.call(criterios, 'horizon_end')) {
    (criterios as Record<string, unknown>).horizon_end = legacyHorizon;
  }

  const caducidad =
    source.caducidad && typeof source.caducidad === 'object'
      ? normalizeCaducidad(source.caducidad as Record<string, unknown>)
      : { ...EMPTY_QUERY_CONTEXT.caducidad };

  const coverage = normalizeCoverage(source.coverage);

  const anchors = normalizeAnchors(source.anchors);
  if (!anchors.today_iso && typeof (source as any).today_iso === 'string' && (source as any).today_iso.trim()) {
    anchors.today_iso = (source as any).today_iso;
  }

  return {
    fechas_rankeadas: ranking,
    consultas_ejecutadas: consultas,
    fechas_entregadas_al_asistente: entregadas,
    criterios,
    caducidad,
    coverage,
    anchors,
  };
}

function normalizeRangeArray(value: unknown): Array<{ start: string; end: string }> {
  if (!Array.isArray(value)) return [];
  const ranges: Array<{ start: string; end: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const start =
      typeof candidate.start === 'string'
        ? candidate.start
        : typeof candidate.start_date === 'string'
          ? candidate.start_date
          : null;
    if (!start) continue;
    const end =
      typeof candidate.end === 'string'
        ? candidate.end
        : typeof candidate.end_date === 'string'
          ? candidate.end_date
          : start;
    ranges.push({ start, end });
  }
  return ranges;
}

function normalizeDateArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeCaducidad(raw: Record<string, unknown>): QueryContext['caducidad'] {
  const ttl = Number(raw.ttl_ms);
  const generated = typeof raw.generated_at_iso === 'string' && raw.generated_at_iso.length
    ? raw.generated_at_iso
    : new Date(0).toISOString();
  const timezone = typeof raw.timezone === 'string' && raw.timezone.length ? raw.timezone : 'UTC';
  return {
    ttl_ms: Number.isFinite(ttl) ? ttl : EMPTY_QUERY_CONTEXT.caducidad.ttl_ms,
    generated_at_iso: generated,
    timezone,
  };
}

function normalizeCoverage(raw: unknown): QueryContext['coverage'] {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_QUERY_CONTEXT.coverage };
  const obj = raw as Record<string, unknown>;
  const consulted = Number(obj.dates_consulted_count);
  const withResults = Number(obj.dates_with_results_count);
  const selected = Number(obj.selected_days_count);
  return {
    dates_consulted_count: Number.isFinite(consulted) ? consulted : 0,
    dates_with_results_count: Number.isFinite(withResults) ? withResults : 0,
    selected_days_count: Number.isFinite(selected) ? selected : 0,
  };
}

function normalizeAnchors(raw: unknown): NonNullable<QueryContext['anchors']> {
  const out: NonNullable<QueryContext['anchors']> = {};
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.today_iso === 'string' && obj.today_iso.trim()) {
    out.today_iso = obj.today_iso;
  }
  return out;
}
