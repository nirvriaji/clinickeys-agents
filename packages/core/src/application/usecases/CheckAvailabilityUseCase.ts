// packages/core/src/application/usecases/CheckAvailabilityUseCase.ts

import { AvailabilityRequestExtractorService, AvailabilityFilterResult, AvailabilityDomainService, AvailabilityResponsePresenterService, AvailabilityResponseRedactorService } from '@clinickeys-agents/core/application/services';
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
import { SlotDisponibilidad } from '@clinickeys-agents/core/domain/availability';

interface CheckAvailabilityInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  params: {
    tratamiento: string;
    medico?: string | null;
    espacio?: string | null;
    fechas: string;
    horas: string;
    rango_dias_extra?: number;
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

interface StepDefinition {
  tipo: string;
  filtros: { con_medico: boolean; rango_dias_extra: number; rango_dias_antes?: number };
  params: AvailabilityFilterResult & { rango_dias_extra?: number; rango_dias_antes?: number };
}

export class CheckAvailabilityUseCase {
  constructor(
    private readonly kommoService: any,
    private readonly availabilityService: AvailabilityDomainService,
    private readonly availabilityRequestExtractorService: AvailabilityRequestExtractorService,
    private readonly tratamientoRepositoryMySQL: ITratamientoRepository,
    private readonly medicoRepositoryMySQL: IMedicoRepository,
    private readonly espacioRepositoryMySQL: IEspacioRepository,
  ) { }

  public async execute(input: CheckAvailabilityInput): Promise<CheckAvailabilityOutput> {
    const { botConfig, leadId, normalizedLeadCF, params, timezone, tiempoActualDT } = input;
    params.medico = undefined;
    params.espacio = undefined;
    const { tratamiento, fechas, horas, medico, espacio } = params;

    const localTimeForPrompts = getClinicLocalTimestamp(tiempoActualDT, timezone);

    Logger.info('[CheckAvailability] Inicio búsqueda de disponibilidad', { leadId, clinicId: botConfig.clinicId, tratamiento, medico, espacio, fechas, horas, timezone, localTimeForPrompts });

    // 1) Mensaje "please-wait"
    Logger.info('[CheckAvailability] Enviando mensaje inicial al bot (please-wait)', { leadId });
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message: 'Muy bien, voy a mirar la agenda para ver las citas que tenemos disponibles. Un momento por favor.',
    });

    // 2) Preparación: catálogos
    const tratamientos = await this.tratamientoRepositoryMySQL.getActiveTreatmentsForClinic(
      botConfig.clinicId,
      botConfig.superClinicId
    );
    const nombresTratamientos = tratamientos.map((t) => t.nombre_tratamiento);
    const medicos = await this.medicoRepositoryMySQL.getMedicos(
      botConfig.clinicId,
      botConfig.superClinicId
    );
    const nombresMedicos = medicos.map((m) => m.nombre_completo);
    const espacios = await this.espacioRepositoryMySQL.findByClinica(botConfig.clinicId);
    const nombresEspacios = espacios.map((e) => e.nombre);

    Logger.info('[CheckAvailability] Catálogos cargados', { tratamientos: nombresTratamientos.length, medicos: nombresMedicos.length, espacios: nombresEspacios.length });

    // 3) Extraer filtros estructurados (fechas del extractor = autoritativas)
    Logger.info('[CheckAvailability] Extrayendo filtros del mensaje del usuario', { leadId, userParams: params });
    const structuredFilters = await this.availabilityRequestExtractorService.extract(JSON.stringify(params), {
      id_clinica: botConfig.clinicId,
      id_super_clinica: botConfig.superClinicId,
      tiempo_actual: tiempoActualDT.toISO() as string,
      localTimeForPrompts,
      tratamientosDisponibles: nombresTratamientos,
      medicosDisponibles: nombresMedicos,
      espaciosDisponibles: nombresEspacios,
    });
    Logger.info('[CheckAvailability] Filtros obtenidos del extractor', { filtersCount: structuredFilters.length });

