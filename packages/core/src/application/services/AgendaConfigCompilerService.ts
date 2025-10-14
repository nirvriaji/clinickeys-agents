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
 * "Compila" una política de presentación de agenda a partir de:
 * - Texto de configuración (asistente_agenda_config_text)
 * - Análisis local de agenda (analisis_agenda)
 * - Contexto de preferencias/overrides
 *
 * Emite un JSON válido que cumple con AgendaPolicyResolvedSchema.
 *
 * Nota: usa Responses API v5 vía IOpenAIService.getSchemaStructuredResponse.
 */
export async function AgendaConfigCompilerService(
  openAIService: IOpenAIService,
  asistente_agenda_config_text: string,
  analisis_agenda: any[],
  contexto?: {
    sede_elegida?: string | null;
    lista_sedes_clinica?: string[];
    preferencias_usuario?: { horas_preferencia_usuario?: string[]; tipo_busqueda_final?: string };
    limites_override?: { tope_global?: number; tope_por_dia?: number; tope_dias?: number };
    presentacion_override?: { mostrar_medicos?: 'auto' | 'siempre' | 'nunca' };
    model?: string;
  },
): Promise<AgendaPolicyResolved> {
  // 1) Cargar prompt del "compiler"
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
    // Fallback mínimo — preferimos continuar con instrucciones claras y estrictas
    systemPrompt = 'Eres un compilador de políticas de agenda. Responde SOLO con JSON válido que cumpla el esquema solicitado.';
  }

  // 2) Construir payload de usuario (stringificado)
  const userPayload = {
    asistente_agenda_config_text: asistente_agenda_config_text || '',
    analisis_agenda: Array.isArray(analisis_agenda) ? analisis_agenda : [],
    contexto: {
      sede_elegida: contexto?.sede_elegida ?? null,
      lista_sedes_clinica: Array.isArray(contexto?.lista_sedes_clinica)
        ? contexto?.lista_sedes_clinica
        : [],
      preferencias_usuario: contexto?.preferencias_usuario || {},
      limites_override: contexto?.limites_override || undefined,
      presentacion_override: contexto?.presentacion_override || undefined,
    },
  } as const;

  Logger.info('[AgendaConfigCompilerService] Solicitando compilación de política', {
    tieneAnalisis: userPayload.analisis_agenda.length,
    sedes: userPayload.contexto.lista_sedes_clinica.length,
    mostrar_medicos: userPayload.contexto.presentacion_override?.mostrar_medicos || 'auto',
  });

  // 3) Llamar a OpenAI con esquema Zod real
  const schemaLabel = 'AgendaPolicyResolvedSchema';
  const model = contexto?.model || 'gpt-4o-mini';

  const parsed = await openAIService.getSchemaStructuredResponse(
    systemPrompt,
    JSON.stringify(userPayload),
    AgendaPolicyResolvedSchema,
    schemaLabel,
    model,
  );

  // 4) Normalizar y asegurar defaults conservadores
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
  const v = n % 60;
  return v < 10 ? `0${v}` : String(v);
}

function normalizeMinList(list: any): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out = list
    .map((x) => (typeof x === 'string' ? x : String(x)))
    .map((s) => s.replace(/[^0-9]/g, ''))
    .filter((s) => s.length > 0)
    .map((s) => twoDigits(parseInt(s, 10)));
  const uniq = Array.from(new Set(out));
  return uniq.length ? uniq : undefined;
}

function toNum(v: any): number | undefined {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeAgendaPolicy(raw: any): AgendaPolicyResolved {
  const policy: AgendaPolicyResolved = {
    version: '1.0',
    interpretacion_maximo: 'ultimo_inicio',
  } as any;

  // minutos_globales
  const mg = normalizeMinList(raw?.minutos_globales);
  if (mg && mg.length) (policy as any).minutos_globales = mg;

  // reglas específicas por tratamiento
  if (Array.isArray(raw?.reglas_minutos_por_tratamiento_resueltas)) {
    const reglas = raw.reglas_minutos_por_tratamiento_resueltas
      .map((r: any) => ({
        id_tratamiento: typeof r?.id_tratamiento === 'number' ? r.id_tratamiento : undefined,
        nombre_tratamiento_bd: typeof r?.nombre_tratamiento_bd === 'string'
          ? r.nombre_tratamiento_bd
          : undefined,
        minutos_permitidos: normalizeMinList(r?.minutos_permitidos) || [],
      }))
      .filter((r: any) =>
        (typeof r.nombre_tratamiento_bd === 'string' && r.nombre_tratamiento_bd.length > 0) ||
        typeof r.id_tratamiento === 'number',
      )
      .filter((r: any) => Array.isArray(r.minutos_permitidos) && r.minutos_permitidos.length > 0);

    if (reglas.length) (policy as any).reglas_minutos_por_tratamiento_resueltas = reglas;
  }

  // priorizacion_rangos
  if (raw?.priorizacion_rangos && typeof raw.priorizacion_rangos === 'object') {
    (policy as any).priorizacion_rangos = {
      metodo: String(raw.priorizacion_rangos.metodo || 'primer_dia_luego_resto_por_rango'),
      descripcion:
        typeof raw.priorizacion_rangos.descripcion === 'string'
          ? raw.priorizacion_rangos.descripcion
          : undefined,
    };
  }

  // limites
  if (raw?.limites && typeof raw.limites === 'object') {
    const tg = toNum(raw.limites.tope_global);
    const tpd = toNum(raw.limites.tope_por_dia);
    const td = toNum(raw.limites.tope_dias);
    (policy as any).limites = {
      tope_global: tg ?? 10,
      tope_por_dia: tpd ?? 3,
      tope_dias: td ?? 3,
    };
  }

  // presentacion
  const mostrar_sede = !!raw?.presentacion?.mostrar_sede;
  const mostrar_medicos =
    raw?.presentacion?.mostrar_medicos === 'siempre' || raw?.presentacion?.mostrar_medicos === 'nunca'
      ? raw.presentacion.mostrar_medicos
      : 'auto';
  (policy as any).presentacion = { mostrar_sede, mostrar_medicos };

  // sedes (solo si mostrar_sede = true y lista no vacía)
  if (mostrar_sede && Array.isArray(raw?.sedes?.lista_clinica) && raw.sedes.lista_clinica.length) {
    (policy as any).sedes = { lista_clinica: raw.sedes.lista_clinica.map((s: any) => String(s)) };
  }

  // metadata
  if (raw?.metadata && typeof raw.metadata === 'object') {
    (policy as any).metadata = {
      criterios: raw.metadata.criterios || undefined,
      conteos: raw.metadata.conteos || undefined,
      warnings: Array.isArray(raw.metadata.warnings) ? raw.metadata.warnings : undefined,
    };
  }

  return policy;
}