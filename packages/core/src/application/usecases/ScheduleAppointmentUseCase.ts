// packages/core/src/application/usecases/ScheduleAppointmentUseCase.ts

import {
  isAppointmentSoon,
  getClinicLocalTimestamp,
  formatFechaCita,
  PATIENT_FIRST_NAME,
  PATIENT_LAST_NAME,
  PATIENT_PHONE,
} from '@clinickeys-agents/core/utils';
import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import type { DateTime } from 'luxon';

import {
  KommoService,
  AppointmentService,
  AvailabilityDomainService,
  PatientService,
  OpenAIService,
  BonoService,
} from '@clinickeys-agents/core/application/services';

import {
  pickAnchorsFromExtractorDates,
  orderAnchorsByCloseness,
  planBlocksAroundAnchor,
  expandRangeToFechas,
  collapseBlocksToRanges,
  type Block,
  type PlannerOptions,
} from '@clinickeys-agents/core/application/services';
import { AgendaConfigCompilerService, SlotAccumulator, AvailabilityResponseRedactorService } from '@clinickeys-agents/core/application/services';
import type {
  SlotAccumulatorInput,
  SlotAccumulatorOutput,
} from '@clinickeys-agents/core/application/services/types/Availability';
import type { QueryContext } from '@clinickeys-agents/core/application/services/AvailabilityService/types/QueryContext';

import { type HorarioEscogido } from '@clinickeys-agents/core/domain/availability';

interface ScheduleAppointmentInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  params: {
    id_paciente?: number | null;
    shouldCreatePatient: boolean;
    isThirdParty: boolean;
    nombre: string;
    apellido: string;
    telefono: string;
    summary: string;
    id_bono_paciente?: number | null;
    item_bono_paciente?: number | null;
    id_presupuesto?: number | null;

    horarioEscogido: {
      fecha_cita?: string; // YYYY-MM-DD
      fecha?: string; // alias aceptado
      hora_inicio: string; // HH:MM o HH:MM:SS
      hora_fin?: string; // HH:MM o HH:MM:SS (si no viene, se calcula con la duración)
      id_tratamiento: number;
      id_medico: number;
      id_espacio: number;
      nombre_tratamiento?: string;
      nombre_medico?: string;
      apellido_medico?: string;
      nombre_espacio?: string;
      duracion_tratamiento?: number; // minutos
    };
  };
  timezone: string;
  tiempoActualDT: DateTime;
  subdomain: string;
}

interface ScheduleAppointmentOutput {
  success: boolean;
  toolOutput: string;
  customFields?: Record<string, string>;
  createdAppointmentId?: number;
  needsConfirmation?: boolean;
  /** Id del paciente finalmente utilizado (existente o recién creado). */
  id_paciente_result?: number;
}

type StepTipo =
  | 'original'
  | 'intermedio_hasta_fecha'
  | 'ampliada_mismo_medico'
  | 'ampliada_sin_medico_rango_dias_original'
  | 'ampliada_sin_medico_rango_dias_extendido';

