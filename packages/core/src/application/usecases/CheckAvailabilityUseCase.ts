// packages/core/src/application/usecases/CheckAvailabilityUseCase.ts

import {
  AvailabilityRequestExtractorService,
  AvailabilityDomainService,
} from '@clinickeys-agents/core/application/services';
import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { ITratamientoRepository } from '@clinickeys-agents/core/domain/tratamiento';
import { IMedicoRepository } from '@clinickeys-agents/core/domain/medico';
import { IEspacioRepository } from '@clinickeys-agents/core/domain/espacio';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { getClinicLocalTimestamp } from '@clinickeys-agents/core/utils';
import type { DateTime } from 'luxon';

import {
  pickAnchorsFromExtractorDates,
  orderAnchorsByCloseness,
  planBlocksAroundAnchor,
  expandRangeToFechas,
  collapseBlocksToRanges,
  type Block,
  type PlannerOptions,
} from '@clinickeys-agents/core/application/services';

import {
  AvailabilityResponseRedactorService,
  AgendaConfigCompilerService,
  SlotAccumulator,
} from '@clinickeys-agents/core/application/services';
import type {
  SlotAccumulatorInput,
  SlotAccumulatorOutput,
} from '@clinickeys-agents/core/application/services/types/Availability';

import { type HorarioEscogido, type SlotDisponibilidad } from '@clinickeys-agents/core/domain/availability';

interface CheckAvailabilityInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  params: {
    tratamiento: string;
    medico?: string | null;
    espacio?: string | null;
    fechas: string; // texto libre (rangos, fechas sueltas)
    horas: string; // texto libre ("mañana", "cualquier hora", etc.) — se usa como preferencia
    rango_dias_extra?: number; // opcional
    summary: string;
  };
  timezone: string;
  tiempoActualDT: DateTime;
  subdomain: string;
}

interface CheckAvailabilityOutput {
  success: boolean;
  toolOutput: string;
}

 type StepTipo =
  | 'original'
  | 'intermedio_hasta_fecha'
  | 'ampliada_mismo_medico'
  | 'ampliada_sin_medico_rango_dias_original'
  | 'ampliada_sin_medico_rango_dias_extendido';

export class CheckAvailabilityUseCase {
  constructor(
    private readonly kommoService: any,
    private readonly availabilityService: AvailabilityDomainService,
    private readonly availabilityRequestExtractorService: AvailabilityRequestExtractorService,
    private readonly tratamientoRepositoryMySQL: ITratamientoRepository,
    private readonly medicoRepositoryMySQL: IMedicoRepository,
    private readonly espacioRepositoryMySQL: IEspacioRepository,
  ) {}

