// packages/core/src/application/usecases/CheckAvailabilityUseCase.ts

import { z } from "zod";
import { DateTime } from "luxon";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";

import {
  AvailabilityDomainService,
  AgendaConfigCompilerService,
  AvailabilityRequestExtractorService,
  AvailabilityResponseRedactorService,
  SlotAccumulator,
} from "@clinickeys-agents/core/application/services";

import type { SlotDisponibilidad } from "@clinickeys-agents/core/domain/availability";

import type { ITratamientoRepository } from "@clinickeys-agents/core/domain/tratamiento";
import type { IMedicoRepository } from "@clinickeys-agents/core/domain/medico";
import type { IEspacioRepository } from "@clinickeys-agents/core/domain/espacio";

import type { BotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";
import { KommoCustomFieldValueBase } from "@clinickeys-agents/core/infrastructure/integrations/kommo";
import { getClinicLocalTimestamp } from "@clinickeys-agents/core/utils";
import type {
  ExtractorDateRange,
  ExtractorTimeWindow,
} from "@clinickeys-agents/core/application/services/types/Availability";

// Nueva estrategia (servicios utilitarios)
import { AvailabilityDateRankingService } from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityDateRankingService";
import {
  AvailabilityTimeDivisionsService,
  getDefaultDivisionsConfig,
  getDivisionRangeMap,
  normalizeDivisionKey,
} from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityTimeDivisionsService";
import { AvailabilitySearchCache } from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilitySearchCache";
import { buildIntentSignature } from "@clinickeys-agents/core/application/services/AvailabilityService";
import type { QueryContext } from "@clinickeys-agents/core/application/services/AvailabilityService/types/QueryContext";

import type {
  ISODate,
  DateRange,
  MinimalSlot,
} from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilitySearch";

import type { AvailabilitySearchInputKey } from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilitySearchCache";

// Helpers centralizados (ID-first ready)
import {
  buildAvailabilitySteps,
  executeAvailabilitySteps,
} from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityStepStrategy";

import type { BuildStepsInput } from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityStepStrategy";

// Tipos del servicio de divisiones
import type {
  DivisionConfig,
} from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityTimeDivisionsService";

// =============================
// Zod Schemas (firma de tool-calls)
// =============================
const CheckAvailabilitySchema = z.object({
  tratamiento: z.string(),
  medico: z.string().nullable().optional(),
  espacio: z.string().nullable().optional(),
  fechas: z.string(),
  horas: z.string(),
  rango_dias_extra: z.number().optional(),
  summary: z.string(),
});

// =============================
// Tipos del caso de uso
// =============================
interface CheckAvailabilityInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: unknown })[];
  params: z.infer<typeof CheckAvailabilitySchema>;
  timezone: string;
  tiempoActualDT: DateTime;
  subdomain: string;
  waitingMessageSentForLead?: Set<number>; // Track si ya se envió waiting message para este lead
}

interface CheckAvailabilityOutput {
  success: boolean;
  toolOutput: string;
  userMessageSent: boolean; // La tool ya envió mensaje al usuario (inicial + formateado)
}

type HHMM = `${string}:${string}`;
type TimeWindowEvaluator = (time: HHMM) => boolean;
type DateTimeWindowIndex = Map<ISODate, ExtractorTimeWindow[]>;
type DateWindowEvaluatorIndex = Map<ISODate, TimeWindowEvaluator[]>;

// =============================
// Implementación (ID-first)
// =============================
export class CheckAvailabilityUseCase {
  private cache: AvailabilitySearchCache;

  constructor(
    private readonly kommoService: any,
    private readonly availabilityService: AvailabilityDomainService,
    private readonly extractor: AvailabilityRequestExtractorService,
    private readonly tratamientoRepo: ITratamientoRepository,
    private readonly medicoRepo: IMedicoRepository,
    private readonly espacioRepo: IEspacioRepository,
  ) {
    this.cache = new AvailabilitySearchCache();
  }

