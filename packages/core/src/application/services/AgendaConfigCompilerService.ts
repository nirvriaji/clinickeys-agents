// packages/core/src/application/services/AgendaConfigCompilerService.ts

import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import path from 'path';
import { readFile } from 'fs/promises';
import type { IOpenAIService } from '@clinickeys-agents/core/domain/openai';
import type { AgendaPolicyResolved } from '@clinickeys-agents/core/application/services';
import { AgendaPolicyResolvedSchema } from '@clinickeys-agents/core/application/services';

/**
 * AgendaConfigCompilerService
 *
 * Compila una política de agenda (JSON) a partir de:
 * - Texto de configuración (asistente_agenda_config_text)
 * - Análisis local de agenda (analisis_agenda)
 * - Overrides de contexto (preferencias, presentación, límites)
 *
 * Devuelve un objeto que cumple el Zod `AgendaPolicyResolvedSchema`.
 *
 * Reglas clave (sin legacy):
 * - No imponemos topes desde código; si el prompt los define, se respetan.
 * - La normalización nunca fuerza `null` donde el tipo espera `undefined`.
 * - Campos opcionales se agregan sólo cuando hay datos válidos.
 */
export async function AgendaConfigCompilerService(
  openAIService: IOpenAIService,
  asistente_agenda_config_text: string,
  analisis_agenda: any[],
  contexto?: {
    sede_elegida?: string | null;
    lista_sedes_clinica?: string[];
    preferencias_usuario?: { horas_preferencia_usuario?: string[]; tipo_busqueda_final?: string };
    limites_override?: { tope_global?: number | null; tope_por_dia?: number | null; tope_dias?: number | null };
    presentacion_override?: { mostrar_medicos?: 'auto' | 'siempre' | 'nunca'; mostrar_sede?: boolean };
    model?: string;
  },
): Promise<AgendaPolicyResolved> {
  // 1) Cargar prompt del compiler
  const promptsPath = path.resolve(
    __dirname,
    'packages/core/src/prompts/bot_compiler_agenda.md',
  );

  let systemPrompt = '';
  try {
    systemPrompt = await readFile(promptsPath, 'utf8');
    Logger.info('[AgendaConfigCompilerService] Prompt cargado', { promptsPath });
  } catch (err) {
    Logger.error('[AgendaConfigCompilerService] No se pudo leer el prompt del compiler', {
      promptsPath,
      err,
    });
    // Fallback mínimo — continuar estrictamente en JSON
    systemPrompt = 'Eres un compilador de políticas de agenda. Devuelve SOLO JSON válido que cumpla el esquema requerido.';
  }

  // 2) Construir payload del usuario
  const userPayload = {
    asistente_agenda_config_text: asistente_agenda_config_text || '',
    analisis_agenda: Array.isArray(analisis_agenda) ? analisis_agenda : [],
    contexto: {
      sede_elegida: contexto?.sede_elegida ?? null,
      lista_sedes_clinica: Array.isArray(contexto?.lista_sedes_clinica)
        ? contexto!.lista_sedes_clinica
        : [],
      preferencias_usuario: contexto?.preferencias_usuario || {},
      limites_override: contexto?.limites_override ?? undefined,
      presentacion_override: contexto?.presentacion_override ?? undefined,
    },
  } as const;

  Logger.info('[AgendaConfigCompilerService] Solicitando compilación de política', {
    tieneAnalisis: userPayload.analisis_agenda.length,
    sedes: userPayload.contexto.lista_sedes_clinica.length,
    mostrar_medicos: userPayload.contexto.presentacion_override?.mostrar_medicos || 'auto',
  });

  // 3) Llamada a OpenAI con validación por esquema
  const schemaLabel = 'AgendaPolicyResolvedSchema';
  const model = contexto?.model || 'gpt-5.4-mini';

  const parsed = await openAIService.getSchemaStructuredResponse(
    systemPrompt,
    JSON.stringify(userPayload),
    AgendaPolicyResolvedSchema,
    schemaLabel,
    model,
  );

  // 4) Normalización conservadora compatible con tipos
  const normalized = normalizeAgendaPolicy(parsed);
  return normalized;
}

export default AgendaConfigCompilerService;

// =====================================
// Helpers de normalización (conservadores)
// =====================================
function twoDigits(mm: string | number): string {
  const n = typeof mm === 'number' ? mm : parseInt(String(mm), 10);
  if (Number.isNaN(n)) return '00';
  const v = ((n % 60) + 60) % 60; // asegurar rango 0..59
  return v < 10 ? `0${v}` : String(v);
}

