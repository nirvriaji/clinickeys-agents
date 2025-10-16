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

import type {
  SlotDisponibilidad,
} from "@clinickeys-agents/core/domain/availability";

import type { ITratamientoRepository } from "@clinickeys-agents/core/domain/tratamiento";
import type { IMedicoRepository } from "@clinickeys-agents/core/domain/medico";
import type { IEspacioRepository } from "@clinickeys-agents/core/domain/espacio";

import type { BotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";
import { KommoCustomFieldValueBase } from "@clinickeys-agents/core/infrastructure/integrations/kommo";
import { getClinicLocalTimestamp } from "@clinickeys-agents/core/utils";

// Nueva estrategia (servicios utilitarios)
import { AvailabilityDateRankingService } from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityDateRankingService";
import {
  AvailabilityTimeDivisionsService,
} from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilityTimeDivisionsService";
import {
  AvailabilitySearchCache,
} from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilitySearchCache";

import type {
  ISODate,
  DateRange,
  MinimalSlot,
  TimeDivision,
} from "@clinickeys-agents/core/application/services/AvailabilityService/AvailabilitySearch";

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
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
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
// Implementación
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
        message: "Muy bien, voy a mirar la agenda para ver las citas disponibles. Un momento, por favor.",
      });
    } catch (err) {
      Logger.warn("[CheckAvailability] No se pudo enviar el mensaje inicial (continuando)", { err });
    }

    Logger.info("[CheckAvailability] Inicio (nueva estrategia)", {
      clinicId: botConfig.clinicId,
      tratamiento: params.tratamiento,
      medico: params.medico,
      espacio: params.espacio,
      fechas: params.fechas,
      horas: params.horas,
      timezone,
      localTimeForPrompts,
    });

    // 2) Catálogos para extractor
    const tratamientos = await this.tratamientoRepo.getActiveTreatmentsForClinic(
      botConfig.clinicId,
      botConfig.superClinicId,
    );
    const medicos = await this.medicoRepo.getMedicos(botConfig.clinicId, botConfig.superClinicId);
    const espacios = await this.espacioRepo.findByClinica(botConfig.clinicId);

    const nombresTratamientos = tratamientos.map((t) => t.nombre_tratamiento);
    const nombresMedicos = medicos.map((m) => m.nombre_completo);
    const nombresEspacios = espacios.map((e) => e.nombre);

    // 3) Extraer filtros (tratamiento/medico/espacio/fechas)
    const filters = await this.extractor.extract(
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
        tratamientosDisponibles: nombresTratamientos,
        medicosDisponibles: nombresMedicos,
        espaciosDisponibles: nombresEspacios,
      },
      { header: { DEFAULT_FORWARD_DAYS: 45 } },
    );

    if (!filters.length) {
      const aclaracion =
        "No he podido interpretar bien su solicitud para buscar horarios. ¿Podría reenviar su mensaje indicando el tratamiento y fechas aproximadas que prefiere?";

      const toolOutput = `#consultaAgendar\n`
        + `    TIEMPO_LOCAL: ${localTimeForPrompts}\n`
        + `    DISCLAIMER_FECHAS_BUSCADAS: []\n`
        + `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: "fechas_rankeadas", horarios_escogidos: [] })}\n`
        + `    HORARIOS_TEXTO: ${JSON.stringify(aclaracion)}\n`
        + `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n`
        + `    `;

      Logger.warn("[CheckAvailability] Extractor sin filtros; devolviendo aclaración");
      return { success: true, toolOutput };
    }

    // 4) Ranking de fechas (única lista ordenada)
    const nowISO: ISODate = tiempoActualDT.toISODate() as ISODate;
    const forwardExtensionDays = Math.max(1, Math.floor(45 + (params.rango_dias_extra ?? 0)));

    const ranking = AvailabilityDateRankingService.fromExtractorFilters({
      filters: filters as any,
      nowISODate: nowISO,
      weekdaysPreferred: [],
      forwardExtensionDays,
    });

    const orderedDatesISO: ISODate[] = (ranking.orderedDates || []).map((r) => r.fecha);

    if (!orderedDatesISO.length) {
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

    // 5) Divisiones horarias canónicas
    const divisions: TimeDivision[] = AvailabilityTimeDivisionsService.defaultConfig() as any;

    // 6) Buscar disponibilidad por lotes (agrupando fechas contiguas)
    const fechasConsultadas = new Set<ISODate>();
    const fechasConResultados = new Set<ISODate>();

    const daySlotsMap = new Map<ISODate, MinimalSlot[]>();

    const ranges = groupContiguousDates(orderedDatesISO);

    for (const r of ranges) {
      const fechasBloque = expandRangeToFechas(r);
      for (const f of fechasBloque) fechasConsultadas.add(f.fecha);

      const cacheInput = {
        id_clinica: botConfig.clinicId,
        tratamientos: [(filters[0] as any)?.tratamientos?.[0] ?? params.tratamiento],
        medicos: ((filters[0] as any)?.medicos as string[]) || (params.medico ? [params.medico] : []),
        espacios: ((filters[0] as any)?.espacios as string[]) || (params.espacio ? [params.espacio] : []),
        fechas: fechasBloque,
      };

      const { value, status } = await this.cache.getOrSet(cacheInput, async () => {
        const availabilityRequest = {
          tratamientos: (filters[0] as any)?.tratamientos ?? [params.tratamiento],
          medicos: (filters[0] as any)?.medicos ?? (params.medico ? [params.medico] : []),
          espacios: (filters[0] as any)?.espacios ?? (params.espacio ? [params.espacio] : []),
          fechas: fechasBloque,
          id_clinica: botConfig.clinicId,
          tiempo_actual: tiempoActualDT.toISO() as string,
        };
        const baseResult = await this.availabilityService.getAppointmentAvailability(availabilityRequest);
        const analisis_agenda = baseResult.success && Array.isArray(baseResult.analisis_agenda)
          ? (baseResult.analisis_agenda as SlotDisponibilidad[])
          : [];
        Logger.info("[CheckAvailability] Dominio consultado", { range: r, count: analisis_agenda.length });
        return { analisis_agenda, fetchedAtISO: new Date().toISOString(), ttlMs: 5 * 60 * 1000 };
      });

      if (status === "hit") Logger.info("[CheckAvailability] Cache HIT", { range: r, count: value.analisis_agenda.length });

      const analisis_local = value.analisis_agenda as SlotDisponibilidad[];
      if (!analisis_local.length) continue;

      // Compilar policy temporal para expansión completa (sin topes)
      const presenterOpenAI = (this.extractor as any)["openAIService"];
      const policyForBlock = await AgendaConfigCompilerService(
        presenterOpenAI,
        botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || "",
        analisis_local,
        {
          preferencias_usuario: { horas_preferencia_usuario: params.horas ? [params.horas] : [] },
          presentacion_override: { mostrar_medicos: "auto" },
          limites_override: { tope_global: 999, tope_por_dia: 999, tope_dias: 99 },
        },
      );

      // Expandir ventanas a *todos* los inicios (sin recortes)
      const accOut = await SlotAccumulator({
        policy: policyForBlock,
        filters: filters as any,
        windows: analisis_local as any,
        contexto: {
          horas_preferencia_usuario: params.horas ? [params.horas] : [],
          ahoraISO: tiempoActualDT.toISO() as string,
          timezone,
        },
      });

      const slots = ((accOut?.universo_opciones || []) as any) as MinimalSlot[];

      // Indexar por día
      for (const s of slots) {
        const d = (s as any).fecha_cita as ISODate;
        const list = daySlotsMap.get(d) || [];
        list.push({
          fecha_cita: d,
          fecha_legible: (s as any).fecha_legible ?? null,
          hora_inicio: (s as any).hora_inicio,
          id_medico: (s as any).id_medico ?? null,
          nombre_medico: (s as any).nombre_medico ?? null,
          id_espacio: (s as any).id_espacio ?? null,
          nombre_espacio: (s as any).nombre_espacio ?? null,
          id_tratamiento: (s as any).id_tratamiento ?? null,
          nombre_tratamiento: (s as any).nombre_tratamiento ?? null,
          duracion_tratamiento: (s as any).duracion_tratamiento ?? null,
        } as MinimalSlot);
        daySlotsMap.set(d, list);
        fechasConResultados.add(d);
      }
    }

    // 7) Seleccionar días en orden de ranking hasta completar 3 días "completos"
    const selectedDays: ISODate[] = [];
    const selectedSlots: MinimalSlot[] = [];

    for (const d of orderedDatesISO) {
      const slots = (daySlotsMap.get(d) || []).sort(slotChronoCmp);
      if (!slots.length) continue;

      const assignment = AvailabilityTimeDivisionsService.assignDay(d, slots as any, divisions as any);
      AvailabilityTimeDivisionsService.logCoverage(assignment);

      const isComplete = assignment.coverage.nonEmptyDivisions >= (divisions.length || 1);
      if (isComplete) {
        selectedDays.push(d);
        selectedSlots.push(...slots);
      }
      if (selectedDays.length >= 3) break;
    }

    // Si no llegamos a 3 días completos, incluir los mejores días parciales (manteniendo regla de no omitir)
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

    // 8) Redacción (policy final sobre TODAS las ventanas acumuladas)
    const allWindows: any[] = [];
    for (const r of ranges) {
      const fechasBloque = expandRangeToFechas(r);
      const cacheInput = {
        id_clinica: botConfig.clinicId,
        tratamientos: [(filters[0] as any)?.tratamientos?.[0] ?? params.tratamiento],
        medicos: ((filters[0] as any)?.medicos as string[]) || (params.medico ? [params.medico] : []),
        espacios: ((filters[0] as any)?.espacios as string[]) || (params.espacio ? [params.espacio] : []),
        fechas: fechasBloque,
      };
      const cached = this.cache.get(cacheInput);
      if (cached?.analisis_agenda?.length) allWindows.push(...cached.analisis_agenda);
    }

    const presenterOpenAI = (this.extractor as any)["openAIService"];
    const finalPolicy = await AgendaConfigCompilerService(
      presenterOpenAI,
      botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || "",
      allWindows,
      {
        preferencias_usuario: { horas_preferencia_usuario: params.horas ? [params.horas] : [] },
        presentacion_override: { mostrar_medicos: "auto" },
        limites_override: { tope_global: 999, tope_por_dia: 999, tope_dias: 99 },
      },
    );

    const diasMostrados = Array.from(new Set(selectedDays));

    const disclaimerRanges = collapseDatesToRanges(Array.from(fechasConsultadas)).map((r) => ({
      start: r.start,
      end: r.end,
    }));

    const redactor = await AvailabilityResponseRedactorService(
      presenterOpenAI,
      selectedSlots.sort(slotChronoCmp),
      { policy: finalPolicy as any },
      {
        ahoraISO: tiempoActualDT.toISO() as string,
        timezone,
        contextoRedactor: {
          tipo_busqueda: "fechas_rankeadas",
          disclaimer_fechas: disclaimerRanges,
          dias_mostrados: diasMostrados,
          horas_preferencia_usuario: params.horas || "",
        },
      },
    );

    // 9) toolOutput final (idempotente)
    const toolOutput = `#consultaAgendar\n`
      + `    TIEMPO_LOCAL: ${localTimeForPrompts}\n`
      + `    DISCLAIMER_FECHAS_BUSCADAS: ${JSON.stringify(disclaimerRanges)}\n`
      + `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: "fechas_rankeadas", horarios_escogidos: selectedSlots })}\n`
      + `    HORARIOS_TEXTO: ${JSON.stringify(redactor.mensaje)}\n`
      + `    MENSAJE_USUARIO: ${JSON.stringify(params)}\n`
      + `    `;

    Logger.info("[CheckAvailability] Completado", {
      leadId,
      diasMostrados: diasMostrados.length,
      slots: selectedSlots.length,
      consultedDates: fechasConsultadas.size,
      datesWithResults: fechasConResultados.size,
      horizonEnd: ranking.horizonEnd,
    });

    return { success: true, toolOutput };
  }
}

// =============================
// Helpers locales
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

function slotChronoCmp(a: any, b: any): number {
  if (a.fecha_cita !== b.fecha_cita) return a.fecha_cita < b.fecha_cita ? -1 : 1;
  if (a.hora_inicio !== b.hora_inicio) return a.hora_inicio < b.hora_inicio ? -1 : 1;
  const ae = String(a.id_espacio ?? "");
  const be = String(b.id_espacio ?? "");
  if (ae !== be) return ae < be ? -1 : 1;
  return 0;
}

export default CheckAvailabilityUseCase;