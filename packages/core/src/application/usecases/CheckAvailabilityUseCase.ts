// packages/core/src/application/usecases/CheckAvailabilityUseCase.ts

import {
  AvailabilityRequestExtractorService,
  AvailabilityFilterResult,
  AvailabilityDomainService,
  AvailabilityResponsePresenterService,
  AvailabilityResponseRedactorService,
} from '@clinickeys-agents/core/application/services';
import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { ITratamientoRepository } from '@clinickeys-agents/core/domain/tratamiento';
import { IMedicoRepository } from '@clinickeys-agents/core/domain/medico';
import { IEspacioRepository } from '@clinickeys-agents/core/domain/espacio';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { getClinicLocalTimestamp } from '@clinickeys-agents/core/utils';
import type { DateTime } from 'luxon';

// Planner + tipos
import {
  pickAnchorsFromExtractorDates,
  orderAnchorsByCloseness,
  planBlocksAroundAnchor,
  expandRangeToFechas,
  collapseBlocksToRanges,
  type Block,
  type PlannerOptions,
} from '@clinickeys-agents/core/application/services';

import { type HorarioEscogido } from '@clinickeys-agents/core/domain/availability';

interface CheckAvailabilityInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  params: {
    tratamiento: string;
    medico?: string | null;
    espacio?: string | null;
    fechas: string; // texto libre (rangos, fechas sueltas)
    horas: string; // texto libre ("mañana", "cualquier hora", etc.)
    rango_dias_extra?: number; // opcional, puede venir del extractor
    summary: string; // 80–150 caracteres
  };
  timezone: string;
  tiempoActualDT: DateTime;
  subdomain: string;
}

interface CheckAvailabilityOutput {
  success: boolean;
  toolOutput: string;
}

interface StepDefinition {
  tipo: StepTipo;
  filtros: { con_medico: boolean; rango_dias_extra: number; rango_dias_antes?: number };
  params: AvailabilityFilterResult & { rango_dias_extra?: number; rango_dias_antes?: number };
}

