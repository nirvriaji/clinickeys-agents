// packages/core/src/application/usecases/CheckReprogramAvailabilityUseCase.ts

import { AvailabilityService, KommoService, OpenAIService } from '@clinickeys-agents/core/application/services';
import { getClinicLocalTimestamp } from '@clinickeys-agents/core/utils';
import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { DateTime } from 'luxon';

interface CheckReprogramAvailabilityInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  params: {
    id_paciente: number;
    nombre: string;
    apellido: string;
    telefono: string;
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

interface CheckReprogramAvailabilityOutput {
  success: boolean;
  toolOutput: string;
}

export class CheckReprogramAvailabilityUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly availabilityService: AvailabilityService,
    private readonly openAIService: OpenAIService,
  ) { }

  public async execute(input: CheckReprogramAvailabilityInput): Promise<CheckReprogramAvailabilityOutput> {
    const {
      botConfig,
      leadId,
      normalizedLeadCF,
      params,
      timezone,
      tiempoActualDT,
      subdomain,
    } = input;

    const {
      id_paciente,
      nombre,
      apellido,
      telefono,
      id_cita,
      tratamiento,
      medico,
      id_medico,
      id_tratamiento,
      fechas,
      horas,
      summary,
    } = params;

    const localTimeForPrompts = getClinicLocalTimestamp(tiempoActualDT, timezone);

    Logger.info('[CheckReprogramAvailability] Inicio', {
      leadId,
      id_paciente,
      nombre,
      apellido,
      telefono,
      id_cita,
      tratamiento,
      medico,
      id_medico,
      fechas,
      horas,
    });

    // 1. Mensaje inicial
    Logger.debug('[CheckReprogramAvailability] Enviando mensaje inicial al bot');
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message: 'Muy bien, voy a revisar los horarios para reprogramar tu cita. Un momento por favor.',
    });

    // 2. Estrategia escalonada de disponibilidad
    const STEPS = [
      { tipo: 'original', filtros: { con_medico: true, rango_dias_extra: 0 }, params: { ...params } },
      { tipo: 'ampliada_mismo_medico', filtros: { con_medico: true, rango_dias_extra: 45 }, params: { ...params, rango_dias_extra: 45 } },
      { tipo: 'ampliada_sin_medico_rango_dias_original', filtros: { con_medico: false, rango_dias_extra: 0 }, params: { ...params, medico: null, id_medico: null } },
      { tipo: 'ampliada_sin_medico_rango_dias_extendido', filtros: { con_medico: false, rango_dias_extra: 45 }, params: { ...params, medico: null, id_medico: null, rango_dias_extra: 45 } },
    ];

    let finalPayload: any = null;
    let fechas_buscadas: any = null;

    for (const step of STEPS) {
      Logger.debug('[CheckReprogramAvailability] Buscando disponibilidad', { step: step.tipo, filtros: step.filtros });

      const fechasStep = step.filtros.rango_dias_extra
        ? `${Array.isArray(fechas) ? JSON.stringify(fechas) : fechas}, los próximos 45 días`
        : fechas;

      let availability = await this.availabilityService.getAvailabilityInfo({
        localTimeForPrompts,
        id_clinica: botConfig.clinicId,
        id_super_clinica: botConfig.superClinicId,
        tiempo_actual: tiempoActualDT.toISO() as string,
        mensajeBotParlante: JSON.stringify({
          summary,
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
        leadId,
        contextoDisponibilidades: botConfig?.placeholders?.CONFIGURACION_DE_DISPONIBILIDADES || "",
      });

      fechas_buscadas = availability.fechas_buscadas;

      Logger.info(`[CheckReprogramAvailability] Paso '${step.tipo}' respuesta recibida`, {
        success: availability.success,
        presentacion_disponibilidades: availability.presentacion_disponibilidades,
      });

      if (availability.success && availability.presentacion_disponibilidades) {
        finalPayload = {
          tipo_busqueda: step.tipo,
          filtros_aplicados: step.filtros,
          paciente: { id_paciente, nombre, apellido, telefono },
          cita: { id_cita },
          tratamiento: { id: step.params.id_tratamiento ?? null, nombre: step.params.tratamiento },
          horarios_texto: availability.presentacion_disponibilidades,
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
        paciente: { id_paciente, nombre, apellido, telefono },
        cita: { id_cita },
        tratamiento: { id: id_tratamiento ?? null, nombre: tratamiento },
        horarios_texto: [],
      };
    }

    // 3. Construir toolOutput para resolver run
    const toolOutput = `#consultaReprogramar
    TIEMPO_LOCAL: ${localTimeForPrompts}
    PACIENTE: ${JSON.stringify({id_paciente, nombre, apellido, telefono,})}
    CITA: ${JSON.stringify({ id_cita })}
    DISCLAIMER_FECHAS_BUSCADAS: Se buscaron solo las siguientes fechas ${JSON.stringify(fechas_buscadas)}
    HORARIOS_DISPONIBLES: ${JSON.stringify(finalPayload)}
    MENSAJE_USUARIO: ${JSON.stringify(params)}
    `;

    Logger.info('[CheckReprogramAvailability] Ejecución completada', { success: true });
    return { success: true, toolOutput };
  }
}