  public async execute(input: CheckAvailabilityInput): Promise<CheckAvailabilityOutput> {
    const { botConfig, leadId, normalizedLeadCF, params, timezone, tiempoActualDT, waitingMessageSentForLead } = input;
    const localTimeForPrompts = getClinicLocalTimestamp(tiempoActualDT, timezone);

    // 1) Mensaje inicial (no bloqueante) - solo si no se envió ya para este lead
    const shouldSendWaitingMessage = !waitingMessageSentForLead?.has(leadId);
    if (shouldSendWaitingMessage) {
      try {
        await this.kommoService.sendBotInitialMessage({
          leadId,
          normalizedLeadCF,
          salesbotId: botConfig.kommo.salesbotId,
          message:
            "Muy bien, voy a mirar la agenda para ver las citas disponibles. Un momento, por favor.",
        });
        // Marcar que ya se envió el waiting message para este lead
        waitingMessageSentForLead?.add(leadId);
      } catch (err) {
        Logger.warn("[CheckAvailability] No se pudo enviar el mensaje inicial (continuando)", { err });
      }
    } else {
      Logger.info("[CheckAvailability] Waiting message ya enviado previamente para este lead, omitiendo", { leadId });
    }

    Logger.info("[CheckAvailability] Inicio (ID-first)", {
      clinicId: botConfig.clinicId,
      tratamiento: params.tratamiento,
      medico: params.medico,
      espacio: params.espacio,
      fechas: params.fechas,
      horas: params.horas,
      timezone,
      localTimeForPrompts,
    });

    // 2) Catálogos (solo para contextualizar extractor; el flujo es ID-first)
    const tratamientos = await this.tratamientoRepo.getActiveTreatmentsForClinic(
      botConfig.clinicId,
      botConfig.superClinicId,
    );
    const medicos = await this.medicoRepo.getMedicos(botConfig.clinicId, botConfig.superClinicId);
    const espacios = await this.espacioRepo.findByClinica(botConfig.clinicId);

    const catalogos = {
      tratamientosDisponibles: tratamientos.map(t => ({ id: t.id_tratamiento, nombre: t.nombre_tratamiento })),
      medicosDisponibles: medicos.map(m => ({ id: m.id_medico, nombre: m.nombre_completo })),
      espaciosDisponibles: espacios.map(e => ({ id: e.id_espacio, nombre: e.nombre })),
    };

    // 3) Extraer filtros (el extractor puede devolver { filters: [...] } o directamente un array)
    const extracted = await this.extractor.extract(
      JSON.stringify({
        tratamiento: params.tratamiento,
        medico: params.medico ?? undefined,
        espacio: params.espacio ?? undefined,
        fechas: params.fechas,
      }),
      {
        id_clinica: botConfig.clinicId,
        id_super_clinica: botConfig.superClinicId,
        tiempo_actual: tiempoActualDT.toISO() as string,
        localTimeForPrompts,
        tratamientosDisponibles: catalogos.tratamientosDisponibles,
        medicosDisponibles: catalogos.medicosDisponibles,
        espaciosDisponibles: catalogos.espaciosDisponibles,
      },
      { header: { DEFAULT_FORWARD_DAYS: 45 } },
    );

    // Admitimos ambos contratos: { filters: [...] } o [...] directo
    const filtersIds: BuildStepsInput["filter0"][] = extracted as BuildStepsInput["filter0"][];

    const filter0: BuildStepsInput["filter0"] | undefined = Array.isArray(filtersIds) && filtersIds.length
      ? filtersIds[0]
      : undefined;

    Logger.info("[CheckAvailability] Extractor output", {
      hasFilter: !!filter0,
      tratamiento_ids: filter0?.tratamiento_ids,
      medico_ids: filter0?.medico_ids,
      espacio_ids: filter0?.espacio_ids,
      date_ranges: filter0?.date_ranges,
      time_windows: Array.isArray(filter0?.date_ranges)
        ? filter0!.date_ranges.map((r) => ({
          start_date: r?.start_date,
          end_date: r?.end_date,
          time_windows: Array.isArray(r?.time_windows) ? r?.time_windows : [],
        }))
        : [],
    });

    if (!filter0 || !Array.isArray(filter0.date_ranges) || filter0.date_ranges.length === 0) {
      const aclaracion =
        "No he podido interpretar bien su solicitud para buscar horarios. ¿Podría reenviar su mensaje indicando el tratamiento y fechas aproximadas que prefiere?";

      const queryContext: QueryContext = {
        fechas_rankeadas: [],
        consultas_ejecutadas: [],
        fechas_entregadas_al_asistente: [],
        criterios: {
          base: "sin_ranking",
          preferencias_horarias: params.horas || "",
          interpretacion_maximo: "ultimo_inicio",
        },
        caducidad: {
          ttl_ms: 5 * 60 * 1000,
          generated_at_iso: tiempoActualDT.toISO() as string,
          timezone,
        },
        anchors: { today_iso: tiempoActualDT.toISODate() || undefined },
        coverage: {
          dates_consulted_count: 0,
          dates_with_results_count: 0,
          selected_days_count: 0,
        },
      };

      const toolOutput = `#consultaAgendar\n`
        + `    TIEMPO_LOCAL: ${localTimeForPrompts}\n`
        + `    QUERY_CONTEXT: ${JSON.stringify(queryContext)}\n`
        + `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: "fechas_rankeadas", horarios_escogidos: [] })}\n`
        + `    HORARIOS_TEXTO: ${JSON.stringify(aclaracion)}\n`
        + `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n`
        + `    `;

      Logger.warn("[CheckAvailability] Extractor sin filtros o sin date_ranges; devolviendo aclaración");
      return { success: true, toolOutput, userMessageSent: false };
    }

    const intentSignature = buildIntentSignature({
      tratamiento_ids: Array.isArray((filter0 as any).tratamiento_ids) ? (filter0 as any).tratamiento_ids : [],
      medico_ids: Array.isArray((filter0 as any).medico_ids) ? (filter0 as any).medico_ids : [],
      espacio_ids: Array.isArray((filter0 as any).espacio_ids) ? (filter0 as any).espacio_ids : [],
      fechas_texto: params.fechas,
      horas: params.horas,
      timezone,
    });

    const divisionConfig = getDefaultDivisionsConfig();
    const divisionRangeMap = getDivisionRangeMap(divisionConfig);

    const dateTimeWindowIndex = buildDateTimeWindowIndex(filter0.date_ranges || [], divisionConfig, divisionRangeMap);
    const dateWindowEvaluators = buildDateWindowEvaluators(dateTimeWindowIndex, divisionRangeMap);
    const timeWindowSummary = summarizeTimeWindows(dateTimeWindowIndex);
    const preferenceHints = derivePreferenceHints(dateTimeWindowIndex, params.horas);
    const preferenceHintsForServices = preferenceHints.length
      ? preferenceHints
      : params.horas
        ? [params.horas]
        : [];

    const weekdayPreferences = inferPreferredWeekdays(params.fechas);
    Logger.info("[CheckAvailability] Intent signature & weekday prefs", {
      intentSignature,
      weekdayPreferences,
      paramsFechas: params.fechas,
      time_windows_resolved: timeWindowSummary,
    });

    // 4) Plan de pasos (planner) – SOLO IDs
    const baseForward = Math.max(1, Math.floor(45 + (params.rango_dias_extra ?? 0)));
    const stepPlan = buildAvailabilitySteps({
      filter0,
      params,
      baseForwardDays: 45,
    });

    // 5) Ranking de fechas (usar el mismo filtro por IDs)
    const nowISO: ISODate = tiempoActualDT.toISODate() as ISODate;
    const rankingResult = AvailabilityDateRankingService.fromExtractorFilters({
      filters: [filter0],
      nowISODate: nowISO,
      weekdaysPreferred: weekdayPreferences,
      forwardExtensionDays: baseForward,
    });

    const rankedDatesAll: ISODate[] = (rankingResult.orderedDates || []).map((r) =>
      typeof r === "string" ? r : (r as any).fecha,
    );

    Logger.info("[CheckAvailability] Ranking preparado", {
      intentSignature,
      rankingSize: rankedDatesAll.length,
      weekdayPreferred: weekdayPreferences.length > 0,
      horizonEnd: rankingResult.horizonEnd,
    });

    if (!rankedDatesAll.length) {
      const aclaracion =
        "No encontré días válidos para buscar. ¿Podemos intentar con un rango o fechas aproximadas (por ejemplo: este jueves o la semana del 10)?";

      const queryContext: QueryContext = {
        fechas_rankeadas: rankedDatesAll,
        consultas_ejecutadas: [],
        fechas_entregadas_al_asistente: [],
        criterios: {
          base: "sin_ranking_detectado",
          preferencias_horarias: resolveQueryContextPreferences(timeWindowSummary, preferenceHintsForServices, params.horas),
          interpretacion_maximo: "ultimo_inicio",
        },
        caducidad: {
          ttl_ms: 5 * 60 * 1000,
          generated_at_iso: tiempoActualDT.toISO() as string,
          timezone,
        },
        anchors: { today_iso: tiempoActualDT.toISODate() || undefined },
        coverage: {
          dates_consulted_count: 0,
          dates_with_results_count: 0,
          selected_days_count: 0,
        },
      };

      const toolOutput = `#consultaAgendar\n`
        + `    TIEMPO_LOCAL: ${localTimeForPrompts}\n`
        + `    QUERY_CONTEXT: ${JSON.stringify(queryContext)}\n`
        + `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: "fechas_rankeadas", horarios_escogidos: [] })}\n`
        + `    HORARIOS_TEXTO: ${JSON.stringify(aclaracion)}\n`
        + `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n`
        + `    `;

      Logger.warn("[CheckAvailability] Ranking devolvió 0 fechas");
      return { success: true, toolOutput, userMessageSent: false };
    }

    // 6) Divisiones horarias canónicas (DivisionConfig)

    // 7) Ejecutar STEPS (runner con caché + recorte de horizonte por step) – SOLO IDs
    const fechasConsultadas = new Set<ISODate>();
    const fechasConResultados = new Set<ISODate>();

    const presenterOpenAI = (this.extractor as any)["openAIService"]; // cliente ya inicializado

    const stepBatchSize = weekdayPreferences.length > 0 ? 7 : 21;

    const stepExec = await executeAvailabilitySteps(rankedDatesAll, stepPlan, async ({ step, fechasISO }) => {
      // Recortar por horizonte del step
      const maxDate = tiempoActualDT.plus({ days: step.forwardExtensionDays }).toISODate() as ISODate;
      const fechasFiltradas = (fechasISO || []).filter((d) => d <= maxDate);

      for (const f of fechasFiltradas) fechasConsultadas.add(f);

      // Agrupar fechas contiguas y consultar por bloques
      const ranges = groupContiguousDates(fechasFiltradas);
      const analisis_acumulado: SlotDisponibilidad[] = [];

      for (const r of ranges) {
        const fechasBloque = expandRangeToFechas(r);
        Logger.info("[CheckAvailability] Consultando bloque", {
          step: step.label,
          range: r,
          fechas: fechasBloque.map((f) => f.fecha),
        });

        // IDs del step
        const stepMedicoIds: number[] = Array.isArray((step as unknown as { medico_ids?: number[] }).medico_ids)
          ? ((step as unknown as { medico_ids: number[] }).medico_ids)
          : [];
        const stepEspacioIds: number[] = Array.isArray((step as unknown as { espacio_ids?: number[] }).espacio_ids)
          ? ((step as unknown as { espacio_ids: number[] }).espacio_ids)
          : [];

        // Clave de caché por IDs
        const cacheKey: AvailabilitySearchInputKey = {
          id_clinica: botConfig.clinicId,
          tratamiento_ids: filter0.tratamiento_ids,
          medico_ids: stepMedicoIds,
          espacio_ids: stepEspacioIds,
          fechas: fechasBloque.map((f) => f.fecha),
          intent_signature: intentSignature,
        };

        const { value, status } = await this.cache.getOrSet(cacheKey, async () => {
          const availabilityRequest = {
            tratamiento_ids: filter0.tratamiento_ids,
            medico_ids: stepMedicoIds,
            espacio_ids: stepEspacioIds,
            fechas: fechasBloque,
            id_clinica: botConfig.clinicId,
            tiempo_actual: tiempoActualDT.toISO() as string,
          };

          const baseResult = await this.availabilityService.getAppointmentAvailability(availabilityRequest);
          const analisis_agenda: SlotDisponibilidad[] = baseResult.success && Array.isArray(baseResult.analisis_agenda)
            ? baseResult.analisis_agenda
            : [];
          return { analisis_agenda, fetchedAtISO: new Date().toISOString(), ttlMs: 5 * 60 * 1000 };
        });

        if (status === "hit") Logger.info("[CheckAvailability] Cache HIT", { range: r, count: value.analisis_agenda.length });

        const analisis_local_raw = Array.isArray(value?.analisis_agenda)
          ? (value.analisis_agenda as SlotDisponibilidad[])
          : [];
        const { filtered: analisis_local, reductions } = applyTimeWindowsToSlots(
          analisis_local_raw,
          dateWindowEvaluators,
        );
        Logger.info("[CheckAvailability] Dominio consultado", {
          range: r,
          count_total: analisis_local_raw.length,
          count_filtrado: analisis_local.length,
        });
        for (const info of reductions) {
          Logger.info("[CheckAvailability] Slots filtrados por ventana", {
            fecha: info.date,
            antes: info.before,
            despues: info.after,
          });
        }
        if (!analisis_local.length) continue;

        analisis_acumulado.push(...analisis_local);
        for (const it of analisis_local) {
          const d = String(it?.fecha_cita || "").slice(0, 10) as ISODate;
          if (d) fechasConResultados.add(d);
        }
      }

      return { analisis_agenda: analisis_acumulado };
    }, { batchSize: stepBatchSize });

    const analisisTotal = stepExec.analisis_agenda as SlotDisponibilidad[];
    const datesConsultedRanges = collapseDatesToRanges(Array.from(fechasConsultadas)).map((r) => ({ start: r.start, end: r.end }));

    // 8) Si no hubo resultados en ningún step → respuesta sin disponibilidad
    if (!analisisTotal.length) {
      const policyEmpty = await AgendaConfigCompilerService(
        presenterOpenAI,
        botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || "",
        [],
        {
          preferencias_usuario: { horas_preferencia_usuario: preferenceHintsForServices },
          presentacion_override: { mostrar_medicos: "auto" },
          limites_override: { tope_global: 999, tope_por_dia: 999, tope_dias: 99 },
        },
      );

      const queryContext: QueryContext = {
        fechas_rankeadas: rankedDatesAll,
        consultas_ejecutadas: datesConsultedRanges,
        fechas_entregadas_al_asistente: [],
        criterios: {
          base: "fechas_rankeadas (weekday-preferred si aplica) → ascendente; cobertura por divisions",
          preferencias_horarias: resolveQueryContextPreferences(timeWindowSummary, preferenceHintsForServices, params.horas),
          interpretacion_maximo: policyEmpty?.interpretacion_maximo ?? "ultimo_inicio",
        },
        caducidad: {
          ttl_ms: 5 * 60 * 1000,
          generated_at_iso: tiempoActualDT.toISO() as string,
          timezone,
        },
        anchors: { today_iso: tiempoActualDT.toISODate() || undefined },
        coverage: {
          dates_consulted_count: fechasConsultadas.size,
          dates_with_results_count: fechasConResultados.size,
          selected_days_count: 0,
        },
      };

      const redactorVacio = await AvailabilityResponseRedactorService(
        presenterOpenAI,
        [],
        { policy: policyEmpty },
        {
          ahoraISO: tiempoActualDT.toISO() as string,
          timezone,
          contextoRedactor: {
            tipo_busqueda: "fechas_rankeadas",
            query_context: queryContext,
            dias_mostrados: [],
            horas_preferencia_usuario: preferenceHintsForServices.join(", "),
          },
        },
      );

      const toolOutput = `#consultaAgendar\n`
        + `    TIEMPO_LOCAL: ${localTimeForPrompts}\n`
        + `    QUERY_CONTEXT: ${JSON.stringify(queryContext)}\n`
        + `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: "fechas_rankeadas", horarios_escogidos: [] })}\n`
        + `    HORARIOS_TEXTO: ${JSON.stringify(redactorVacio.mensaje)}\n`
        + `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n`
        + `    `;

      Logger.info("[CheckAvailability] Sin disponibilidad en todos los steps", {
        telemetry: stepExec.telemetry,
        consultedDates: fechasConsultadas.size,
        intentSignature,
        rankingSize: rankedDatesAll.length,
        weekdayPreferred: weekdayPreferences.length > 0,
        fechasEntregadasAlAsistente: [] as ISODate[],
        timeWindows: timeWindowSummary,
      });

      return { success: true, toolOutput, userMessageSent: false };
    }

    // 9) Política global para selección y redacción
    const policyForAll = await AgendaConfigCompilerService(
      presenterOpenAI,
      botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || "",
      analisisTotal,
      {
        preferencias_usuario: { horas_preferencia_usuario: params.horas ? [params.horas] : [] },
        presentacion_override: { mostrar_medicos: "auto" },
        limites_override: { tope_global: 999, tope_por_dia: 999, tope_dias: 99 },
      },
    );

    const queryContextForAccumulator: QueryContext = {
      fechas_rankeadas: rankedDatesAll,
      consultas_ejecutadas: datesConsultedRanges,
      fechas_entregadas_al_asistente: [],
      criterios: {
        base: "fechas_rankeadas (weekday-preferred si aplica) → ascendente; cobertura por divisions",
        preferencias_horarias: resolveQueryContextPreferences(timeWindowSummary, preferenceHintsForServices, params.horas),
        interpretacion_maximo: policyForAll?.interpretacion_maximo ?? "ultimo_inicio",
      },
      caducidad: {
        ttl_ms: 5 * 60 * 1000,
        generated_at_iso: tiempoActualDT.toISO() as string,
        timezone,
      },
      anchors: { today_iso: tiempoActualDT.toISODate() || undefined },
      coverage: {
        dates_consulted_count: fechasConsultadas.size,
        dates_with_results_count: fechasConResultados.size,
        selected_days_count: 0,
      },
    };

    // 10) Acumulador/selector (no necesita filtros por nombre)
    const accOut = await SlotAccumulator({
      policy: policyForAll,
      filters: filter0 ? [filter0] : [],
      windows: analisisTotal,
      contexto: {
        horas_preferencia_usuario: preferenceHintsForServices,
        ahoraISO: tiempoActualDT.toISO() as string,
        timezone,
        weekday_preferences: weekdayPreferences,
        query_context: queryContextForAccumulator,
      },
    });

    const rankingPosition = new Map<ISODate, number>();
    rankedDatesAll.forEach((date, idx) => {
      if (!rankingPosition.has(date as ISODate)) rankingPosition.set(date as ISODate, idx);
    });

    const selectedDaysRaw: ISODate[] = Array.isArray(accOut?.dias_mostrados)
      ? (accOut!.dias_mostrados as ISODate[])
      : [];
    const selectedSlotsRaw: MinimalSlot[] = Array.isArray(accOut?.opciones_top10)
      ? (accOut!.opciones_top10 as MinimalSlot[])
      : [];

    const selectedDaysUnique = Array.from(new Set(selectedDaysRaw));
    const selectedDaysSet = new Set(selectedDaysUnique);
    const selectedSlots: MinimalSlot[] = selectedSlotsRaw.slice().sort(slotChronoCmp);
    const selectedSlotsFull: MinimalSlot[] = analisisTotal
      .filter((s) => selectedDaysSet.has((s.fecha_cita || "") as ISODate))
      .map((s) => slotDisponibilidadToMinimalSlot(s))
      .sort((a, b) => {
        const pa = rankingPosition.get(a.fecha_cita as ISODate) ?? Number.MAX_SAFE_INTEGER;
        const pb = rankingPosition.get(b.fecha_cita as ISODate) ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return slotChronoCmp(a, b);
      });

    for (const d of selectedDaysUnique) {
      const expected = analisisTotal.filter((s) => (s.fecha_cita || "").slice(0, 10) === d).length;
      const got = selectedSlotsFull.filter((s) => s.fecha_cita === d).length;
      if (expected !== got) {
        Logger.warn("[CheckAvailability] Invariante violado: faltan slots del día", { d, expected, got });
      }
    }

    // 12) Redactor final
    const finalPolicy = await AgendaConfigCompilerService(
      presenterOpenAI,
      botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || "",
      analisisTotal,
      {
        preferencias_usuario: { horas_preferencia_usuario: preferenceHintsForServices },
        presentacion_override: { mostrar_medicos: "auto" },
        limites_override: { tope_global: 999, tope_por_dia: 999, tope_dias: 99 },
      },
    );

    const queryContext: QueryContext = {
      fechas_rankeadas: rankedDatesAll,
      consultas_ejecutadas: datesConsultedRanges,
      fechas_entregadas_al_asistente: selectedDaysUnique,
      criterios: {
        base: "fechas_rankeadas (weekday-preferred si aplica) → ascendente; cobertura por divisions",
        preferencias_horarias: resolveQueryContextPreferences(timeWindowSummary, preferenceHintsForServices, params.horas),
        interpretacion_maximo: finalPolicy?.interpretacion_maximo ?? "ultimo_inicio",
      },
      caducidad: {
        ttl_ms: 5 * 60 * 1000,
        generated_at_iso: tiempoActualDT.toISO() as string,
        timezone,
      },
      anchors: { today_iso: tiempoActualDT.toISODate() || undefined },
      coverage: {
        dates_consulted_count: fechasConsultadas.size,
        dates_with_results_count: fechasConResultados.size,
        selected_days_count: selectedDaysUnique.length,
      },
    };

    const redactor = await AvailabilityResponseRedactorService(
      presenterOpenAI,
      selectedSlots.sort(slotChronoCmp),
      { policy: finalPolicy },
      {
        ahoraISO: tiempoActualDT.toISO() as string,
        timezone,
        contextoRedactor: {
          tipo_busqueda: "fechas_rankeadas",
          query_context: queryContext,
          dias_mostrados: selectedDaysUnique,
          horas_preferencia_usuario: preferenceHintsForServices.join(", "),
          weekday_preferences: weekdayPreferences,
        },
      },
    );

    Logger.info("[CheckAvailability] Dataset para asistente principal", {
      diasMostrados: selectedDaysUnique,
      slotsMostrados: selectedSlots.length,
      universoTotal: Array.isArray(accOut?.universo_opciones) ? (accOut!.universo_opciones as MinimalSlot[]).length : 0,
      fechasUniverso: Array.from(
        new Set(
          Array.isArray(accOut?.universo_opciones)
            ? (accOut!.universo_opciones as MinimalSlot[]).map((s) => s.fecha_cita)
            : [],
        ),
      ),
    });

    // 13) toolOutput final (idempotente)
    const toolOutput = `#consultaAgendar\n`
      + `    TIEMPO_LOCAL: ${localTimeForPrompts}\n`
      + `    QUERY_CONTEXT: ${JSON.stringify(queryContext)}\n`
      + `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: "fechas_rankeadas", horarios_escogidos: selectedSlotsFull })}\n`
      + `    HORARIOS_TEXTO: ${JSON.stringify(redactor.mensaje)}\n`
      + `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n`
      + `    `;

    Logger.info("[CheckAvailability] Completado (steps / ID-first)", {
      leadId,
      diasMostrados: selectedDaysUnique.length,
      slots: selectedSlots.length,
      slotsFull: selectedSlotsFull.length,
      consultedDates: fechasConsultadas.size,
      datesWithResults: fechasConResultados.size,
      horizonEnd: rankingResult.horizonEnd,
      stepsTelemetry: stepExec.telemetry,
      intentSignature,
      rankingSize: rankedDatesAll.length,
      weekdayPreferred: weekdayPreferences.length > 0,
      fechasEntregadasAlAsistente: selectedDaysUnique,
      timeWindows: timeWindowSummary,
    });

    return { success: true, toolOutput, userMessageSent: true };
  }
}

