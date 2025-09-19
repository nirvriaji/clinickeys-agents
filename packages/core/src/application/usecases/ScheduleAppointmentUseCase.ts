// packages/core/src/application/usecases/ScheduleAppointmentUseCase.ts

import { isAppointmentSoon, getClinicLocalTimestamp, formatFechaCita, PATIENT_FIRST_NAME, PATIENT_LAST_NAME, PATIENT_PHONE } from '@clinickeys-agents/core/utils';
import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { readFile } from 'fs/promises';
import type { DateTime } from 'luxon';
import path from 'path';

import {
  KommoService,
  AppointmentService,
  AvailabilityService,
  PatientService,
  OpenAIService,
  PackBonoService,
} from '@clinickeys-agents/core/application/services';

interface ScheduleAppointmentInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  params: {
    id_paciente?: number;
    shouldCreatePatient: boolean;
    nombre: string;
    apellido: string;
    telefono: string;
    tratamiento: string;
    medico?: string | null;
    espacio?: string | null;
    fechas: string;
    horas: string;
    rango_dias_extra?: number | null;
    summary: string;
    isThirdParty: boolean;
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
}

export class ScheduleAppointmentUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly appointmentService: AppointmentService,
    private readonly availabilityService: AvailabilityService,
    private readonly patientService: PatientService,
    private readonly openAIService: OpenAIService,
    private readonly packBonoService: PackBonoService,
  ) {}

  public async execute(input: ScheduleAppointmentInput): Promise<ScheduleAppointmentOutput> {
    const { botConfig, leadId, normalizedLeadCF, params, timezone, tiempoActualDT, subdomain } = input;
    const { id_paciente, shouldCreatePatient, nombre, apellido, telefono, tratamiento, medico, fechas, horas, summary } = params;

    const localTimeForPrompts = getClinicLocalTimestamp(tiempoActualDT, timezone);

    Logger.info('[ScheduleAppointment] Inicio', { leadId, nombre, apellido, telefono, tratamiento, medico, id_paciente, shouldCreatePatient });

    Logger.debug('[ScheduleAppointment] Enviando mensaje inicial al bot');
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message: 'Muy bien, voy a agendar tu cita. Un momento por favor.',
    });

    let finalPatientId = id_paciente;

    if (!finalPatientId && shouldCreatePatient) {
      Logger.info('[ScheduleAppointment] Creando nuevo paciente');
      finalPatientId = await this.patientService.createPatient({
        nombre,
        apellido,
        telefono,
        id_clinica: botConfig.clinicId,
        id_super_clinica: botConfig.superClinicId,
        kommo_lead_id: leadId,
      });
      Logger.info(`[ScheduleAppointment] Paciente creado con ID: ${finalPatientId}`);
    }

    if (!finalPatientId) {
      Logger.error('[ScheduleAppointment] No se pudo determinar un paciente válido');
      return {
        success: false,
        toolOutput: '#agendarCita\nNo se pudo identificar o crear un paciente válido para agendar la cita.',
      };
    }

    const STEPS = [
      { tipo: 'original', filtros: { con_medico: !!medico, rango_dias_extra: 0 }, params: { ...params } },
      { tipo: 'ampliada_mismo_medico', filtros: { con_medico: !!medico, rango_dias_extra: 45 }, params: { ...params, rango_dias_extra: 45 } },
      { tipo: 'ampliada_sin_medico_rango_dias_original', filtros: { con_medico: false, rango_dias_extra: 0 }, params: { ...params, medico: null } },
      { tipo: 'ampliada_sin_medico_rango_dias_extendido', filtros: { con_medico: false, rango_dias_extra: 45 }, params: { ...params, medico: null, rango_dias_extra: 45 } },
    ];

    let finalPayload: any = null;
    let appointmentCreated: any = null;

    for (const step of STEPS) {
      Logger.debug('[ScheduleAppointment] Buscando disponibilidad', { step: step.tipo, filtros: step.filtros });
      const fechasStep = step.filtros.rango_dias_extra
        ? `${Array.isArray(fechas) ? JSON.stringify(fechas) : fechas}, los próximos 45 días`
        : fechas;

      let availability = await this.availabilityService.getAvailabilityInfo({
        localTimeForPrompts,
        id_clinica: botConfig.clinicId,
        id_super_clinica: botConfig.superClinicId,
        tiempo_actual: tiempoActualDT.toISO() as string,
        mensajeBotParlante: JSON.stringify({
          tratamiento: step.params.tratamiento,
          fechas: fechasStep,
          horas,
          medico: step.params.medico,
          espacio: step.params.espacio,
        }),
        subdomain,
        leadId,
        contextoDisponibilidades: botConfig?.placeholders?.CONFIGURACION_DE_DISPONIBILIDADES || "",
      });

      Logger.info('[ScheduleAppointment] Disponibilidad recibida', { success: availability.success, presentacion_disponibilidades: availability.presentacion_disponibilidades });

      if (availability.success && availability.presentacion_disponibilidades) {
        finalPayload = {
          tipo_busqueda: step.tipo,
          filtros_aplicados: step.filtros,
          horarios: availability.disponibilidades,
          tratamiento: { id: null, nombre: step.params.tratamiento },
          horarios_texto: availability.presentacion_disponibilidades,
        };

        Logger.debug('[ScheduleAppointment] FinalPayload con horarios disponibles', { finalPayload });

        const extractorPrompt = `#agendarCita\n\nTIEMPO_ACTUAL: ${localTimeForPrompts}\n\nLos HORARIOS_DISPONIBLES para citas son: ${JSON.stringify(finalPayload)}\n\nMENSAJE_USUARIO: ${JSON.stringify(params)}`;
        Logger.debug('[ScheduleAppointment] Extractor prompt', extractorPrompt);
        const systemPrompt = await readFile(
          path.resolve(__dirname, 'packages/core/src/.ia/instructions/prompts/bot_extractor_de_datos.md'),
          'utf8',
        );
        const extractorData = await this.openAIService.getJsonStructuredResponse(systemPrompt, extractorPrompt);
        Logger.debug('[ScheduleAppointment] Extractor de datos ejecutando', extractorData);

        if (extractorData.success) {
          Logger.debug('[ScheduleAppointment] Datos extraídos con éxito', { extractorData });
          const spResponse = await this.appointmentService.insertarCitaPackBonos({
            p_id_clinica: botConfig.clinicId,
            p_id_super_clinica: botConfig.superClinicId,
            p_id_paciente: finalPatientId,
            p_id_medico: extractorData.id_medico,
            p_id_espacio: extractorData.id_espacio,
            p_id_tratamiento: extractorData.id_tratamiento,
            p_id_pack_bono: extractorData.id_pack_bono || 0,
            p_id_presupuesto: extractorData.id_presupuesto || 0,
            p_fecha_cita: extractorData.fecha_cita,
            p_hora_inicio: extractorData.hora_inicio,
            p_hora_fin: extractorData.hora_fin,
            p_comentario_ia: summary,
          });
          const id_cita = spResponse?.[0]?.[0]?.id_cita;

          if (id_cita) {
            Logger.info('[ScheduleAppointment] Cita creada', { id_cita });
            await this.packBonoService.procesarPackbonoPresupuestoDeCita('on_crear_cita', id_cita);
            appointmentCreated = { ...extractorData, id_cita };

            const isSoon = isAppointmentSoon(
              appointmentCreated.fecha_cita,
              tiempoActualDT.toISO() as string,
              botConfig.timezone
            );
            appointmentCreated.isSoon = isSoon;

            finalPayload.needsConfirmation = isSoon;
            finalPayload.createdAppointmentId = id_cita;
          }
        } else {
          Logger.error('[ScheduleAppointment] Error al extraer datos con IA', { extractorData });
        }
        break;
      }
    }

    if (!finalPayload) {
      Logger.warn('[ScheduleAppointment] No se encontró disponibilidad en ningún paso');
      finalPayload = {
        horarios: [],
        horarios_texto: [],
        tipo_busqueda: 'sin_disponibilidad',
        filtros_aplicados: { con_medico: !!medico, rango_dias_extra: 0 },
        tratamiento: { id: null, nombre: tratamiento },
      };
    }

    let toolOutput: string;
    if (appointmentCreated?.id_cita) {
      const fechaLegible = formatFechaCita(appointmentCreated.fecha_cita);
      const doctorLine = medico && appointmentCreated.nombre_medico ? `\n- El médico es “${appointmentCreated.nombre_medico} ${appointmentCreated.apellido_medico}”.` : '';
      toolOutput = `#agendarCita\n- La cita de “${appointmentCreated.nombre_tratamiento}” ha sido agendada para el ${fechaLegible} a las ${appointmentCreated.hora_inicio}.${doctorLine}`;
    } else if (finalPayload.horarios.length == 0) {
      toolOutput = '#agendarCita\nLo siento, en este momento no hay horarios disponibles para el día solicitado. ¿Te gustaría buscar otro día o franja horaria?';
    } else {
      toolOutput = `#agendarCita\nLo siento, parece que ocurrió un problema. Por favor, ¿Podrías repetirnos tu horario o escoger otro?`;
    }

    const customFields = {
      [PATIENT_FIRST_NAME]: nombre,
      [PATIENT_LAST_NAME]: apellido,
      [PATIENT_PHONE]: telefono,
    };

    Logger.info('[ScheduleAppointment] Ejecución completada', { success: true });

    return {
      success: true,
      toolOutput,
      customFields,
      createdAppointmentId: appointmentCreated?.id_cita,
      needsConfirmation: appointmentCreated?.isSoon || false,
    };
  }
}