    // 4) Configuración desde placeholder (con defaults)
    const cfgRaw = botConfig?.placeholders?.CONFIGURACION_DE_DISPONIBILIDADES;
    const cfgObj = (() => { try { return cfgRaw && typeof cfgRaw === 'string' ? JSON.parse(cfgRaw) : (cfgRaw || {}); } catch { return {}; } })() as Record<string, any>;
    const blockDays = Math.max(1, Number(cfgObj?.BLOQUE_DIAS ?? 5));
    const forwardMaxDays = Math.max(blockDays, Number(cfgObj?.ADELANTE_MAX_DIAS ?? 45));
    const maxOpciones = Math.max(1, Number(cfgObj?.MAX_OPCIONES ?? 3));

    Logger.info('[CheckAvailability] Configuración aplicada', { blockDays, forwardMaxDays, maxOpciones });

    const plannerOpts: PlannerOptions = { blockDays, forwardMaxDays };

    // 1) espacios_son_sedes
    const espaciosSedesRaw: string | undefined =
      botConfig?.placeholders?.LOS_ESPACIOS_SON_O_NO_SON_SEDES;
    const espaciosSonSedes =
      typeof espaciosSedesRaw === 'string'
        ? espaciosSedesRaw.trim().toLowerCase() === 'los espacios SÍ son sedes'
        : false;

