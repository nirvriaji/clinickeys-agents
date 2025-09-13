// packages/core/src/application/usecases/RescheduleAppointmentUseCase.ts

import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { isAppointmentSoon, getActualTimeForPrompts } from '@clinickeys-agents/core/utils';
import { readFile } from 'fs/promises';
import { DateTime } from 'luxon';
import path from 'path';

import type { FetchPatientInfoUseCase } from './FetchPatientInfoUseCase';
type PatientInfo = Awaited<ReturnType<FetchPatientInfoUseCase['execute']>>;

import {
  KommoService,
  AppointmentService,
  AvailabilityService,
  OpenAIService,
} from '@clinickeys-agents/core/application/services';

import { filterAvailabilityByRestrictions } from '@clinickeys-agents/core/utils/availability/filterAvailabilityByRestrictions';

interface RescheduleAppointmentInput {
  botConfig: any;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  patientInfo: PatientInfo;
  params: {
    id_cita: number;
    id_tratamiento: number;
    tratamiento: string;
    medico?: string | null;
    id_medico?: number | null;
    espacio?: string | null;
    id_espacio?: number | null;
    fechas: string;
    horas: string;
    rango_dias_extra?: number;
    summary: string;
  };
  timezone: string;
  tiempoActualDT: DateTime;
  subdomain: string;
}

interface RescheduleAppointmentOutput {
  success: boolean;
  toolOutput: string;
  needsConfirmation?: boolean;
  updatedAppointmentId?: number;
}

const ID_ESTADO_CITA_PROGRAMADA = 1;