// =============================
// Helpers para ventanas horarias
// =============================
function buildDateTimeWindowIndex(
  ranges: ExtractorDateRange[],
  divisionConfig: DivisionConfig[],
  divisionRangeMap: Map<string, { start: HHMM; end: HHMM }>,
): DateTimeWindowIndex {
  const index: DateTimeWindowIndex = new Map();
  for (const range of ranges || []) {
    const start = normalizeISODateString(range?.start_date);
    const end = normalizeISODateString(range?.end_date ?? range?.start_date);
    if (!start || !end) continue;

    const normalizedWindows = normalizeExtractorWindows(range?.time_windows, divisionConfig, divisionRangeMap);
    const dates = expandRangeToFechas({ start, end });

    if (normalizedWindows === null) {
      for (const item of dates) {
        index.delete(item.fecha);
      }
      continue;
    }

    if (!normalizedWindows || !normalizedWindows.length) continue;

    for (const item of dates) {
      const day = item.fecha;
      if (!index.has(day)) index.set(day, []);
      index.get(day)!.push(...normalizedWindows.map((w) => ({ ...w })));
    }
  }
  return index;
}

function normalizeISODateString(raw: string | undefined | null): ISODate | null {
  const base = String(raw || "").slice(0, 10);
  if (!base) return null;
  const dt = DateTime.fromISO(base, { zone: "utc" });
  if (!dt.isValid) return null;
  return dt.toISODate() as ISODate;
}