    // 2) sedes_canonicas (acepta array directo o string separada por comas)
    const sedesCanonRaw: unknown = botConfig?.placeholders?.LISTA_DE_SEDES_DE_LA_CLINICA;
    const sedesCanonicas: string[] = Array.isArray(sedesCanonRaw)
      ? (sedesCanonRaw as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : (typeof sedesCanonRaw === 'string'
          ? sedesCanonRaw.split(',').map((s) => s.trim()).filter(Boolean)
          : []);

    // 3) Configuración final a inyectar a ambos asistentes
    const configuracion_disponibilidades = `
      ${botConfig?.placeholders?.CONFIGURACION_DE_DISPONIBILIDADES || ""}

      espacios_son_sedes: ${espaciosSonSedes},
      sedes_canonicas: ${espaciosSonSedes ? sedesCanonicas : 'No mostrar los nombres de los espacios porque no son sedes canónicas'},
    `;

    Logger.info('[CheckAvailability] Placeholders de sedes derivados', {
      espaciosSonSedes,
      sedesCanonicasCount: sedesCanonicas.length,
    });

    // 5) Recorrido de STEPS con acumulación GLOBAL (0–maxOpciones)
    let globalSlots: SlotDisponibilidad[] = [];
    let blocksConsultados: Block[] = [];

    const addSlots = (slots: SlotDisponibilidad[]) => {
      for (const s of slots) {
        const key = this.slotKey(s);
        if (!globalSlots.some((x) => this.slotKey(x) === key)) {
          globalSlots.push(s);
          Logger.info('[CheckAvailability] Nuevo horario agregado', { horario: key, totalAcumulados: globalSlots.length });
          if (globalSlots.length >= maxOpciones) {
            Logger.info('[CheckAvailability] Corte temprano alcanzado (maxOpciones)', { maxOpciones });
            return; // corte temprano global
          }
        }
      }
    };

    for (const filter of structuredFilters) {
      Logger.info('[CheckAvailability] Procesando filter del extractor', { tratamientos: filter.tratamientos, medicos: filter.medicos, espacios: filter.espacios, fechas: (filter.fechas || []).length });

      const steps: StepDefinition[] = [];
      const hasMedico = (filter.medicos || []).length > 0;

      steps.push({ tipo: 'original', filtros: { con_medico: hasMedico, rango_dias_extra: 0 }, params: { ...filter } });

      const firstFecha = filter.fechas?.[0]?.fecha;
      if (firstFecha) {
        const diffDias = Math.max(0, Math.floor((new Date(firstFecha).getTime() - tiempoActualDT.toJSDate().getTime()) / (1000 * 60 * 60 * 24)));
        steps.push({ tipo: 'intermedio_hasta_fecha', filtros: { con_medico: hasMedico, rango_dias_extra: 0, rango_dias_antes: diffDias }, params: { ...filter, rango_dias_antes: diffDias } });
      }

      steps.push({ tipo: 'ampliada_mismo_medico', filtros: { con_medico: hasMedico, rango_dias_extra: 45 }, params: { ...filter, rango_dias_extra: 45 } });
      steps.push({ tipo: 'ampliada_sin_medico_rango_dias_original', filtros: { con_medico: false, rango_dias_extra: 0 }, params: { ...filter, medicos: [] } });
      steps.push({ tipo: 'ampliada_sin_medico_rango_dias_extendido', filtros: { con_medico: false, rango_dias_extra: 45 }, params: { ...filter, medicos: [], rango_dias_extra: 45 } });

      // Anclas = INICIO de cada rango de fechas, ordenadas por cercanía al ahora
      const anchors = orderAnchorsByCloseness(pickAnchorsFromExtractorDates(filter.fechas || []), tiempoActualDT.toISODate()!);
      Logger.info('[CheckAvailability] Anclas calculadas para este filter', { anchors });

      for (const step of steps) {
        if (globalSlots.length >= maxOpciones) break;
        Logger.info('[CheckAvailability] Iniciando step', { tipo: step.tipo, filtros: step.filtros });

        for (const anchor of anchors) {
          if (globalSlots.length >= maxOpciones) break;
          Logger.info('[CheckAvailability] Evaluando ancla', { anchor });

          let blocks = planBlocksAroundAnchor(anchor, tiempoActualDT.toISODate()!, plannerOpts);
          if (step.tipo === 'intermedio_hasta_fecha') {
            blocks = blocks.filter((b) => b.direction === 'backward');
          }
          Logger.info('[CheckAvailability] Bloques generados', { totalBlocks: blocks.length, direction: step.tipo === 'intermedio_hasta_fecha' ? 'backward-only' : 'both' });

          for (const block of blocks) {
            if (globalSlots.length >= maxOpciones) break;
            Logger.info('[CheckAvailability] Explorando bloque', { start: block.start, end: block.end, direction: block.direction });

            const fechasBloque = expandRangeToFechas({ start: block.start, end: block.end });
            const availabilityRequest = { tratamientos: step.params.tratamientos || [], medicos: step.params.medicos || [], espacios: step.params.espacios || [], fechas: fechasBloque, id_clinica: botConfig.clinicId, tiempo_actual: tiempoActualDT.toISO() as string };
            Logger.info('[CheckAvailability] Consulta de disponibilidad construida', { fechasCount: fechasBloque.length, tratamientos: availabilityRequest.tratamientos, medicos: availabilityRequest.medicos, espacios: availabilityRequest.espacios });

            const baseResult = await this.availabilityService.getAppointmentAvailability(availabilityRequest);
            if (!baseResult.success || !Array.isArray(baseResult.analisis_agenda)) {
              Logger.warn('[CheckAvailability] Sin resultados en bloque', { start: block.start, end: block.end });
              continue;
            }

            Logger.info('[CheckAvailability] Resultados encontrados en bloque', { cantidad: baseResult.analisis_agenda.length });
            Logger.debug('[CheckAvailability] Resultados (analisis_agenda) encontrados en bloque', { analisis_agenda: baseResult.analisis_agenda });

            // Presentador por bloque/ancla (aplica reglas de minutos, tope por día, etc.)
            const presenterOpenAI = (this.availabilityRequestExtractorService as any)["openAIService"];
            const presenterResultPerBlock = await AvailabilityResponsePresenterService(
              presenterOpenAI,
              baseResult.analisis_agenda.map((s) => ({ ...s })),
              configuracion_disponibilidades,
            );
            const selectedByPresenter: SlotDisponibilidad[] = Array.isArray(presenterResultPerBlock?.disponibilidades)
              ? (presenterResultPerBlock.disponibilidades as SlotDisponibilidad[])
              : [];
            Logger.info('[CheckAvailability] Presentador por bloque: selección', { seleccionadas: selectedByPresenter.length, presentacionPreview: (presenterResultPerBlock?.presentacion || '').slice(0, 120) });

            const candidateSlots = selectedByPresenter.length ? selectedByPresenter : baseResult.analisis_agenda;
            const ordered = this.orderSlots(candidateSlots, anchor, tiempoActualDT.toISO()!);
            addSlots(ordered);
            blocksConsultados.push(block);

            if (globalSlots.length >= maxOpciones) break;
          }
        }
      }

      if (globalSlots.length >= maxOpciones) break;
    }

    // 6) Redacción final SIN pasar nuevamente por el presentador (evitamos re-filtrado global)
    const presenterOpenAI = (this.availabilityRequestExtractorService as any)["openAIService"];

    const finalSlots = this.orderSlots(globalSlots, tiempoActualDT.toISODate()!, tiempoActualDT.toISO()!).slice(0, maxOpciones);
    Logger.info('[CheckAvailability] Selección final de horarios (acumulador global, sin presentador final)', { finales: finalSlots.length });

    const redactorResult = await AvailabilityResponseRedactorService(
      presenterOpenAI,
      finalSlots,
      configuracion_disponibilidades,
      { ahoraISO: tiempoActualDT.toISO() as string, timezone }
    );
    Logger.info('[CheckAvailability] Texto final generado por redactor', { longitud: redactorResult.mensaje?.length || 0, preview: redactorResult.mensaje?.substring(0, 120) });

    // 7) DISCLAIMER de rangos explorados (colapsado)
    const disclaimerRanges = collapseBlocksToRanges(blocksConsultados);

    // 8) toolOutput final (incluye texto redactado)
    const toolOutput = `#consultaAgendar
    TIEMPO_LOCAL: ${localTimeForPrompts}
    DISCLAIMER_FECHAS_BUSCADAS: ${JSON.stringify(disclaimerRanges)}
    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: 'bloques', seleccion: finalSlots })}
    HORARIOS_TEXTO: ${JSON.stringify(redactorResult.mensaje)}
    MENSAJE_USUARIO: ${JSON.stringify(params)}
    `;

    Logger.info('[CheckAvailability] Ejecución completada con éxito', { leadId, acumulados: globalSlots.length, finales: finalSlots.length });
    return { success: true, toolOutput };
  }

