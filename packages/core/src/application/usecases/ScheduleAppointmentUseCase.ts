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
import { ITratamientoRepository } from '@clinickeys-agents/core/domain/tratamiento';
import { IMedicoRepository } from '@clinickeys-agents/core/domain/medico';
import { IEspacioRepository } from '@clinickeys-agents/core/domain/espacio';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { readFile } from 'fs/promises';
import type { DateTime } from 'luxon';
import path from 'path';

import {
  KommoService,
  AppointmentService,
  AvailabilityDomainService,
  PatientService,
  OpenAIService,
  PackBonoService,
  AvailabilityRequestExtractorService,
} from '@clinickeys-agents/core/application/services';
import { AvailabilityFilterResult } from '@clinickeys-agents/core/application/services';

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
    fechas: string | string[];
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

interface StepDefinition {
  tipo: string;
  filtros: { con_medico: boolean; rango_dias_extra: number; rango_dias_antes?: number };
  params: AvailabilityFilterResult & { rango_dias_extra?: number; rango_dias_antes?: number };
}

export class ScheduleAppointmentUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly appointmentService: AppointmentService,
    private readonly availabilityService: AvailabilityDomainService,
    private readonly patientService: PatientService,
    private readonly openAIService: OpenAIService,
    private readonly packBonoService: PackBonoService,
    private readonly availabilityRequestExtractorService: AvailabilityRequestExtractorService,
    private readonly tratamientoRepositoryMySQL: ITratamientoRepository,
    private readonly medicoRepositoryMySQL: IMedicoRepository,
    private readonly espacioRepositoryMySQL: IEspacioRepository,
  ) {}

  public async execute(input: ScheduleAppointmentInput): Promise<ScheduleAppointmentOutput> {
    const { botConfig, leadId, normalizedLeadCF, params, timezone, tiempoActualDT, subdomain } = input;
    const {
      id_paciente,
      shouldCreatePatient,
      nombre,
      apellido,
      telefono,
      tratamiento,
      medico,
      fechas,
      horas,
      summary,
    } = params;

    const localTimeForPrompts = getClinicLocalTimestamp(tiempoActualDT, timezone);

    Logger.info('[ScheduleAppointment] Inicio', {
      leadId,
      nombre,
      apellido,
      telefono,
      tratamiento,
      medico,
      id_paciente,
      shouldCreatePatient,
    });

    // Mensaje inicial al bot
    Logger.debug('[ScheduleAppointment] Enviando mensaje inicial al bot');
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message: 'Muy bien, voy a agendar tu cita. Un momento por favor.',
    });

    // =============================
    // 1) Paciente
    // =============================
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
      Logger.info('[ScheduleAppointment] Paciente creado', { finalPatientId });
    }

    if (!finalPatientId) {
      Logger.error('[ScheduleAppointment] No se pudo determinar un paciente válido');
      return {
        success: false,
        toolOutput: '#agendarCita\nNo se pudo identificar o crear un paciente válido para agendar la cita.',
      };
    }

    // =============================
    // 2) Catálogos para el extractor de filtros
    // =============================
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

    // =============================
    // 3) Filtros estructurados desde el mensaje del usuario
    // =============================
    Logger.debug('[ScheduleAppointment] Extrayendo filtros estructurados');
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

    // Configuración de agenda (texto libre)
    const configuracion_disponibilidades = botConfig?.placeholders?.ASISTENTE_AGENDA_CONFIG || '';

    // =============================
    // 5) Estrategia por STEPs (similar a CheckAvailability, orientado a agendar)
    // =============================
    let finalPayload: Record<string, unknown> | null = null;
    let appointmentCreated: Record<string, any> | null = null;

    for (const filter of structuredFilters as AvailabilityFilterResult[]) {
      const firstFecha = filter.fechas?.[0]?.fecha;

      const steps: StepDefinition[] = [];

      steps.push({
        tipo: 'original',
        filtros: { con_medico: !!(filter.medicos && filter.medicos.length), rango_dias_extra: 0 },
        params: { ...filter },
      });

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
          filtros: { con_medico: !!(filter.medicos && filter.medicos.length), rango_dias_extra: 0, rango_dias_antes: diffDias },
          params: { ...filter, rango_dias_antes: diffDias },
        });
      }

      steps.push({
        tipo: 'ampliada_mismo_medico',
        filtros: { con_medico: !!(filter.medicos && filter.medicos.length), rango_dias_extra: 45 },
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

      for (const step of steps) {
        Logger.debug('[ScheduleAppointment] Buscando disponibilidad', { step: step.tipo, filtros: step.filtros });

        const fechasStep = step.filtros.rango_dias_extra === 45
          ? `${JSON.stringify(filter.fechas)}, los próximos 45 días`
          : JSON.stringify(filter.fechas);

        // Llamamos al flujo completo del dominio (Extractor->Calculator->Presenter->Redactor)
        const availability = await this.availabilityService.getAvailabilityInfo({
          localTimeForPrompts,
          id_clinica: botConfig.clinicId,
          id_super_clinica: botConfig.superClinicId,
          tiempo_actual: tiempoActualDT.toISO() as string,
          mensajeBotParlante: JSON.stringify({
            tratamiento: filter.tratamientos?.[0] || tratamiento,
            fechas: fechasStep,
            medico: filter.medicos?.[0] || null,
            espacio: filter.espacios?.[0] || null,
          }),
          subdomain,
          leadId,
          contextoDisponibilidades: configuracion_disponibilidades,
        });

        Logger.info('[ScheduleAppointment] Disponibilidad recibida', {
          success: availability.success,
          presentacion_disponibilidades: (availability.presentacion_disponibilidades || '').slice(0, 120),
          horarios_escogidos: (availability.horarios_escogidos || []).length,
        });

        // Avanzar solo si hay horarios concretos seleccionados
        if (availability.success && Array.isArray(availability.horarios_escogidos) && availability.horarios_escogidos.length > 0) {
          finalPayload = {
            tipo_busqueda: step.tipo,
            filtros_aplicados: step.filtros,
            horarios: availability.horarios_escogidos,
            tratamiento: { id: null, nombre: filter.tratamientos?.[0] || tratamiento },
            horarios_texto: availability.presentacion_disponibilidades || '',
          };

          Logger.debug('[ScheduleAppointment] FinalPayload con horarios seleccionados', {
            slots: (finalPayload as any).horarios?.length,
          });

          // =============================
          // 6) Extraer datos concretos de cita con IA (IDs y tiempos exactos)
          // =============================
          const extractorPrompt = `#agendarCita\n\nTIEMPO_ACTUAL: ${localTimeForPrompts}\n\nHORARIOS_DISPONIBLES_JSON: ${JSON.stringify(
            finalPayload,
          )}\n\nMENSAJE_USUARIO: ${JSON.stringify(params)}\n`;

          Logger.debug('[ScheduleAppointment] Extractor prompt (preview)', extractorPrompt.slice(0, 800));

          const systemPrompt = await readFile(
            path.resolve(
              __dirname,
              'packages/core/src/.ia/instructions/prompts/bot_extractor_de_datos.md',
            ),
            'utf8',
          );

          const extractorData = await this.openAIService.getJsonStructuredResponse(
            systemPrompt,
            extractorPrompt,
          );

          Logger.debug('[ScheduleAppointment] Resultado extractor de datos', extractorData);

          if (extractorData && extractorData.success) {
            Logger.debug('[ScheduleAppointment] Datos extraídos OK. Insertando cita…');

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

              // Marcar si la cita es pronto para confirmar
              if (appointmentCreated) {
                const isSoon = isAppointmentSoon(
                  appointmentCreated.fecha_cita,
                  tiempoActualDT.toISO() as string,
                  botConfig.timezone,
                );
                appointmentCreated.isSoon = isSoon;
              }
            } else {
              Logger.error('[ScheduleAppointment] No se obtuvo id_cita del SP');
            }
          } else {
            Logger.error('[ScheduleAppointment] Error al extraer datos con IA', { extractorData });
          }

          // Hayamos creado o no, dejamos de iterar pasos: ya hubo horarios seleccionados
          break;
        }
      }

      if (finalPayload) break; // dejar de iterar otros filtros si encontramos
    }

    // =============================
    // 7) Mensaje final / toolOutput
    // =============================
    if (!finalPayload) {
      Logger.warn('[ScheduleAppointment] No se encontró disponibilidad en ningún paso');
      finalPayload = {
        horarios: [],
        horarios_texto: '',
        tipo_busqueda: 'sin_disponibilidad',
        filtros_aplicados: { con_medico: !!medico, rango_dias_extra: 0 },
        tratamiento: { id: null, nombre: tratamiento },
      };
    }

    let toolOutput: string;

    if (appointmentCreated?.id_cita) {
      const fechaLegible = formatFechaCita(appointmentCreated.fecha_cita);
      const doctorLine = appointmentCreated.nombre_medico
        ? `\n- El médico es “${appointmentCreated.nombre_medico} ${appointmentCreated.apellido_medico}”.`
        : '';
      toolOutput = `#agendarCita\n- La cita de “${appointmentCreated.nombre_tratamiento}” ha sido agendada para el ${fechaLegible} a las ${appointmentCreated.hora_inicio}.${doctorLine}`;
    } else if ((finalPayload as any).horarios.length === 0) {
      toolOutput = '#agendarCita\nLo siento, en este momento no hay horarios disponibles para el día solicitado. ¿Te gustaría buscar otro día o franja horaria?';
    } else {
      toolOutput = '#agendarCita\nLo siento, parece que ocurrió un problema al confirmar la cita. ¿Podrías indicarnos otra opción de hora o día, por favor?';
    }

    const customFields = {
      [PATIENT_FIRST_NAME]: nombre,
      [PATIENT_LAST_NAME]: apellido,
      [PATIENT_PHONE]: telefono,
    };

    Logger.info('[ScheduleAppointment] Ejecución completada', {
      success: true,
      createdAppointmentId: appointmentCreated?.id_cita || null,
      needsConfirmation: appointmentCreated?.isSoon || false,
    });

    return {
      success: true,
      toolOutput,
      customFields,
      createdAppointmentId: appointmentCreated?.id_cita,
      needsConfirmation: appointmentCreated?.isSoon || false,
    };
  }
}