function normalizeExtractorWindows(
  windows: ExtractorTimeWindow[] | null | undefined,
  divisionConfig: DivisionConfig[],
  divisionRangeMap: Map<string, { start: HHMM; end: HHMM }>,
): ExtractorTimeWindow[] | null | undefined {
  if (!Array.isArray(windows) || !windows.length) return undefined;

  const normalized: ExtractorTimeWindow[] = [];
  for (const raw of windows) {
    if (!raw || typeof raw !== "object") continue;
    switch (raw.type) {
      case "any":
        return null; // sin restricciones explícitas
      case "labels": {
        const labels = Array.isArray(raw.labels)
          ? raw.labels
            .map((label) => normalizeDivisionKey(label, divisionConfig))
            .filter((label): label is string => typeof label === "string" && label.trim().length > 0 && divisionRangeMap.has(label))
          : [];
        if (!labels.length) continue;
        normalized.push({ type: "labels", labels });
        break;
      }
      case "after":
        normalized.push({ type: "after", time: raw.time, inclusive: raw.inclusive });
        break;
      case "before":
        normalized.push({ type: "before", time: raw.time, inclusive: raw.inclusive });
        break;
      case "between":
        normalized.push({
          type: "between",
          start: raw.start,
          end: raw.end,
          inclusive_start: raw.inclusive_start,
          inclusive_end: raw.inclusive_end,
        });
        break;
      case "exact":
        normalized.push({ type: "exact", time: raw.time });
        break;
      default:
        break;
    }
  }

  return normalized.length ? normalized : undefined;
}