  // =============================
  // Helpers
  // =============================
  private slotKey(s: any): string {
    // Normaliza a campos del dominio (preferimos los usados por AvailabilityDomainService)
    const f = s?.fecha_cita || s?.fecha_inicio || s?.fecha || '';
    const h = s?.hora_inicio_minima || s?.hora_inicio || s?.hora || '';
    const m = s?.id_medico || s?.medico?.id_medico || s?.medico || '';
    const e = s?.id_espacio || s?.espacio?.id_espacio || s?.espacio || '';
    return `${f}T${h}|${m}|${e}`;
  }

  private orderSlots(slots: SlotDisponibilidad[], anchorISO: string, nowISO: string): SlotDisponibilidad[] {
    const toMillis = (s: any): number => {
      const fecha = s?.fecha_cita || s?.fecha_inicio || s?.fecha;
      const hora = s?.hora_inicio_minima || s?.hora_inicio || s?.hora || '00:00:00';
      if (!fecha) return Number.MAX_SAFE_INTEGER;
      const iso = `${fecha}T${hora.length === 5 ? hora + ':00' : hora}.000Z`;
      return Date.parse(iso);
    };

    const anchorMillis = Date.parse(`${anchorISO}T00:00:00.000Z`);
    const nowMillis = Date.parse(nowISO);

    return [...slots].sort((a: any, b: any) => {
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