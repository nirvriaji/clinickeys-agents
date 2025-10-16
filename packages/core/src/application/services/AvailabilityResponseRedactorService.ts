import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import type { AgendaPolicyResolved } from '@clinickeys-agents/core/application/services';

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
  const disclaimer_fechas = Array.isArray(contexto['disclaimer_fechas']) ? (contexto['disclaimer_fechas'] as any[]) : [];
  const dias_mostrados = Array.isArray(contexto['dias_mostrados']) ? (contexto['dias_mostrados'] as string[]) : [];
  const divisiones_cubiertas = Array.isArray(contexto['divisiones_cubiertas']) ? (contexto['divisiones_cubiertas'] as string[]) : [];

  // Payload del usuario (fuente de verdad para el modelo)
  const userPayload = {
    policy, // JSON fuente de verdad
    slots_universo: Array.isArray(slots) ? slots : [],
    tipo_busqueda_final,
    horas_preferencia_usuario,
    disclaimer_fechas,
    dias_mostrados,
    divisiones_cubiertas, // informativo: p.ej. ["mañana","medio_dia","tarde","noche"]
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
  });

  // Llamada al modelo con firma posicional + schema Zod real
  const schemaLabel = 'RedactorHorariosSchema';
  const model = opts?.model || 'gpt-4o-mini';

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