function normalizeMinList(list: unknown): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out = list
    .map((x) => (typeof x === 'string' ? x : String(x)))
    .map((s) => s.replace(/[^0-9]/g, ''))
    .filter((s) => s.length > 0)
    .map((s) => twoDigits(parseInt(s, 10)));
  const uniq = Array.from(new Set(out));
  return uniq.length ? uniq : undefined;
}

function toMaybeNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
}

function toMaybeBoolean(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function normalizeAgendaPolicy(raw: any): AgendaPolicyResolved {
  // Empezamos con el mínimo requerido y solo añadimos campos opcionales cuando corresponda
  const policy: Partial<AgendaPolicyResolved> = {
    version: '1.0',
    interpretacion_maximo: 'ultimo_inicio',
  };

  // minutos_globales
  const mg = normalizeMinList(raw?.minutos_globales);
  if (mg && mg.length) policy.minutos_globales = mg;

  // reglas específicas por tratamiento
  if (Array.isArray(raw?.reglas_minutos_por_tratamiento_resueltas)) {
    const reglas = raw.reglas_minutos_por_tratamiento_resueltas
      .map((r: any) => {
        const id = toMaybeNumber(r?.id_tratamiento);
        const nombre = typeof r?.nombre_tratamiento_bd === 'string' && r.nombre_tratamiento_bd.trim().length
          ? String(r.nombre_tratamiento_bd)
          : undefined;
        const mins = normalizeMinList(r?.minutos_permitidos) || [];
        return {
          id_tratamiento: id,
          nombre_tratamiento_bd: nombre,
          minutos_permitidos: mins,
        };
      })
      .filter((r: any) => (r.id_tratamiento !== undefined) || (typeof r.nombre_tratamiento_bd === 'string'))
      .filter((r: any) => Array.isArray(r.minutos_permitidos) && r.minutos_permitidos.length > 0);

    if (reglas.length) policy.reglas_minutos_por_tratamiento_resueltas = reglas as any;
  }

  // priorizacion_rangos
  if (raw?.priorizacion_rangos && typeof raw.priorizacion_rangos === 'object') {
    const metodo = String(raw.priorizacion_rangos.metodo || 'primer_dia_luego_resto_por_rango');
    const descripcion = typeof raw.priorizacion_rangos.descripcion === 'string'
      ? raw.priorizacion_rangos.descripcion
      : undefined;
    policy.priorizacion_rangos = { metodo, descripcion } as any;
  }

  // límites (no imponemos defaults; sólo set si vienen válidos)
  if (raw?.limites && typeof raw.limites === 'object') {
    const tope_global = toMaybeNumber(raw.limites.tope_global);
    const tope_por_dia = toMaybeNumber(raw.limites.tope_por_dia);
    const tope_dias = toMaybeNumber(raw.limites.tope_dias);
    if (
      tope_global !== undefined ||
      tope_por_dia !== undefined ||
      tope_dias !== undefined
    ) {
      policy.limites = {
        tope_global,
        tope_por_dia,
        tope_dias,
      } as any;
    }
  }

  // presentación
  const mostrar_sede = toMaybeBoolean(raw?.presentacion?.mostrar_sede);
  const mm = raw?.presentacion?.mostrar_medicos;
  const mostrar_medicos: 'auto' | 'siempre' | 'nunca' | undefined =
    mm === 'siempre' || mm === 'nunca' || mm === 'auto' ? mm : undefined;

  if (mostrar_sede !== undefined || mostrar_medicos !== undefined) {
    policy.presentacion = {
      ...(mostrar_sede !== undefined ? { mostrar_sede } : {}),
      ...(mostrar_medicos !== undefined ? { mostrar_medicos } : {}),
    } as any;
  }

  // sedes (solo si lista no vacía)
  if (Array.isArray(raw?.sedes?.lista_clinica) && raw.sedes.lista_clinica.length) {
    policy.sedes = { lista_clinica: raw.sedes.lista_clinica.map((s: any) => String(s)) } as any;
  }

  // metadata (passthrough seguro)
  if (raw?.metadata && typeof raw.metadata === 'object') {
    const meta: any = {};
    if (raw.metadata.criterios && typeof raw.metadata.criterios === 'object') meta.criterios = raw.metadata.criterios;
    if (raw.metadata.conteos && typeof raw.metadata.conteos === 'object') meta.conteos = raw.metadata.conteos;
    if (Array.isArray(raw.metadata.warnings)) meta.warnings = raw.metadata.warnings;
    if (Object.keys(meta).length) policy.metadata = meta;
  }

  return policy as AgendaPolicyResolved;
}