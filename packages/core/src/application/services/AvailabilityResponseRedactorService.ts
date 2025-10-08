// packages/core/src/application/services/AvailabilityResponseRedactorService.ts

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import type { AgendaPolicyResolved } from '@clinickeys-agents/core/application/services/types/Availability';

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

/**
 * Redactor de disponibilidades (JSON-first)
 * - Recibe universo/top10 de slots ya válidos (generados por código)
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

  const promptsPath = path.resolve(
    __dirname,
    'packages/core/src/.ia/instructions/prompts/bot_redactor_disponibilidades.md',
  );

  let systemPrompt = '';
  try {
    systemPrompt = fs.readFileSync(promptsPath, 'utf8');
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

  // Payload del usuario
  const userPayload = {
    policy, // JSON fuente de verdad
    slots_universo: Array.isArray(slots) ? slots : [],
    tipo_busqueda_final: String((opts?.contextoRedactor as any)?.tipo_busqueda || ''),
    horas_preferencia_usuario: (opts?.contextoRedactor as any)?.horas_preferencia_usuario || '',
    disclaimer_fechas: (opts?.contextoRedactor as any)?.disclaimer_fechas || [],
    dias_mostrados: (opts?.contextoRedactor as any)?.dias_mostrados || [],
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
  });

  // Llamada al modelo con firma posicional + schema Zod real
  const schemaLabel = 'RedactorHorariosSchema';
  const model = opts?.model || 'gpt-4o-mini';

  const parsed = await openAIService.getSchemaStructuredResponse(
    systemPrompt,
    JSON.stringify(userPayload),
    RedactorHorariosSchema,
    schemaLabel,
    model,
  );

  // Normalización de salida
  const mensaje = parsed && typeof parsed.mensaje === 'string' ? parsed.mensaje : '';
  const metadata = parsed && typeof parsed === 'object' ? parsed.metadata || {} : {};

  return { mensaje, metadata };
}

export default AvailabilityResponseRedactorService;