export class RescheduleAppointmentUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly appointmentService: AppointmentService,
    private readonly availabilityService: AvailabilityService,
    private readonly openAIService: OpenAIService,
  ) {}

  public async execute(input: RescheduleAppointmentInput): Promise<RescheduleAppointmentOutput> {
    const { botConfig, leadId, normalizedLeadCF, params, timezone, tiempoActualDT, subdomain, patientInfo } = input;
    const { id_cita, id_tratamiento, tratamiento, medico, id_medico, fechas, horas, summary } = params;

    Logger.info('[RescheduleAppointment] Inicio', { leadId, id_cita, tratamiento, medico, id_medico, fechas, horas });

    Logger.debug('[RescheduleAppointment] Enviando mensaje inicial al bot');
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message: 'Muy bien, voy a reprogramar tu cita. Un momento por favor.',
    });

    const STEPS = [
      { tipo: 'original', filtros: { con_medico: true, rango_dias_extra: 0 }, params: { ...params } },
      { tipo: 'ampliada_mismo_medico', filtros: { con_medico: true, rango_dias_extra: 45 }, params: { ...params, rango_dias_extra: 45 } },
      { tipo: 'ampliada_sin_medico_rango_dias_original', filtros: { con_medico: false, rango_dias_extra: 0 }, params: { ...params, medico: null, id_medico: null } },
      { tipo: 'ampliada_sin_medico_rango_dias_extendido', filtros: { con_medico: false, rango_dias_extra: 45 }, params: { ...params, medico: null, id_medico: null, rango_dias_extra: 45 } },
    ];

    let finalPayload: any = null;
    let citaReprogramada: any = null;

    for (const step of STEPS) {
      Logger.debug('[RescheduleAppointment] Buscando disponibilidad', { step: step.tipo, filtros: step.filtros });
      const fechasStep = step.filtros.rango_dias_extra
        ? `${Array.isArray(fechas) ? JSON.stringify(fechas) : fechas}, los próximos 45 días`
        : fechas;

      let availability = await this.availabilityService.getAvailabilityInfo({
        id_clinica: botConfig.clinicId,
        id_super_clinica: botConfig.superClinicId,
        tiempo_actual: tiempoActualDT.toISO() as string,
        mensajeBotParlante: JSON.stringify({
          id_tratamiento: step.params.id_tratamiento,
          tratamiento: step.params.tratamiento,
          fechas: fechasStep,
          horas: step.params.horas,
          medico: step.params.medico,
          id_medico: step.params.id_medico,
          espacio: step.params.espacio,
          id_espacio: step.params.id_espacio,
        }),
        subdomain,
        kommoToken: botConfig.longLivedToken,
        leadId,
      });
      Logger.info(`[RescheduleAppointment] Paso '${step.tipo}' respuesta recibida`, { success: availability.success, count: availability.analisis_agenda?.length });

      if (availability.success && Array.isArray(availability.analisis_agenda) && availability.analisis_agenda.length > 0) {
        const restricciones = botConfig?.placeholders?.RESTRICCIONES_EN_DISPONIBILIDADES || "";
        const filtradas = await filterAvailabilityByRestrictions(
          this.openAIService,
          availability.analisis_agenda,
          restricciones
        );
        availability.analisis_agenda = filtradas;

        finalPayload = {
          tipo_busqueda: step.tipo,
          filtros_aplicados: step.filtros,
          tratamiento: { id: step.params.id_tratamiento ?? null, nombre: step.params.tratamiento },
          horarios: availability.analisis_agenda,
        };
        Logger.debug('[RescheduleAppointment] Disponibilidad encontrada', { finalPayload });

        const actualTimeForPrompts = getActualTimeForPrompts(tiempoActualDT, timezone);
        const citasPacienteStr = JSON.stringify(patientInfo.appointments ?? []);
        const extractorPrompt = `#reprogramarCita\n\nTIEMPO_ACTUAL: ${actualTimeForPrompts}\n\nLa CITAS_PACIENTE que se va a reprogramar es la siguiente: ${citasPacienteStr};\nLos HORARIOS_DISPONIBLES: ${JSON.stringify(finalPayload)}\nMENSAJE_USUARIO: ${JSON.stringify(params)}`;
        Logger.debug('[RescheduleAppointment] Extractor prompt', extractorPrompt);
        const systemPrompt = await readFile(
          path.resolve(__dirname, 'packages/core/src/.ia/instructions/prompts/bot_extractor_de_datos.md'),
          'utf8',
        );
        const extractorData = await this.openAIService.getJsonStructuredResponse(
          systemPrompt,
          extractorPrompt,
        );
        Logger.debug('[RescheduleAppointment] Extractor de datos Ejecutado', extractorData);

        if (extractorData.success && extractorData.id_cita) {
          Logger.debug('[RescheduleAppointment] Datos extraídos con éxito', { extractorData });
          await this.appointmentService.updateAppointment({
            id_cita: extractorData.id_cita,
            id_medico: extractorData.id_medico,
            fecha_cita: extractorData.fecha_cita,
            hora_inicio: extractorData.hora_inicio,
            hora_fin: extractorData.hora_fin,
            id_espacio: extractorData.id_espacio,
            id_estado_cita: ID_ESTADO_CITA_PROGRAMADA,
            comentario_ia: summary
          });
          citaReprogramada = { ...extractorData };

          const isSoon = isAppointmentSoon(
            extractorData.fecha_cita,
            tiempoActualDT.toISODate() as string,
            botConfig.timezone
          );
          citaReprogramada.isSoon = isSoon;
          finalPayload.needsConfirmation = isSoon;
          finalPayload.updatedAppointmentId = extractorData.id_cita;
        }
        break;
      }
    }

    if (!finalPayload) {
      Logger.warn('[RescheduleAppointment] No se encontró disponibilidad en ningún paso');
      finalPayload = {
        tipo_busqueda: 'sin_disponibilidad',
        filtros_aplicados: { con_medico: !!medico, rango_dias_extra: 0 },
        tratamiento: { id: id_tratamiento ?? null, nombre: tratamiento },
        horarios: [],
      };
    }

    let toolOutput: string;
    if (citaReprogramada?.id_cita) {
      Logger.info('[RescheduleAppointment] Cita reprogramada con éxito', { citaReprogramada });
      toolOutput = `#reprogramarCita\nLa cita fue reprogramada con éxito con los datos: ${JSON.stringify(citaReprogramada)}`;
    } else if (finalPayload.horarios.length === 0) {
      Logger.info('[RescheduleAppointment] Sin disponibilidad para reprogramar');
      toolOutput = `#reprogramarCita\nLo siento, en este momento no hay horarios disponibles para el día solicitado. ¿Te gustaría buscar otro día o franja horaria?`;
    } else {
      Logger.info('[RescheduleAppointment] Horarios disponibles encontrados', { finalPayload });
      toolOutput = `#reprogramarCita\nLo siento, parece que ocurrió un problema. Por favor, ¿Podrías repetirnos tu horario o escoger otro?`;
    }

    Logger.info('[RescheduleAppointment] Ejecución completada', { success: true });
    return {
      success: true,
      toolOutput,
      needsConfirmation: citaReprogramada?.isSoon || false,
      updatedAppointmentId: citaReprogramada?.id_cita,
    };
  }
}