function buildDateWindowEvaluators(
  index: DateTimeWindowIndex,
  divisionRangeMap: Map<string, { start: HHMM; end: HHMM }>,
): DateWindowEvaluatorIndex {
  const evaluators: DateWindowEvaluatorIndex = new Map();
  for (const [date, windows] of index.entries()) {
    const compiled: TimeWindowEvaluator[] = [];
    for (const window of windows) {
      const evaluator = createWindowEvaluator(window, divisionRangeMap);
      if (!evaluator) continue;
      compiled.push(evaluator);
    }
    if (compiled.length) evaluators.set(date, compiled);
  }
  return evaluators;
}

function createWindowEvaluator(
  window: ExtractorTimeWindow,
  divisionRangeMap: Map<string, { start: HHMM; end: HHMM }>,
): TimeWindowEvaluator | null {
  switch (window.type) {
    case "labels": {
      const ranges = window.labels
        .map((label) => divisionRangeMap.get(label))
        .filter((range): range is { start: HHMM; end: HHMM } => !!range);
      if (!ranges.length) return null;
      return (time) => ranges.some((range) => isWithinRange(time, range.start, range.end, true, true));
    }
    case "after": {
      const inclusive = window.inclusive !== false;
      return (time) =>
        inclusive ? compareHHMM(time as HHMM, window.time as HHMM) >= 0 : compareHHMM(time as HHMM, window.time as HHMM) > 0;
    }
    case "before": {
      const inclusive = window.inclusive !== false;
      return (time) =>
        inclusive ? compareHHMM(time as HHMM, window.time as HHMM) <= 0 : compareHHMM(time as HHMM, window.time as HHMM) < 0;
    }
    case "between": {
      const inclusiveStart = window.inclusive_start !== false;
      const inclusiveEnd = window.inclusive_end !== false;
      const start = window.start as HHMM;
      const end = window.end as HHMM;
      if (compareHHMM(start, end) > 0) {
        return (time) =>
          isWithinRange(time, end, start, inclusiveStart, inclusiveEnd);
      }
      return (time) => isWithinRange(time, start, end, inclusiveStart, inclusiveEnd);
    }
    case "exact":
      return (time) => compareHHMM(time as HHMM, window.time as HHMM) === 0;
    default:
      return null;
  }
}