  public async execute(input: CheckAvailabilityInput): Promise<CheckAvailabilityOutput> {
    const { botConfig, leadId, normalizedLeadCF, params, timezone, tiempoActualDT } = input;
    const { tratamiento, fechas, horas, medico, espacio } = params;

    const localTimeForPrompts = getClinicLocalTimestamp(tiempoActualDT, timezone);

    Logger.info('[CheckAvailability] Inicio búsqueda de disponibilidad', {
      leadId,
      clinicId: botConfig.clinicId,
      tratamiento,
      medico,
      espacio,
      fechas,
      horas,
      timezone,
      localTimeForPrompts,
    });

    // 1) Mensaje "please-wait"
    Logger.info('[CheckAvailability] Enviando mensaje inicial al bot (please-wait)', { leadId });
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message:
        'Muy bien, voy a mirar la agenda para ver las citas que tenemos disponibles. Un momento por favor.',
    });

    // 2) Catálogos (para el extractor)
    const tratamientos = await this.tratamientoRepositoryMySQL.getActiveTreatmentsForClinic(
      botConfig.clinicId,
      botConfig.superClinicId,
    );
    const nombresTratamientos = tratamientos.map((t) => t.nombre_tratamiento);
    const medicos = await this.medicoRepositoryMySQL.getMedicos(
      botConfig.clinicId,
      botConfig.superClinicId,
    );
    const nombresMedicos = medicos.map((m) => m.nombre_completo);
    const espacios = await this.espacioRepositoryMySQL.findByClinica(botConfig.clinicId);
    const nombresEspacios = espacios.map((e) => e.nombre);

    Logger.info('[CheckAvailability] Catálogos cargados', {
      tratamientos: nombresTratamientos.length,
      medicos: nombresMedicos.length,
      espacios: nombresEspacios.length,
    });

    // 3) Extraer filtros estructurados
    Logger.info('[CheckAvailability] Extrayendo filtros del mensaje del usuario', {
      leadId,
      userParams: params,
    });

    const structuredFilters = await this.availabilityRequestExtractorService.extract(
      JSON.stringify({
        tratamiento: params.tratamiento,
        medico: params.medico,
        espacio: params.espacio,
        fechas: params.fechas,
      }),
      {
        id_clinica: botConfig.clinicId,
        id_super_clinica: botConfig.superClinicId,
        tiempo_actual: tiempoActualDT.toISO() as string,
        localTimeForPrompts,
        tratamientosDisponibles: nombresTratamientos,
        medicosDisponibles: nombresMedicos,
        espaciosDisponibles: nombresEspacios,
      },
    );

    Logger.info('[CheckAvailability] Filtros obtenidos del extractor', {
      filtersCount: structuredFilters.length,
    });

    if (!structuredFilters.length) {
      const aclaracion =
        'No he podido interpretar bien su solicitud para buscar horarios. ¿Podría reenviar su mensaje indicando el tratamiento y fechas aproximadas que prefiere?';

      const toolOutput = `#consultaAgendar\n` +
        `    TIEMPO_LOCAL: ${localTimeForPrompts}\n` +
        `    DISCLAIMER_FECHAS_BUSCADAS: []\n` +
        `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: 'bloques', horarios_escogidos: [] })}\n` +
        `    HORARIOS_TEXTO: ${JSON.stringify(aclaracion)}\n` +
        `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n` +
        `    `;

      Logger.warn('[CheckAvailability] Extractor sin filtros; devolviendo mensaje de aclaración');
      return { success: true, toolOutput };
    }

    // 4) Config generales de planner y topes
    const blockDays = 5; // tamaño de bloque alrededor del anchor
    const forwardMaxDaysDefault = 45; // extensión por defecto hacia adelante
    const MAX_GLOBAL = 10; // tope global buscado

    Logger.info('[CheckAvailability] Configuración de planner', {
      blockDays,
      forwardMaxDaysDefault,
      MAX_GLOBAL,
    });

    const plannerBase: Pick<PlannerOptions, 'blockDays'> = { blockDays };

    // Acumuladores y tracking
    const globalHorarios: HorarioEscogido[] = [];
    const seenKeys = new Set<string>();
    const blocksConsultados: Block[] = [];

    // Para redactor/tipo_busqueda
    let lastTipoBusquedaFromBlock: string | undefined;
    let lastPolicyUsed: any | undefined;

    const addSelected = (arr: HorarioEscogido[], origen: string) => {
      for (const h of arr) {
        const key = this.horarioKey(h);
        if (seenKeys.has(key)) continue;
        globalHorarios.push(h);
        seenKeys.add(key);
        Logger.info('[CheckAvailability] Selección agregada', { origen, key, total: globalHorarios.length });
        if (globalHorarios.length >= MAX_GLOBAL) {
          Logger.info('[CheckAvailability] Corte temprano (tope global alcanzado)', { MAX_GLOBAL });
          return true;
        }
      }
      return false;
    };

    // 5) Recorrido: por filtro → step → ancla → bloque (policy por BLOQUE)
    for (const filter of structuredFilters) {
      if (globalHorarios.length >= MAX_GLOBAL) break;

      const tratamientosSel = (filter as any)?.tratamientos ?? [];
      const medicosSel = (filter as any)?.medicos ?? [];
      const espaciosSel = (filter as any)?.espacios ?? [];

      // Expandir date_ranges → fechas {fecha}
      const fechasExtractor: { fecha: string }[] = [];
      const drs = Array.isArray((filter as any).date_ranges) ? (filter as any).date_ranges : [];
      for (const r of drs) {
        const start = r?.start_date;
        const end = r?.end_date;
        if (typeof start === 'string' && typeof end === 'string') {
          const fechasRango = expandRangeToFechas({ start, end });
          fechasExtractor.push(...fechasRango);
        }
      }

      const anchors = orderAnchorsByCloseness(
        pickAnchorsFromExtractorDates(fechasExtractor),
        tiempoActualDT.toISODate()!,
      );

      Logger.info('[CheckAvailability] Anclas calculadas para filter', { anchors });

      const hasMedico = (medicosSel || []).length > 0;

      const steps: {
        tipo: StepTipo;
        filtros: { con_medico: boolean; rango_dias_extra: number; backwardOnly?: boolean };
        medicos: string[];
        planner: PlannerOptions;
      }[] = [];

      // original → 5 días hacia adelante
      steps.push({
        tipo: 'original',
        filtros: { con_medico: hasMedico, rango_dias_extra: 5 },
        medicos: medicosSel,
        planner: { ...plannerBase, forwardMaxDays: 5 },
      });

      // intermedio_hasta_fecha → backward only
      steps.push({
        tipo: 'intermedio_hasta_fecha',
        filtros: { con_medico: hasMedico, rango_dias_extra: 0, backwardOnly: true },
        medicos: medicosSel,
        planner: { ...plannerBase, forwardMaxDays: 5 },
      });

      // ampliada_mismo_medico → 45 días
      steps.push({
        tipo: 'ampliada_mismo_medico',
        filtros: { con_medico: hasMedico, rango_dias_extra: 45 },
        medicos: medicosSel,
        planner: { ...plannerBase, forwardMaxDays: forwardMaxDaysDefault },
      });

      // sin médico, rango original (5 días)
      steps.push({
        tipo: 'ampliada_sin_medico_rango_dias_original',
        filtros: { con_medico: false, rango_dias_extra: 5 },
        medicos: [],
        planner: { ...plannerBase, forwardMaxDays: 5 },
      });

      // sin médico, extendido (45 días)
      steps.push({
        tipo: 'ampliada_sin_medico_rango_dias_extendido',
        filtros: { con_medico: false, rango_dias_extra: 45 },
        medicos: [],
        planner: { ...plannerBase, forwardMaxDays: forwardMaxDaysDefault },
      });

      for (const step of steps) {
        if (globalHorarios.length >= MAX_GLOBAL) break;
        Logger.info('[CheckAvailability] Step start', { tipo: step.tipo, planner: step.planner, con_medico: step.filtros.con_medico });

        for (const anchor of anchors) {
          if (globalHorarios.length >= MAX_GLOBAL) break;
          Logger.debug('[CheckAvailability] Anchor', { anchor });

          let blocks = planBlocksAroundAnchor(anchor, tiempoActualDT.toISODate()!, step.planner);
          if (step.filtros.backwardOnly) blocks = blocks.filter((b) => b.direction === 'backward');

          for (const block of blocks) {
            if (globalHorarios.length >= MAX_GLOBAL) break;

            Logger.info('[CheckAvailability] Block window', { start: block.start, end: block.end, direction: block.direction });

            const fechasBloque = expandRangeToFechas({ start: block.start, end: block.end });
            const availabilityRequest = {
              tratamientos: tratamientosSel,
              medicos: step.medicos,
              espacios: espaciosSel,
              fechas: fechasBloque,
              id_clinica: botConfig.clinicId,
              tiempo_actual: tiempoActualDT.toISO() as string,
            };

            const baseResult = await this.availabilityService.getAppointmentAvailability(availabilityRequest);
            const analisis_local: SlotDisponibilidad[] = baseResult.success && Array.isArray(baseResult.analisis_agenda)
              ? (baseResult.analisis_agenda as SlotDisponibilidad[])
              : [];

            Logger.info('[CheckAvailability] Block base results', { analisisCount: analisis_local.length });

            // registrar bloque consultado para disclaimer (hay o no resultados)
            blocksConsultados.push(block);

            if (!analisis_local.length) {
              Logger.warn('[CheckAvailability] Block skipped (sin resultados del dominio)');
              continue;
            }

            // 5.a) Compilar policy **por bloque**
            const presenterOpenAI = (this.availabilityRequestExtractorService as any)['openAIService'];
            let policyForBlock: any;
            try {
              policyForBlock = await AgendaConfigCompilerService(
                presenterOpenAI,
                botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || '',
                analisis_local,
                {
                  preferencias_usuario: { horas_preferencia_usuario: horas ? [horas] : [] },
                  presentacion_override: { mostrar_medicos: 'auto' },
                },
              );
              Logger.info('[AgendaConfigCompilerService] Block policy compiled', {
                minutos_globales: policyForBlock?.minutos_globales?.length || 0,
                reglas_tratamiento: policyForBlock?.reglas_minutos_por_tratamiento_resueltas?.length || 0,
              });
            } catch (err) {
              Logger.error('[AgendaConfigCompilerService] Error compilando policy para bloque. Se omite bloque.', { err });
              continue; // omitimos este bloque si el compiler falla
            }

            // 5.b) Acumular con SlotAccumulator usando SOLO el analisis del bloque
            const accInput: SlotAccumulatorInput = {
              policy: policyForBlock,
              filters: [filter] as any,
              windows: analisis_local as any,
              contexto: {
                horas_preferencia_usuario: horas ? [horas] : [],
                ahoraISO: tiempoActualDT.toISO() as string,
                timezone,
              },
            };

            let accOut: SlotAccumulatorOutput | null = null;
            try {
              accOut = await SlotAccumulator(accInput);
            } catch (err) {
              Logger.error('[SlotAccumulator] Error en acumulación por bloque. Se omite bloque.', { err });
              continue;
            }

            const seleccionadasBloque: HorarioEscogido[] = Array.isArray(accOut?.opciones_top10)
              ? (accOut!.opciones_top10 as any)
              : [];

            if (!seleccionadasBloque.length) {
              Logger.warn('[SlotAccumulator] Block NO MATCH', {
                candidatos: analisis_local.length,
                motivo: accOut?.metadata?.warnings || [],
              });
              continue;
            }

            lastTipoBusquedaFromBlock = accOut?.tipo_busqueda_final || lastTipoBusquedaFromBlock || 'bloques';
            lastPolicyUsed = policyForBlock;

            const cut = addSelected(seleccionadasBloque, `${step.tipo}/${anchor}`);
            if (cut) break; // tope global alcanzado
          }
        }
      }
    }

    // 6) Selección final ordenada y redacción
    const presenterOpenAI = (this.availabilityRequestExtractorService as any)['openAIService'];

    const finalHorarios = this.orderHorarios(
      globalHorarios,
      tiempoActualDT.toISODate()!,
      tiempoActualDT.toISO()!,
    ).slice(0, MAX_GLOBAL);

    Logger.info('[CheckAvailability] Selección final (global)', {
      finales: finalHorarios.length,
    });

    const disclaimerRanges = collapseBlocksToRanges(blocksConsultados);

    const diasMostrados = Array.from(
      new Set(
        finalHorarios
          .map((s: any) => s?.fecha_cita || s?.fecha)
          .filter((x: any): x is string => typeof x === 'string' && x.length > 0),
      ),
    );

    const redactorResult = await AvailabilityResponseRedactorService(
      presenterOpenAI,
      finalHorarios,
      { policy: lastPolicyUsed || { version: '1.0', interpretacion_maximo: 'ultimo_inicio' } as any },
      {
        ahoraISO: tiempoActualDT.toISO() as string,
        timezone,
        contextoRedactor: {
          tipo_busqueda: lastTipoBusquedaFromBlock || 'bloques',
          disclaimer_fechas: disclaimerRanges,
          dias_mostrados: diasMostrados,
          horas_preferencia_usuario: horas || '',
        },
      },
    );

    Logger.info('[CheckAvailability] Texto final generado por redactor', {
      longitud: redactorResult.mensaje?.length || 0,
      preview: redactorResult.mensaje?.substring(0, 120),
    });

    // 7) toolOutput final
    const toolOutput = `#consultaAgendar\n` +
      `    TIEMPO_LOCAL: ${localTimeForPrompts}\n` +
      `    DISCLAIMER_FECHAS_BUSCADAS: ${JSON.stringify(disclaimerRanges)}\n` +
      `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: lastTipoBusquedaFromBlock || 'bloques', horarios_escogidos: finalHorarios })}\n` +
      `    HORARIOS_TEXTO: ${JSON.stringify(redactorResult.mensaje)}\n` +
      `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n` +
      `    `;

    Logger.info('[CheckAvailability] Ejecución completada con éxito', {
      leadId,
      bloques_consultados: blocksConsultados.length,
      finales: finalHorarios.length,
    });

    return { success: true, toolOutput };
  }

  // =============================
  // Helpers
  // =============================
  private horarioKey(h: HorarioEscogido): string {
    const f = (h as any).fecha_cita || (h as any).fecha || '';
    const hi = (h as any).hora_inicio || '';
    const m = (h as any).id_medico || (h as any).medico?.id_medico || (h as any).medico || '';
    const e = (h as any).id_espacio || (h as any).espacio?.id_espacio || (h as any).espacio || '';
    return `${f}T${hi}|${m}|${e}`;
  }

  private orderHorarios(horarios: HorarioEscogido[], anchorISO: string, nowISO: string): HorarioEscogido[] {
    const toMillis = (h: any): number => {
      const fecha = h?.fecha_cita || h?.fecha;
      const hora = h?.hora_inicio || '00:00';
      if (!fecha) return Number.MAX_SAFE_INTEGER;
      const hhmm = /^\d{2}:\d{2}$/.test(hora) ? hora : String(hora || '00:00').substring(0, 5);
      const iso = `${fecha}T${hhmm}:00.000Z`;
      return Date.parse(iso);
    };

    const anchorMillis = Date.parse(`${anchorISO}T00:00:00.000Z`);
    const nowMillis = Date.parse(nowISO);

    return [...horarios].sort((a: any, b: any) => {
      const da = toMillis(a);
      const db = toMillis(b);
      const distAAnchor = Math.abs(da - anchorMillis);
      const distBAnchor = Math.abs(db - anchorMillis);
      if (distAAnchor !== distBAnchor) return distAAnchor - distBAnchor;
      const distANow = Math.abs(da - nowMillis);
      const distBNow = Math.abs(db - nowMillis);
      if (distANow !== distBNow) return distANow - distBNow;
      return da - db;
    });
  }
}
