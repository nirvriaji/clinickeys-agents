// packages/core/src/application/usecases/CheckReprogramAvailabilityUseCase.ts

import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { AvailabilityService, KommoService } from '@clinickeys-agents/core/application/services';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { getActualTimeForPrompts } from '@clinickeys-agents/core/utils';
import { DateTime } from 'luxon';

import type { FetchPatientInfoUseCase } from './FetchPatientInfoUseCase';

import { filterAvailabilityByRestrictions } from '@clinickeys-agents/core/utils/availability/filterAvailabilityByRestrictions';

import { OpenAIService } from '@clinickeys-agents/core/application/services';

type PatientInfo = Awaited<ReturnType<FetchPatientInfoUseCase['execute']>>;

interface CheckReprogramAvailabilityInput {
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
  };
  timezone: string;
  tiempoActualDT: DateTime;
  subdomain: string;
}

interface CheckReprogramAvailabilityOutput {
  success: boolean;
  toolOutput: string;
  customFields?: Record<string, string>;
}

export class CheckReprogramAvailabilityUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly availabilityService: AvailabilityService,
    private readonly openAIService: OpenAIService,
  ) {}

  public async execute(input: CheckReprogramAvailabilityInput): Promise<CheckReprogramAvailabilityOutput> {
    const {
      botConfig,
      leadId,
      normalizedLeadCF,
      params,
      timezone,
      tiempoActualDT,
      subdomain,
      patientInfo
    } = input;

    const { tratamiento, medico, id_medico, id_tratamiento, fechas, horas } = params;

    Logger.info('[CheckReprogramAvailability] Inicio', { leadId, tratamiento, medico, id_medico, fechas, horas });

    // 1. Mensaje inicial "please-wait"
    Logger.debug('[CheckReprogramAvailability] Enviando mensaje inicial al bot');
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message: 'Muy bien, voy a revisar los horarios. Un momento por favor.',
    });

    // 2. Estrategia escalonada de disponibilidad
    const STEPS = [
      { tipo: 'original', filtros: { con_medico: true, rango_dias_extra: 0 }, params: { ...params } },
      { tipo: 'ampliada_mismo_medico', filtros: { con_medico: true, rango_dias_extra: 45 }, params: { ...params, rango_dias_extra: 45 } },
      { tipo: 'ampliada_sin_medico_rango_dias_original', filtros: { con_medico: false, rango_dias_extra: 0 }, params: { ...params, medico: null, id_medico: null } },
      { tipo: 'ampliada_sin_medico_rango_dias_extendido', filtros: { con_medico: false, rango_dias_extra: 45 }, params: { ...params, medico: null, id_medico: null, rango_dias_extra: 45 } },
    ];

    let finalPayload: any = null;

    for (const step of STEPS) {
      Logger.debug('[CheckReprogramAvailability] Buscando disponibilidad', { step: step.tipo, filtros: step.filtros });
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
      Logger.info(`[CheckReprogramAvailability] Paso '${step.tipo}' respuesta recibida`, { success: availability.success, count: availability.analisis_agenda?.length });

      // 2.1 Aplicar restricciones si existen
      if (availability.success && Array.isArray(availability.analisis_agenda) && availability.analisis_agenda.length > 0) {
        const restricciones = botConfig?.placeholders?.RESTRICCIONES_EN_DISPONIBILIDADES || "";
        const filtradas = await filterAvailabilityByRestrictions(
          this.openAIService,
          availability.analisis_agenda,
          restricciones
        );
        availability.analisis_agenda = filtradas;
      }

      if (
        availability.success &&
        Array.isArray(availability.analisis_agenda) &&
        availability.analisis_agenda.length > 0
      ) {
        finalPayload = {
          tipo_busqueda: step.tipo,
          filtros_aplicados: step.filtros,
          tratamiento: {
            id: step.params.id_tratamiento ?? null,
            nombre: step.params.tratamiento,
          },
          horarios: availability.analisis_agenda,
        };
        Logger.debug('[CheckReprogramAvailability] Disponibilidad encontrada', { finalPayload });
        break;
      }
    }

    if (!finalPayload) {
      Logger.warn('[CheckReprogramAvailability] No se encontró disponibilidad en ningún paso');
      finalPayload = {
        tipo_busqueda: 'sin_disponibilidad',
        filtros_aplicados: { con_medico: !!medico, rango_dias_extra: 0 },
        tratamiento: { id: id_tratamiento ?? null, nombre: tratamiento },
        horarios: [],
      };
    }

    // 3. Construir toolOutput para resolver run
    const actualTimeForPrompts = getActualTimeForPrompts(tiempoActualDT, timezone);
    const citasPacienteStr = JSON.stringify(patientInfo.appointments ?? []);
    const toolOutput = `#consultaReprogramar\nTIEMPO_ACTUAL: ${actualTimeForPrompts}\nCITAS_PACIENTE: ${citasPacienteStr}\nHORARIOS_DISPONIBLES: ${JSON.stringify(finalPayload)}\nMENSAJE_USUARIO: ${JSON.stringify(params)}`;
    Logger.info('[CheckReprogramAvailability] Ejecución completada', { success: true });

    return { success: true, toolOutput };
  }
}
