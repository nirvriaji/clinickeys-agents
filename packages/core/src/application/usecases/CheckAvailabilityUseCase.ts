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

// Nueva estrategia (servicios utilitarios)
import { AvailabilityDateRankingService } from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityDateRankingService";
import { AvailabilityTimeDivisionsService } from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityTimeDivisionsService";
import { AvailabilitySearchCache } from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilitySearchCache";

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
  DaySlot,
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
}

interface CheckAvailabilityOutput {
  success: boolean;
  toolOutput: string;
}

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
    const { botConfig, leadId, normalizedLeadCF, params, timezone, tiempoActualDT } = input;
    const localTimeForPrompts = getClinicLocalTimestamp(tiempoActualDT, timezone);

    // 1) Mensaje inicial (no bloqueante)
    try {
      await this.kommoService.sendBotInitialMessage({
        leadId,
        normalizedLeadCF,
        salesbotId: botConfig.kommo.salesbotId,
        message:
          "Muy bien, voy a mirar la agenda para ver las citas disponibles. Un momento, por favor.",
      });
    } catch (err) {
      Logger.warn("[CheckAvailability] No se pudo enviar el mensaje inicial (continuando)", { err });
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

    if (!filter0 || !Array.isArray(filter0.date_ranges) || filter0.date_ranges.length === 0) {
      const aclaracion =
        "No he podido interpretar bien su solicitud para buscar horarios. ¿Podría reenviar su mensaje indicando el tratamiento y fechas aproximadas que prefiere?";

      const toolOutput = `#consultaAgendar\n`
        + `    TIEMPO_LOCAL: ${localTimeForPrompts}\n`
        + `    DISCLAIMER_FECHAS_BUSCADAS: []\n`
        + `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: "fechas_rankeadas", horarios_escogidos: [] })}\n`
        + `    HORARIOS_TEXTO: ${JSON.stringify(aclaracion)}\n`
        + `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n`
        + `    `;

      Logger.warn("[CheckAvailability] Extractor sin filtros o sin date_ranges; devolviendo aclaración");
      return { success: true, toolOutput };
    }

    // 4) Plan de pasos (planner) – SOLO IDs
    const baseForward = Math.max(1, Math.floor(45 + (params.rango_dias_extra ?? 0)));
    const stepPlan = buildAvailabilitySteps({
      filter0,
      params,
      baseForwardDays: 45,
    });

    // 5) Ranking de fechas (usar el mismo filtro por IDs)
    const nowISO: ISODate = tiempoActualDT.toISODate() as ISODate;
    const globalRanking = AvailabilityDateRankingService.fromExtractorFilters({
      filters: [filter0],
      nowISODate: nowISO,
      weekdaysPreferred: [],
      forwardExtensionDays: baseForward,
    });

    const rankedDatesAll: ISODate[] = (globalRanking.orderedDates || []).map((r) => (typeof r === "string" ? r : (r as any).fecha));

    if (!rankedDatesAll.length) {
      const aclaracion =
        "No encontré días válidos para buscar. ¿Podemos intentar con un rango o fechas aproximadas (por ejemplo: este jueves o la semana del 10)?";

      const toolOutput = `#consultaAgendar\n`
        + `    TIEMPO_LOCAL: ${localTimeForPrompts}\n`
        + `    DISCLAIMER_FECHAS_BUSCADAS: []\n`
        + `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: "fechas_rankeadas", horarios_escogidos: [] })}\n`
        + `    HORARIOS_TEXTO: ${JSON.stringify(aclaracion)}\n`
        + `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n`
        + `    `;

      Logger.warn("[CheckAvailability] Ranking devolvió 0 fechas");
      return { success: true, toolOutput };
    }

    // 6) Divisiones horarias canónicas (DivisionConfig)
    const divisions: DivisionConfig[] = AvailabilityTimeDivisionsService.defaultConfig();

    // 7) Ejecutar STEPS (runner con caché + recorte de horizonte por step) – SOLO IDs
    const fechasConsultadas = new Set<ISODate>();
    const fechasConResultados = new Set<ISODate>();

    const presenterOpenAI = (this.extractor as any)["openAIService"]; // cliente ya inicializado

    const stepExec = await executeAvailabilitySteps(rankedDatesAll, stepPlan, async ({ step, fechasISO }) => {
      // Recortar por horizonte del step
      const maxDate = tiempoActualDT.plus({ days: step.forwardExtensionDays }).toISODate() as ISODate;
      const fechasFiltradas = (fechasISO || []).filter((d) => d <= maxDate);

      // Guardar para disclaimer
      for (const f of fechasFiltradas) fechasConsultadas.add(f);

      // Agrupar fechas contiguas y consultar por bloques
      const ranges = groupContiguousDates(fechasFiltradas);
      const analisis_acumulado: SlotDisponibilidad[] = [];

      for (const r of ranges) {
        const fechasBloque = expandRangeToFechas(r);

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
          Logger.info("[CheckAvailability] Dominio consultado", { range: r, count: analisis_agenda.length });
          return { analisis_agenda, fetchedAtISO: new Date().toISOString(), ttlMs: 5 * 60 * 1000 };
        });

        if (status === "hit") Logger.info("[CheckAvailability] Cache HIT", { range: r, count: value.analisis_agenda.length });

        const analisis_local = value.analisis_agenda as SlotDisponibilidad[];
        if (!analisis_local.length) continue;

        analisis_acumulado.push(...analisis_local);
        for (const it of analisis_local) {
          const d = String(it?.fecha_cita || "").slice(0, 10) as ISODate;
          if (d) fechasConResultados.add(d);
        }
      }

      return { analisis_agenda: analisis_acumulado };
    });

    const analisisTotal = stepExec.analisis_agenda as SlotDisponibilidad[];

    // 8) Si no hubo resultados en ningún step → respuesta sin disponibilidad
    if (!analisisTotal.length) {
      const disclaimerRanges = collapseDatesToRanges(Array.from(fechasConsultadas)).map((r) => ({ start: r.start, end: r.end }));

      const policyEmpty = await AgendaConfigCompilerService(
        presenterOpenAI,
        botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || "",
        [],
        {
          preferencias_usuario: { horas_preferencia_usuario: params.horas ? [params.horas] : [] },
          presentacion_override: { mostrar_medicos: "auto" },
          limites_override: { tope_global: 999, tope_por_dia: 999, tope_dias: 99 },
        },
      );

      const redactorVacio = await AvailabilityResponseRedactorService(
        presenterOpenAI,
        [],
        { policy: policyEmpty },
        {
          ahoraISO: tiempoActualDT.toISO() as string,
          timezone,
          contextoRedactor: {
            tipo_busqueda: "fechas_rankeadas",
            disclaimer_fechas: disclaimerRanges,
            dias_mostrados: [],
            horas_preferencia_usuario: params.horas || "",
          },
        },
      );

      const toolOutput = `#consultaAgendar\n`
        + `    TIEMPO_LOCAL: ${localTimeForPrompts}\n`
        + `    DISCLAIMER_FECHAS_BUSCADAS: ${JSON.stringify(disclaimerRanges)}\n`
        + `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: "fechas_rankeadas", horarios_escogidos: [] })}\n`
        + `    HORARIOS_TEXTO: ${JSON.stringify(redactorVacio.mensaje)}\n`
        + `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n`
        + `    `;

      Logger.info("[CheckAvailability] Sin disponibilidad en todos los steps", {
        telemetry: stepExec.telemetry,
        consultedDates: fechasConsultadas.size,
      });

      return { success: true, toolOutput };
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

    // 10) Acumulador/selector (no necesita filtros por nombre)
    const accOut = await SlotAccumulator({
      policy: policyForAll,
      filters: [],
      windows: analisisTotal,
      contexto: {
        horas_preferencia_usuario: params.horas ? [params.horas] : [],
        ahoraISO: tiempoActualDT.toISO() as string,
        timezone,
      },
    });

    const universoSlots: MinimalSlot[] = (accOut?.universo_opciones || []) as MinimalSlot[];

    // 11) Seleccionar días completos (todas las divisiones cubiertas) hasta 3 días, luego completar con parciales
    const daySlotsMap = new Map<ISODate, MinimalSlot[]>();
    for (const s of universoSlots) {
      const d = s.fecha_cita as ISODate;
      const list = daySlotsMap.get(d) || [];
      list.push(s);
      daySlotsMap.set(d, list);
    }

    const orderedDatesISO: ISODate[] = Array.from(new Set(universoSlots.map((s) => s.fecha_cita))).sort();

    const selectedDays: ISODate[] = [];
    const selectedSlots: MinimalSlot[] = [];

    for (const d of orderedDatesISO) {
      const slots = (daySlotsMap.get(d) || []).sort(slotChronoCmp);
      if (!slots.length) continue;
      const daySlots: DaySlot[] = slots.map(toDaySlot);
      const assignment = AvailabilityTimeDivisionsService.assignDay(d, daySlots, divisions);
      AvailabilityTimeDivisionsService.logCoverage(assignment);
      const isComplete = assignment.coverage.nonEmptyDivisions >= (divisions.length || 1);
      if (isComplete) {
        selectedDays.push(d);
        selectedSlots.push(...slots);
      }
      if (selectedDays.length >= 3) break;
    }

    if (selectedDays.length < 3) {
      for (const d of orderedDatesISO) {
        if (selectedDays.length >= 3) break;
        if (selectedDays.includes(d)) continue;
        const slots = (daySlotsMap.get(d) || []).sort(slotChronoCmp);
        if (!slots.length) continue;
        selectedDays.push(d);
        selectedSlots.push(...slots);
      }
    }

    // 12) Redactor final
    const disclaimerRanges = collapseDatesToRanges(Array.from(fechasConsultadas)).map((r) => ({ start: r.start, end: r.end }));

    const finalPolicy = await AgendaConfigCompilerService(
      presenterOpenAI,
      botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || "",
      analisisTotal,
      {
        preferencias_usuario: { horas_preferencia_usuario: params.horas ? [params.horas] : [] },
        presentacion_override: { mostrar_medicos: "auto" },
        limites_override: { tope_global: 999, tope_por_dia: 999, tope_dias: 99 },
      },
    );

    const redactor = await AvailabilityResponseRedactorService(
      presenterOpenAI,
      selectedSlots.sort(slotChronoCmp),
      { policy: finalPolicy },
      {
        ahoraISO: tiempoActualDT.toISO() as string,
        timezone,
        contextoRedactor: {
          tipo_busqueda: "fechas_rankeadas",
          disclaimer_fechas: disclaimerRanges,
          dias_mostrados: Array.from(new Set(selectedDays)),
          horas_preferencia_usuario: params.horas || "",
        },
      },
    );

    // 13) toolOutput final (idempotente)
    const toolOutput = `#consultaAgendar\n`
      + `    TIEMPO_LOCAL: ${localTimeForPrompts}\n`
      + `    DISCLAIMER_FECHAS_BUSCADAS: ${JSON.stringify(disclaimerRanges)}\n`
      + `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: "fechas_rankeadas", horarios_escogidos: selectedSlots })}\n`
      + `    HORARIOS_TEXTO: ${JSON.stringify(redactor.mensaje)}\n`
      + `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n`
      + `    `;

    Logger.info("[CheckAvailability] Completado (steps / ID-first)", {
      leadId,
      diasMostrados: Array.from(new Set(selectedDays)).length,
      slots: selectedSlots.length,
      consultedDates: fechasConsultadas.size,
      datesWithResults: fechasConResultados.size,
      horizonEnd: globalRanking.horizonEnd,
      stepsTelemetry: stepExec.telemetry,
    });

    return { success: true, toolOutput };
  }
}

