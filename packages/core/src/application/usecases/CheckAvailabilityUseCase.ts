// packages/core/src/application/usecases/CheckAvailabilityUseCase.ts

import { getActualTimeForPrompts } from '@clinickeys-agents/core/utils';
import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { AvailabilityService, KommoService } from '@clinickeys-agents/core/application/services';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import type { DateTime } from 'luxon';

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
  customFields?: Record<string, string>;
}

export class CheckAvailabilityUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  public async execute(input: CheckAvailabilityInput): Promise<CheckAvailabilityOutput> {
    const { botConfig, leadId, normalizedLeadCF, params, timezone, tiempoActualDT, subdomain } = input;
    const { tratamiento, medico, fechas, horas, summary } = params;

    const actualTimeForPrompts = getActualTimeForPrompts(tiempoActualDT, timezone);

    Logger.info('[CheckAvailability] Inicio', { leadId, tratamiento, medico, fechas, horas });

    // 1. Mensaje inicial "please-wait"
    Logger.debug('[CheckAvailability] Enviando mensaje inicial al bot');
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message: 'Muy bien, voy a mirar la agenda para ver las citas que tenemos disponibles. Un momento por favor.',
    });

    // 2. Estrategia escalonada
    const STEPS = [
      { tipo: 'original', filtros: { con_medico: !!medico, rango_dias_extra: 0 }, params: { ...params } },
      { tipo: 'ampliada_mismo_medico', filtros: { con_medico: !!medico, rango_dias_extra: 45 }, params: { ...params, rango_dias_extra: 45 } },
      { tipo: 'ampliada_sin_medico_rango_dias_original', filtros: { con_medico: false, rango_dias_extra: 0 }, params: { ...params, medico: null } },
      { tipo: 'ampliada_sin_medico_rango_dias_extendido', filtros: { con_medico: false, rango_dias_extra: 45 }, params: { ...params, medico: null, rango_dias_extra: 45 } },
    ];

    let finalPayload: any = null;
    let fechas_buscadas: any = null;

    for (const step of STEPS) {
      Logger.debug('[CheckAvailability] Buscando disponibilidad', { step: step.tipo, filtros: step.filtros });
      const fechasStep = step.filtros.rango_dias_extra
        ? `${Array.isArray(fechas) ? JSON.stringify(fechas) : fechas}, los próximos 45 días`
        : fechas;

      let availability = await this.availabilityService.getAvailabilityInfo({
        actualTimeForPrompts,
        id_clinica: botConfig.clinicId,
        id_super_clinica: botConfig.superClinicId,
        tiempo_actual: tiempoActualDT.toISO() as string,
        mensajeBotParlante: JSON.stringify({
          tratamiento,
          fechas: fechasStep,
          horas,
          medico: step.params.medico,
          espacio: step.params.espacio,
          summary,
        }),
        subdomain,
        leadId,
        contextoDisponibilidades: botConfig?.placeholders?.CONFIGURACION_DE_DISPONIBILIDADES || "",
      });
      Logger.info(`[CheckAvailability] Paso '${step.tipo}' respuesta recibida`, { success: availability.success, presentacion_disponibilidades: availability.presentacion_disponibilidades });

      fechas_buscadas = availability.fechas_buscadas;

      if (availability.success && availability.presentacion_disponibilidades) {
        finalPayload = {
          tipo_busqueda: step.tipo,
          filtros_aplicados: step.filtros,
          tratamiento: { id: null, nombre: tratamiento },
          horarios_texto: availability.presentacion_disponibilidades,
        };
        Logger.debug('[CheckAvailability] Disponibilidad encontrada', { finalPayload });
        break;
      }
    }

    if (!finalPayload) {
      Logger.warn('[CheckAvailability] No se encontró disponibilidad en ningún paso');
      finalPayload = {
        tipo_busqueda: 'sin_disponibilidad',
        filtros_aplicados: { con_medico: !!medico, rango_dias_extra: 0 },
        tratamiento: { id: null, nombre: tratamiento },
        horarios_texto: [],
      };
    }

    // 3. Construir toolOutput
    const toolOutput = `#consultaAgendar
    TIEMPO_ACTUAL: ${actualTimeForPrompts}
    DISCLAIMER_FECHAS_BUSCADAS: Se buscaron solo las siguientes fechas ${JSON.stringify(fechas_buscadas)}
    HORARIOS_DISPONIBLES: ${JSON.stringify(finalPayload)}
    MENSAJE_USUARIO: ${JSON.stringify(params)}
    `;
    Logger.info('[CheckAvailability] Ejecución completada', { success: true });

    return { success: true, toolOutput };
  }
}