// Procedencia por slot (tipos de step)
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

    // 2) Preparación: catálogos (para el extractor)
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

    // 3) Extraer filtros estructurados (fechas del extractor = autoritativas)
    Logger.info('[CheckAvailability] Extrayendo filtros del mensaje del usuario', {
      leadId,
      userParams: params,
    });
    const structuredFilters = await this.availabilityRequestExtractorService.extract(
      JSON.stringify(params),
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

    // 4) Configuración fija para el planner (defaults en código)
    const blockDays = 5;
    const forwardMaxDays = 45;
    const maxOpciones = 3;

    Logger.info('[CheckAvailability] Configuración aplicada', {
      blockDays,
      forwardMaxDays,
      maxOpciones,
    });

    const plannerOpts: PlannerOptions = { blockDays, forwardMaxDays };

    // 5) Configuración textual a inyectar en presentador/redactor (sin parse)
    const configuracion_disponibilidades: string =
      botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || '';

    // 6) Recorrido de STEPS con acumulación GLOBAL (0–maxOpciones)
    let globalHorarios: HorarioEscogido[] = [];
    let blocksConsultados: Block[] = [];

    // Registrar procedencia del primer aporte del horario
    const horarioSource = new Map<string, { tipo: StepTipo }>();

    const addHorarios = (horarios: HorarioEscogido[], tipo: StepTipo) => {
      for (const h of horarios) {
        const key = this.horarioKey(h);
        if (!globalHorarios.some((x) => this.horarioKey(x) === key)) {
          globalHorarios.push(h);
          if (!horarioSource.has(key)) horarioSource.set(key, { tipo });
          Logger.info('[CheckAvailability] Nuevo horario agregado', {
            horario: key,
            totalAcumulados: globalHorarios.length,
            tipo_origen: tipo,
          });
          if (globalHorarios.length >= maxOpciones) {
            Logger.info('[CheckAvailability] Corte temprano alcanzado (maxOpciones)', {
              maxOpciones,
            });
            return; // corte temprano global
          }
        }
      }
    };

    for (const filter of structuredFilters) {
      Logger.info('[CheckAvailability] Procesando filter del extractor', {
        tratamientos: filter.tratamientos,
        medicos: filter.medicos,
        espacios: filter.espacios,
        fechas: (filter.fechas || []).length,
      });

      const steps: StepDefinition[] = [];
      const hasMedico = (filter.medicos || []).length > 0;

      steps.push({
        tipo: 'original',
        filtros: { con_medico: hasMedico, rango_dias_extra: 0 },
        params: { ...filter },
      });

      const firstFecha = filter.fechas?.[0]?.fecha;
      if (firstFecha) {
        const diffDias = Math.max(
          0,
          Math.floor(
            (new Date(firstFecha).getTime() - tiempoActualDT.toJSDate().getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        );
        steps.push({
          tipo: 'intermedio_hasta_fecha',
          filtros: { con_medico: hasMedico, rango_dias_extra: 0, rango_dias_antes: diffDias },
          params: { ...filter, rango_dias_antes: diffDias },
        });
      }

      steps.push({
        tipo: 'ampliada_mismo_medico',
        filtros: { con_medico: hasMedico, rango_dias_extra: 45 },
        params: { ...filter, rango_dias_extra: 45 },
      });
      steps.push({
        tipo: 'ampliada_sin_medico_rango_dias_original',
        filtros: { con_medico: false, rango_dias_extra: 0 },
        params: { ...filter, medicos: [] },
      });
      steps.push({
        tipo: 'ampliada_sin_medico_rango_dias_extendido',
        filtros: { con_medico: false, rango_dias_extra: 45 },
        params: { ...filter, medicos: [], rango_dias_extra: 45 },
      });

      // Anclas = INICIO de cada rango de fechas, ordenadas por cercanía al ahora
      const anchors = orderAnchorsByCloseness(
        pickAnchorsFromExtractorDates(filter.fechas || []),
        tiempoActualDT.toISODate()!,
      );
      Logger.info('[CheckAvailability] Anclas calculadas para este filter', { anchors });

      for (const step of steps) {
        if (globalHorarios.length >= maxOpciones) break;
        Logger.info('[CheckAvailability] Iniciando step', { tipo: step.tipo, filtros: step.filtros });

        for (const anchor of anchors) {
          if (globalHorarios.length >= maxOpciones) break;
          Logger.info('[CheckAvailability] Evaluando ancla', { anchor });

          let blocks = planBlocksAroundAnchor(anchor, tiempoActualDT.toISODate()!, plannerOpts);
          if (step.tipo === 'intermedio_hasta_fecha') {
            blocks = blocks.filter((b) => b.direction === 'backward');
          }
          Logger.info('[CheckAvailability] Bloques generados', {
            totalBlocks: blocks.length,
            direction: step.tipo === 'intermedio_hasta_fecha' ? 'backward-only' : 'both',
          });

          for (const block of blocks) {
            if (globalHorarios.length >= maxOpciones) break;
            Logger.info('[CheckAvailability] Explorando bloque', {
              start: block.start,
              end: block.end,
              direction: block.direction,
            });

            const fechasBloque = expandRangeToFechas({ start: block.start, end: block.end });
            const availabilityRequest = {
              tratamientos: step.params.tratamientos || [],
              medicos: step.params.medicos || [],
              espacios: step.params.espacios || [],
              fechas: fechasBloque,
              id_clinica: botConfig.clinicId,
              tiempo_actual: tiempoActualDT.toISO() as string,
            };
            Logger.info('[CheckAvailability] Consulta de disponibilidad construida', {
              fechasCount: fechasBloque.length,
              tratamientos: availabilityRequest.tratamientos,
              medicos: availabilityRequest.medicos,
              espacios: availabilityRequest.espacios,
            });

            const baseResult = await this.availabilityService.getAppointmentAvailability(
              availabilityRequest,
            );
            if (!baseResult.success || !Array.isArray(baseResult.analisis_agenda)) {
              Logger.warn('[CheckAvailability] Sin resultados en bloque', {
                start: block.start,
                end: block.end,
              });
              continue;
            }

            Logger.info('[CheckAvailability] Resultados encontrados en bloque', {
              cantidad: baseResult.analisis_agenda.length,
            });
            Logger.debug('[CheckAvailability] Resultados (analisis_agenda) encontrados en bloque', {
              analisis_agenda: baseResult.analisis_agenda,
            });

            // Presentador por bloque/ancla (aplica reglas configuradas y devuelve horarios ya concretos)
            const presenterOpenAI = (this.availabilityRequestExtractorService as any)['openAIService'];
            const presenterResultPerBlock: any = await AvailabilityResponsePresenterService(
              presenterOpenAI,
              baseResult.analisis_agenda.map((s) => ({ ...s })),
              configuracion_disponibilidades,
            );

            const selectedByPresenter: HorarioEscogido[] = Array.isArray(
              presenterResultPerBlock?.horarios_escogidos,
            )
              ? (presenterResultPerBlock.horarios_escogidos as HorarioEscogido[])
              : [];

            Logger.info('[CheckAvailability] Presentador por bloque: selección', {
              seleccionadas: selectedByPresenter.length,
            });

            const ordered = this.orderHorarios(selectedByPresenter, anchor, tiempoActualDT.toISO()!);
            addHorarios(ordered, step.tipo);
            blocksConsultados.push(block);

            if (globalHorarios.length >= maxOpciones) break;
          }
        }
      }

      if (globalHorarios.length >= maxOpciones) break;
    }

    // 7) Selección final y cálculo de tipo_busqueda
    const presenterOpenAI = (this.availabilityRequestExtractorService as any)['openAIService'];

    const finalHorarios = this.orderHorarios(
      globalHorarios,
      tiempoActualDT.toISODate()!,
      tiempoActualDT.toISO()!,
    ).slice(0, maxOpciones);

    Logger.info('[CheckAvailability] Selección final de horarios (acumulador global)', {
      finales: finalHorarios.length,
    });

    const finalKeys = finalHorarios.map((h) => this.horarioKey(h));
    const tiposUsadosFinal = finalKeys
      .map((k) => horarioSource.get(k)?.tipo)
      .filter((t): t is StepTipo => !!t);

    let tipo_busqueda_final: string | undefined;
    if (tiposUsadosFinal.length > 0) {
      const unique = new Set(tiposUsadosFinal);
      if (unique.size === 1) {
        tipo_busqueda_final = tiposUsadosFinal[0];
      } else {
        const counts = new Map<StepTipo, number>();
        for (const t of tiposUsadosFinal) counts.set(t, (counts.get(t) ?? 0) + 1);
        tipo_busqueda_final = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
    }

    // 8) DISCLAIMER de rangos explorados (colapsado)
    const disclaimerRanges = collapseBlocksToRanges(blocksConsultados);

    // 9) Redacción final (pasando CONTEXTO_REDACTOR)
    const diasMostrados = Array.from(
      new Set(
        finalHorarios
          .map((s: any) => s?.fecha_cita || s?.fecha)
          .filter((x: any): x is string => typeof x === 'string' && x.length > 0),
      ),
    );

    const redactorContext = {
      tipo_busqueda: tipo_busqueda_final || 'bloques',
      disclaimer_fechas: disclaimerRanges,
      dias_mostrados: diasMostrados,
    } as Record<string, unknown>;

    const redactorResult = await AvailabilityResponseRedactorService(
      presenterOpenAI,
      finalHorarios,
      configuracion_disponibilidades,
      { ahoraISO: tiempoActualDT.toISO() as string, timezone, contextoRedactor: redactorContext },
    );

    Logger.info('[CheckAvailability] Texto final generado por redactor', {
      longitud: redactorResult.mensaje?.length || 0,
      preview: redactorResult.mensaje?.substring(0, 120),
    });

    // 10) toolOutput final (incluye texto redactado)
    const toolOutput = `#consultaAgendar
    TIEMPO_LOCAL: ${localTimeForPrompts}
    DISCLAIMER_FECHAS_BUSCADAS: ${JSON.stringify(disclaimerRanges)}
    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: tipo_busqueda_final || 'bloques', horarios_escogidos: finalHorarios })}
    HORARIOS_TEXTO: ${JSON.stringify(redactorResult.mensaje)}
    MENSAJE_USUARIO: ${JSON.stringify(params)}
    `;

    Logger.info('[CheckAvailability] Ejecución completada con éxito', {
      leadId,
      acumulados: globalHorarios.length,
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