// =============================
// Helpers locales (idénticos en espíritu, ID-agnósticos)
// =============================
function groupContiguousDates(dates: ISODate[]): DateRange[] {
  if (!dates.length) return [];
  const sorted = [...new Set(dates)].sort();
  const out: DateRange[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const expectedNext = addDays(prev, 1);
    if (cur !== expectedNext) {
      out.push({ start, end: prev });
      start = cur;
    }
    prev = cur;
  }
  out.push({ start, end: prev });
  return out;
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

// Narrow de HH:mm a template literal `${string}:${string}`
const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function asHHMM(s: string): `${string}:${string}` {
  if (!HHMM_RE.test(s)) throw new Error(`Hora inválida: ${s}`);
  return s as `${string}:${string}`;
}

function toDaySlot(s: MinimalSlot): DaySlot {
  const idEspacio: string | number | undefined =
    typeof s.id_espacio === "number" || typeof s.id_espacio === "string" ? s.id_espacio : undefined;

  return {
    fecha_cita: s.fecha_cita,
    hora_inicio: asHHMM(s.hora_inicio),
    id_espacio: idEspacio,
  };
}

function slotChronoCmp(a: MinimalSlot, b: MinimalSlot): number {
  if (a.fecha_cita !== b.fecha_cita) return a.fecha_cita < b.fecha_cita ? -1 : 1;
  if (a.hora_inicio !== b.hora_inicio) return a.hora_inicio < b.hora_inicio ? -1 : 1;
  const ae = String(a.id_espacio ?? "");
  const be = String(b.id_espacio ?? "");
  if (ae !== be) return ae < be ? -1 : 1;
  return 0;
}

export default CheckAvailabilityUseCase;