function compareHHMM(a: HHMM, b: HHMM): number {
  return hhmmToMinutesStrict(a) - hhmmToMinutesStrict(b);
}

function hhmmToMinutesStrict(hhmm: HHMM): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

function isWithinRange(time: HHMM, start: HHMM, end: HHMM, inclusiveStart: boolean, inclusiveEnd: boolean): boolean {
  const value = hhmmToMinutesStrict(time);
  const startValue = hhmmToMinutesStrict(start);
  const endValue = hhmmToMinutesStrict(end);
  const meetsStart = inclusiveStart ? value >= startValue : value > startValue;
  const meetsEnd = inclusiveEnd ? value <= endValue : value < endValue;
  return meetsStart && meetsEnd;
}

function applyTimeWindowsToSlots(
  slots: SlotDisponibilidad[],
  evaluators: DateWindowEvaluatorIndex,
): { filtered: SlotDisponibilidad[]; reductions: Array<{ date: ISODate; before: number; after: number }> } {
  if (!Array.isArray(slots) || !slots.length || evaluators.size === 0) {
    return { filtered: slots || [], reductions: [] };
  }

  const filtered: SlotDisponibilidad[] = [];
  const stats = new Map<ISODate, { before: number; after: number }>();

  for (const slot of slots) {
    const date = String(slot?.fecha_cita || "").slice(0, 10) as ISODate;
    if (!date) continue;
    const entry = stats.get(date) || { before: 0, after: 0 };
    entry.before += 1;

    let hhmm: HHMM | null = null;
    try {
      hhmm = toHHMMFromDomain(slot.hora_inicio_minima);
    } catch (err) {
      hhmm = null;
    }

    const allowed = slotMatchesEvaluators(date, hhmm, evaluators);
    if (allowed) {
      entry.after += 1;
      filtered.push(slot);
    }

    stats.set(date, entry);
  }

  const reductions: Array<{ date: ISODate; before: number; after: number }> = [];
  for (const [date, entry] of stats.entries()) {
    if (entry.after < entry.before) reductions.push({ date, before: entry.before, after: entry.after });
  }

  return { filtered, reductions };
}