export class ScheduleAppointmentUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly appointmentService: AppointmentService,
    private readonly availabilityService: AvailabilityDomainService,
    private readonly patientService: PatientService,
    private readonly openAIService: OpenAIService,
    private readonly bonoService: BonoService,
  ) {}

  public async execute(input: ScheduleAppointmentInput): Promise<ScheduleAppointmentOutput> {
    const { botConfig, leadId, normalizedLeadCF, params, timezone, tiempoActualDT } = input;

    const {
      shouldCreatePatient,
      nombre,
      apellido,
      telefono,
      summary,
      horarioEscogido,
    } = params;

    // Normalización fuerte de campos opcionales
    const id_bono_paciente = (params.id_bono_paciente ?? null) as number | null;
    const item_bono_paciente = (params.item_bono_paciente ?? null) as number | null;
    const id_presupuesto = (params.id_presupuesto ?? null) as number | null;

    // Invariante de identidad paciente: id_paciente null cuando se crea; number cuando no
    let id_paciente: number | null = (params.id_paciente ?? null);

    if (shouldCreatePatient) {
      id_paciente = null;
    } else {
      if (id_paciente === null || !Number.isFinite(id_paciente)) {
        Logger.error('[ScheduleAppointment] Contrato inválido: shouldCreatePatient=false requiere id_paciente:number');
        return {
          success: false,
          toolOutput: '#agendarCita\nNo se pudo agendar: falta un id_paciente válido cuando shouldCreatePatient=false.',
        };
      }
    }

    const localTimeForPrompts = getClinicLocalTimestamp(tiempoActualDT, timezone);

    Logger.info('[ScheduleAppointment] Inicio', {
      leadId,
      nombre,
      apellido,
      telefono,
      id_paciente,
      shouldCreatePatient,
      hasHorario: !!horarioEscogido,
    });

    // 1) Mensaje inicial al bot (UX)
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message: 'Perfecto, voy a intentar agendar tu cita ahora mismo. Un momento por favor.'
    });

    // 2) Asegurar paciente (único lugar donde se crea si shouldCreatePatient === true)
    let finalPatientId: number | null = id_paciente;
    if (!finalPatientId && shouldCreatePatient) {
      Logger.info('[ScheduleAppointment] Resolviendo paciente (find-only antes de crear)');
      try {
        // Dedupe básico: buscar primero por teléfono en la clínica
        const existentes = await this.patientService.getBasicPatientsByPhone(telefono, botConfig.clinicId);
        if (existentes && existentes.length) {
          finalPatientId = existentes[0].id_paciente;
          Logger.info('[ScheduleAppointment] Paciente existente reutilizado', { finalPatientId });
        } else {
          Logger.info('[ScheduleAppointment] Creando nuevo paciente');
          finalPatientId = await this.patientService.createPatient({
            nombre,
            apellido,
            telefono,
            id_clinica: botConfig.clinicId,
            id_super_clinica: botConfig.superClinicId,
            kommo_lead_id: leadId,
          });
          Logger.info('[ScheduleAppointment] Paciente creado', { finalPatientId });
        }
      } catch (err: any) {
        Logger.error('[ScheduleAppointment] Error al resolver/crear paciente', { message: err?.message });
      }
    }

    if (!finalPatientId) {
      Logger.error('[ScheduleAppointment] No se pudo determinar un paciente válido');
      return {
        success: false,
        toolOutput: '#agendarCita\nNo se pudo identificar o crear un paciente válido para agendar la cita.',
        id_paciente_result: undefined,
      };
    }

    // 3) Intento optimista de crear la cita con el horario seleccionado
    let appointmentCreated: {
      id_cita: number;
      isSoon: boolean;
      nombre_tratamiento?: string;
      nombre_medico?: string;
      apellido_medico?: string;
      fecha_cita: string;
      hora_inicio: string;
      hora_fin: string;
    } | null = null;

    try {
      const fecha_cita = (horarioEscogido.fecha_cita || horarioEscogido.fecha || '').trim();
      const hora_inicio = this.normalizeHHMMSS(horarioEscogido.hora_inicio);
      const hora_fin = this.normalizeHHMMSS(
        horarioEscogido.hora_fin || this.calcHoraFin(horarioEscogido.hora_inicio, horarioEscogido.duracion_tratamiento)
      );

      if (!fecha_cita || !hora_inicio || !hora_fin) {
        throw new Error('Horario incompleto: falta fecha u horas válidas');
      }

      Logger.info('[ScheduleAppointment] OptimisticInsert:start', {
        fecha_cita,
        hora_inicio,
        hora_fin,
        id_medico: horarioEscogido.id_medico,
        id_espacio: horarioEscogido.id_espacio,
        id_tratamiento: horarioEscogido.id_tratamiento,
        id_bono_paciente,
        item_bono_paciente,
        id_presupuesto,
      });

      const spResponse = await this.appointmentService.insertarCitaConComentario({
        p_id_clinica: botConfig.clinicId,
        p_id_super_clinica: botConfig.superClinicId,
        p_id_paciente: finalPatientId,
        p_id_medico: horarioEscogido.id_medico,
        p_id_espacio: horarioEscogido.id_espacio,
        p_id_tratamiento: horarioEscogido.id_tratamiento,
        p_id_bono_paciente: id_bono_paciente || 0,
        p_item_bono_paciente: item_bono_paciente || 0,
        p_id_presupuesto: id_presupuesto || 0,
        p_fecha_cita: fecha_cita,
        p_hora_inicio: hora_inicio,
        p_hora_fin: hora_fin,
        p_comentario_ia: summary,
      });

      const id_cita: number | undefined = spResponse?.[0]?.[0]?.id_cita || spResponse?.insertId || spResponse?.id_cita;

      if (!id_cita) throw new Error('SP no devolvió id_cita');

      Logger.info('[ScheduleAppointment] Cita creada', { id_cita });
      await this.bonoService.procesarBonoPresupuestoDeCita('on_crear_cita', id_cita);

      const isSoon = isAppointmentSoon(fecha_cita, tiempoActualDT.toISO() as string, botConfig.timezone);

      appointmentCreated = {
        id_cita,
        isSoon,
        nombre_tratamiento: horarioEscogido.nombre_tratamiento,
        nombre_medico: horarioEscogido.nombre_medico,
        apellido_medico: horarioEscogido.apellido_medico,
        fecha_cita,
        hora_inicio,
        hora_fin,
      };
    } catch (err: any) {
      Logger.error('[ScheduleAppointment] OptimisticInsert:error → se activará fallback de búsqueda', {
        message: err?.message,
      });
    }

    // Si la cita quedó creada, devolver resultado final
    if (appointmentCreated) {
      const fechaLegible = formatFechaCita(appointmentCreated.fecha_cita);
      const doctorLine = appointmentCreated.nombre_medico
        ? `\n- El médico es “${appointmentCreated.nombre_medico} ${appointmentCreated.apellido_medico ?? ''}”.`
        : '';
      const toolOutput = `#agendarCita\n- La cita de “${appointmentCreated.nombre_tratamiento ?? ''}” ha sido agendada para el ${fechaLegible} a las ${appointmentCreated.hora_inicio}.${doctorLine}`;

      const customFields = {
        [PATIENT_FIRST_NAME]: nombre,
        [PATIENT_LAST_NAME]: apellido,
        [PATIENT_PHONE]: telefono,
      };

      return {
        success: true,
        toolOutput,
        customFields,
        createdAppointmentId: appointmentCreated.id_cita,
        needsConfirmation: appointmentCreated.isSoon,
        id_paciente_result: finalPatientId,
      };
    }

    // 4) Fallback: búsqueda de nuevas disponibilidades (como CheckAvailability, policy por BLOQUE)
    Logger.info('[ScheduleAppointment] Fallback:start');

    // Config generales
    const blockDays = 5;
    const forwardMaxDaysDefault = 45;
    const MAX_GLOBAL = 10;
    const plannerBase: Pick<PlannerOptions, 'blockDays'> = { blockDays };

    const globalHorarios: HorarioEscogido[] = [];
    const seenKeys = new Set<string>();
    const blocksConsultados: Block[] = [];

    const addSelected = (arr: HorarioEscogido[], origen: string) => {
      for (const h of arr) {
        const key = this.horarioKey(h);
        if (seenKeys.has(key)) continue;
        globalHorarios.push(h);
        seenKeys.add(key);
        Logger.info('[ScheduleAppointment] Fallback:block:selected', { origen, key, total: globalHorarios.length });
        if (globalHorarios.length >= MAX_GLOBAL) return true;
      }
      return false;
    };

    // Construir un "filter" local a partir del horario elegido (sin llamar al extractor)
    const fechaElegida = (horarioEscogido.fecha_cita || horarioEscogido.fecha || '').trim();
    const tratamientosSel = [horarioEscogido.nombre_tratamiento || String(horarioEscogido.id_tratamiento)];
    const medicosSel = horarioEscogido.nombre_medico ? [horarioEscogido.nombre_medico] : [];
    const espaciosSel = horarioEscogido.nombre_espacio ? [horarioEscogido.nombre_espacio] : [];

    const localFilter = {
      tratamientos: tratamientosSel,
      medicos: medicosSel,
      espacios: espaciosSel,
      date_ranges: fechaElegida ? [{ start_date: fechaElegida, end_date: fechaElegida }] : [],
    };

    const fechasExtractor = (localFilter.date_ranges || []).flatMap((r) => expandRangeToFechas({ start: r.start_date, end: r.end_date }));
    const anchors = orderAnchorsByCloseness(pickAnchorsFromExtractorDates(fechasExtractor), tiempoActualDT.toISODate()!);

    // Steps igual que en CheckAvailability
    const hasMedico = (medicosSel || []).length > 0;
    const steps: {
      tipo: StepTipo;
      filtros: { con_medico: boolean; rango_dias_extra: number; backwardOnly?: boolean };
      medicos: string[];
      planner: PlannerOptions;
    }[] = [];

    steps.push({ tipo: 'original', filtros: { con_medico: hasMedico, rango_dias_extra: 5 }, medicos: medicosSel, planner: { ...plannerBase, forwardMaxDays: 5 } });
    steps.push({ tipo: 'intermedio_hasta_fecha', filtros: { con_medico: hasMedico, rango_dias_extra: 0, backwardOnly: true }, medicos: medicosSel, planner: { ...plannerBase, forwardMaxDays: 5 } });
    steps.push({ tipo: 'ampliada_mismo_medico', filtros: { con_medico: hasMedico, rango_dias_extra: 45 }, medicos: medicosSel, planner: { ...plannerBase, forwardMaxDays: forwardMaxDaysDefault } });
    steps.push({ tipo: 'ampliada_sin_medico_rango_dias_original', filtros: { con_medico: false, rango_dias_extra: 5 }, medicos: [], planner: { ...plannerBase, forwardMaxDays: 5 } });
    steps.push({ tipo: 'ampliada_sin_medico_rango_dias_extendido', filtros: { con_medico: false, rango_dias_extra: 45 }, medicos: [], planner: { ...plannerBase, forwardMaxDays: forwardMaxDaysDefault } });

    let lastTipoBusquedaFromBlock: string | undefined;
    let lastPolicyUsed: any | undefined;

    for (const step of steps) {
      if (globalHorarios.length >= MAX_GLOBAL) break;
      Logger.info('[ScheduleAppointment] Fallback:step:start', { step: step.tipo, planner: step.planner, con_medico: step.filtros.con_medico });

      for (const anchor of anchors) {
        if (globalHorarios.length >= MAX_GLOBAL) break;
        Logger.debug('[ScheduleAppointment] Fallback:anchor', { anchor });

        let blocks = planBlocksAroundAnchor(anchor, tiempoActualDT.toISODate()!, step.planner);
        if (step.filtros.backwardOnly) blocks = blocks.filter((b) => b.direction === 'backward');

        for (const block of blocks) {
          if (globalHorarios.length >= MAX_GLOBAL) break;
          Logger.info('[ScheduleAppointment] Fallback:block', { start: block.start, end: block.end, direction: block.direction });

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
          const analisis_local: any[] = baseResult.success && Array.isArray(baseResult.analisis_agenda) ? (baseResult.analisis_agenda as any[]) : [];

          // Registrar bloques consultados
          blocksConsultados.push(block);

          if (!analisis_local.length) {
            Logger.warn('[ScheduleAppointment] Fallback:block:no-results');
            continue;
          }

          // Compilar policy por bloque
          let policyForBlock: any;
          try {
            policyForBlock = await AgendaConfigCompilerService(
              this.openAIService,
              botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || '',
              analisis_local,
              {
                preferencias_usuario: { horas_preferencia_usuario: [] },
                presentacion_override: { mostrar_medicos: 'auto' },
              },
            );
            Logger.info('[ScheduleAppointment] Fallback:block:policy-compiled', {
              minutos_globales: policyForBlock?.minutos_globales?.length || 0,
              reglas_tratamiento: policyForBlock?.reglas_minutos_por_tratamiento_resueltas?.length || 0,
            });
          } catch (err) {
            Logger.error('[ScheduleAppointment] Fallback:block:policy-error (se omite bloque)', { err });
            continue;
          }

          // Acumular por bloque
          const accInput: SlotAccumulatorInput = {
            policy: policyForBlock,
            filters: [localFilter] as any,
            windows: analisis_local,
            contexto: {
              horas_preferencia_usuario: [],
              ahoraISO: tiempoActualDT.toISO() as string,
              timezone,
            },
          };

          let accOut: SlotAccumulatorOutput | null = null;
          try {
            accOut = await SlotAccumulator(accInput);
          } catch (err) {
            Logger.error('[ScheduleAppointment] Fallback:block:accumulator-error (se omite bloque)', { err });
            continue;
          }

          const seleccionadasBloque: HorarioEscogido[] = Array.isArray(accOut?.opciones_top10)
            ? (accOut!.opciones_top10 as any)
            : [];

          if (!seleccionadasBloque.length) {
            Logger.warn('[ScheduleAppointment] Fallback:block:policy-no-match', {
              candidatos: analisis_local.length,
              motivo: accOut?.metadata?.warnings || [],
            });
            continue;
          }

          lastTipoBusquedaFromBlock = accOut?.tipo_busqueda_final || lastTipoBusquedaFromBlock || 'bloques';
          lastPolicyUsed = policyForBlock;

          const cut = addSelected(seleccionadasBloque, `${step.tipo}/${anchor}`);
          if (cut) break;
        }
      }
    }

    // Orden y redacción final
    const finalHorarios = this.orderHorarios(
      globalHorarios,
      tiempoActualDT.toISODate()!,
      tiempoActualDT.toISO()!,
    ).slice(0, MAX_GLOBAL);

    const datesConsultedRanges = collapseBlocksToRanges(blocksConsultados);

    const diasMostrados = Array.from(
      new Set(
        finalHorarios
          .map((s: any) => s?.fecha_cita || s?.fecha)
          .filter((x: any): x is string => typeof x === 'string' && x.length > 0),
      ),
    );

    const daysWithResults = new Set<string>(
      (finalHorarios || [])
        .map((s: any) => s?.fecha_cita || s?.fecha)
        .filter((x: any): x is string => typeof x === 'string' && x.length > 0),
    );

    const rankedDatesFallback = Array.from(
      new Set(
        blocksConsultados.flatMap((block) =>
          expandRangeToFechas({ start: block.start, end: block.end }).map((f) => f.fecha),
        ),
      ),
    ).sort();

    const queryContext: QueryContext = {
      fechas_rankeadas: rankedDatesFallback,
      consultas_ejecutadas: datesConsultedRanges.map((r) => ({ start: r.start, end: r.end })),
      fechas_entregadas_al_asistente: diasMostrados,
      criterios: {
        base: 'bloques alrededor de anclas → ascendente',
        preferencias_horarias: '',
        interpretacion_maximo: lastPolicyUsed?.interpretacion_maximo ?? 'ultimo_inicio',
      },
      caducidad: {
        ttl_ms: 5 * 60 * 1000,
        generated_at_iso: tiempoActualDT.toISO() as string,
        timezone,
      },
      anchors: { today_iso: tiempoActualDT.toISODate() || undefined },
      coverage: {
        dates_consulted_count: datesConsultedRanges.reduce((acc, r) => {
          const startMs = Date.parse(`${r.start}T00:00:00Z`);
          const endMs = Date.parse(`${r.end}T00:00:00Z`);
          if (Number.isNaN(startMs) || Number.isNaN(endMs)) return acc;
          const diffDays = Math.max(1, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1);
          return acc + diffDays;
        }, 0),
        dates_with_results_count: daysWithResults.size,
        selected_days_count: diasMostrados.length,
      },
    };

    const redactorResult = await AvailabilityResponseRedactorService(
      this.openAIService,
      finalHorarios,
      { policy: lastPolicyUsed || { version: '1.0', interpretacion_maximo: 'ultimo_inicio' } as any },
      {
        ahoraISO: tiempoActualDT.toISO() as string,
        timezone,
        contextoRedactor: {
          tipo_busqueda: lastTipoBusquedaFromBlock || 'bloques',
          query_context: queryContext,
          dias_mostrados: diasMostrados,
          horas_preferencia_usuario: '',
        },
      },
    );

    const copyFallbackIntro = finalHorarios.length > 0
      ? 'No pudimos confirmar ese horario; ya no estaba disponible. Te propongo estas nuevas opciones:'
      : 'No pudimos confirmar ese horario y no encontramos alternativas en ese rango. ¿Quieres probar con otra fecha o franja?';

    const mensajeFinal = `${copyFallbackIntro}\n\n${redactorResult.mensaje || ''}`.trim();

    const toolOutput = `#agendarCita\n` +
      `    TIEMPO_LOCAL: ${localTimeForPrompts}\n` +
      `    QUERY_CONTEXT: ${JSON.stringify(queryContext)}\n` +
      `    HORARIOS_DISPONIBLES: ${JSON.stringify({ tipo_busqueda: lastTipoBusquedaFromBlock || 'bloques', horarios_escogidos: finalHorarios })}\n` +
      `    HORARIOS_TEXTO: ${JSON.stringify(mensajeFinal)}\n` +
      `    MENSAJE_USUARIO: ${JSON.stringify({ nombre, apellido, telefono, summary })}\n` +
      `    HORARIO_ELEGIDO_ORIGINAL: ${JSON.stringify(horarioEscogido)}\n` +
      `    `;

    const customFields = {
      [PATIENT_FIRST_NAME]: nombre,
      [PATIENT_LAST_NAME]: apellido,
      [PATIENT_PHONE]: telefono,
    };

    Logger.info('[ScheduleAppointment] Fallback:final', {
      opciones: finalHorarios.length,
      dias_mostrados: diasMostrados.length,
    });

    return {
      success: true,
      toolOutput,
      customFields,
      createdAppointmentId: undefined,
      needsConfirmation: false,
      id_paciente_result: finalPatientId,
    };
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
      const hhmm = /^\d{2}:\d{2}(:\d{2})?$/.test(hora) ? hora.substring(0, 5) : String(hora || '00:00').substring(0, 5);
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

  private normalizeHHMMSS(t: string | undefined | null): string {
    if (!t) return '';
    const s = String(t).trim();
    if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{2}:\d{2}$/.test(s)) return `${s}:00`;
    // Intento de normalizar entradas tipo "9:0" → 09:00:00
    const parts = s.split(':').map((x) => x.padStart(2, '0'));
    if (parts.length >= 2) return `${parts[0].slice(-2)}:${parts[1].slice(-2)}:${parts[2]?.slice(-2) || '00'}`;
    return '';
  }

  private calcHoraFin(hora_inicio: string, duracionMin?: number): string {
    if (!duracionMin || !Number.isFinite(duracionMin)) {
      throw new Error('No se puede calcular hora_fin: falta duración de tratamiento');
    }
    const [h, m] = this.parseHM(hora_inicio);
    const total = h * 60 + m + Math.floor(duracionMin);
    const hh = Math.floor(total / 60) % 24;
    const mm = total % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
  }

  private parseHM(t: string): [number, number] {
    const norm = this.normalizeHHMMSS(t);
    const m = norm.match(/^(\d{2}):(\d{2})/);
    const hh = m ? parseInt(m[1], 10) : 0;
    const mm = m ? parseInt(m[2], 10) : 0;
    return [hh, mm];
  }
}

export default ScheduleAppointmentUseCase;