function slotMatchesEvaluators(date: ISODate, hhmm: HHMM | null, evaluators: DateWindowEvaluatorIndex): boolean {
  if (!evaluators.size) return true;
  const compiled = evaluators.get(date);
  if (!compiled || !compiled.length) return true;
  if (!hhmm) return true;
  return compiled.some((fn) => fn(hhmm!));
}

function derivePreferenceHints(index: DateTimeWindowIndex, fallback?: string | null): string[] {
  const hints = new Set<string>();
  for (const windows of index.values()) {
    for (const window of windows) {
      switch (window.type) {
        case "labels":
          for (const label of window.labels) {
            if (label) hints.add(label);
          }
          break;
        case "after":
        case "before":
        case "exact":
          hints.add(window.time);
          break;
        case "between":
          hints.add(window.start);
          hints.add(window.end);
          break;
        default:
          break;
      }
    }
  }
  if (fallback && fallback.trim()) hints.add(fallback.trim());
  return Array.from(hints);
}

function summarizeTimeWindows(index: DateTimeWindowIndex): string[] {
  if (!index.size) return [];
  const entries = Array.from(index.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: string[] = [];
  for (const [date, windows] of entries) {
    const parts = windows
      .map((w) => describeExtractorWindow(w))
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    if (!parts.length) continue;
    out.push(`${date}: ${parts.join(" OR ")}`);
  }
  return out;
}

function describeExtractorWindow(window: ExtractorTimeWindow): string | null {
  switch (window.type) {
    case "labels":
      return window.labels.join("/");
    case "after":
      return `${window.inclusive === false ? ">" : ">="}${window.time}`;
    case "before":
      return `${window.inclusive === false ? "<" : "<="}${window.time}`;
    case "between": {
      const start = window.start;
      const end = window.end;
      const openStart = window.inclusive_start === false ? "(" : "[";
      const openEnd = window.inclusive_end === false ? ")" : "]";
      return `${openStart}${start}, ${end}${openEnd}`;
    }
    case "exact":
      return `=${window.time}`;
    default:
      return null;
  }
}

function resolveQueryContextPreferences(
  summary: string[],
  hints: string[],
  fallback?: string | null,
): string | string[] {
  if (Array.isArray(summary) && summary.length) return summary;
  if (Array.isArray(hints) && hints.length) return hints;
  return fallback && fallback.length ? fallback : "";
}

// =============================
// Helpers locales (idénticos en espíritu, ID-agnósticos)
// =============================
function groupContiguousDates(dates: ISODate[]): DateRange[] {
  if (!dates.length) return [];

  const uniqueInOrder: ISODate[] = [];
  const seen = new Set<string>();
  for (const raw of dates) {
    const iso = String(raw || "").slice(0, 10) as ISODate;
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    uniqueInOrder.push(iso);
  }
  if (!uniqueInOrder.length) return [];

  const ranges: DateRange[] = [];
  let rangeStart = uniqueInOrder[0];
  let rangeEnd = uniqueInOrder[0];

  for (let i = 1; i < uniqueInOrder.length; i++) {
    const current = uniqueInOrder[i];
    const prevDT = DateTime.fromISO(rangeEnd, { zone: "utc" }).startOf("day");
    const currentDT = DateTime.fromISO(current, { zone: "utc" }).startOf("day");
    const diff = currentDT.diff(prevDT, "days").days;

    if (diff === 1) {
      rangeEnd = current;
      continue;
    }

    // Cerrar rango actual
    ranges.push(normalizeRange(rangeStart, rangeEnd));
    rangeStart = current;
    rangeEnd = current;
  }

  ranges.push(normalizeRange(rangeStart, rangeEnd));
  return ranges;
}

function expandRangeToFechas(range: DateRange): { fecha: ISODate }[] {
  const out: { fecha: ISODate }[] = [];
  let d = DateTime.fromISO(range.start, { zone: "utc" }).startOf("day");
  const end = DateTime.fromISO(range.end, { zone: "utc" }).startOf("day");
  while (d <= end) {
    out.push({ fecha: d.toISODate() as ISODate });
    d = d.plus({ days: 1 });
  }
  return out;
}

function addDays(date: ISODate, n: number): ISODate {
  return (DateTime.fromISO(date, { zone: "utc" }).plus({ days: n }).toISODate() || date) as ISODate;
}

function collapseDatesToRanges(dates: ISODate[]): DateRange[] {
  return groupContiguousDates(dates);
}

function slotChronoCmp(a: MinimalSlot, b: MinimalSlot): number {
  if (a.fecha_cita !== b.fecha_cita) return a.fecha_cita < b.fecha_cita ? -1 : 1;
  if (a.hora_inicio !== b.hora_inicio) return a.hora_inicio < b.hora_inicio ? -1 : 1;
  const ae = String(a.id_espacio ?? "");
  const be = String(b.id_espacio ?? "");
  if (ae !== be) return ae < be ? -1 : 1;
  return 0;
}

const WEEKDAY_KEYWORD_TO_ISO: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sabados: 6,
  domingo: 7,
  domingos: 7,
};

const WEEKDAY_REGEX = /(lunes|martes|miercoles|jueves|viernes|sabado|sabados|domingo|domingos)/g;

function inferPreferredWeekdays(text: string): number[] {
  const normalized = removeAccents(text || "").toLowerCase();
  if (!normalized.trim()) return [];
  const matches = normalized.match(WEEKDAY_REGEX) || [];
  const out = new Set<number>();
  for (const token of matches) {
    const iso = WEEKDAY_KEYWORD_TO_ISO[token] ?? WEEKDAY_KEYWORD_TO_ISO[token.replace(/s$/, "")];
    if (iso) out.add(iso);
  }
  if (normalized.includes("fin de semana") || normalized.includes("fin semana")) {
    out.add(6);
    out.add(7);
  }
  return Array.from(out).sort((a, b) => a - b);
}

function removeAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function asHHMM(value: string): `${string}:${string}` {
  if (!HHMM_RE.test(value)) throw new Error(`Hora inválida: ${value}`);
  return value as `${string}:${string}`;
}

function toHHMMFromDomain(value: string): `${string}:${string}` {
  const base = String(value || "").slice(0, 5);
  return asHHMM(base);
}

function slotDisponibilidadToMinimalSlot(slot: SlotDisponibilidad): MinimalSlot {
  const horaInicio = toHHMMFromDomain(slot.hora_inicio_minima);
  const duracion = Number(slot.duracion_tratamiento ?? 0);

  return {
    fecha_cita: slot.fecha_cita as ISODate,
    fecha_legible: slot.fecha_legible ?? null,
    hora_inicio: horaInicio,
    id_medico: typeof slot.id_medico === "number" ? slot.id_medico : null,
    nombre_medico: slot.nombre_medico ?? null,
    id_espacio: typeof slot.id_espacio === "number" ? slot.id_espacio : null,
    nombre_espacio: slot.nombre_espacio ?? null,
    id_tratamiento: typeof slot.id_tratamiento === "number" ? slot.id_tratamiento : null,
    nombre_tratamiento: slot.nombre_tratamiento ?? null,
    duracion_tratamiento: duracion || null,
  };
}

function normalizeRange(start: ISODate, end: ISODate): DateRange {
  const startDT = DateTime.fromISO(start, { zone: "utc" }).startOf("day");
  const endDT = DateTime.fromISO(end, { zone: "utc" }).startOf("day");
  if (startDT <= endDT) return { start, end };
  return { start: end, end: start };
}

export default CheckAvailabilityUseCase;
