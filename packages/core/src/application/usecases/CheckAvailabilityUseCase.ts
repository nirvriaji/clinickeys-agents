// packages/core/src/application/usecases/CheckAvailabilityUseCase.ts

import { AvailabilityRequestExtractorService, AvailabilityFilterResult } from '@clinickeys-agents/core/application/services';
import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { AvailabilityDomainService, KommoService } from '@clinickeys-agents/core/application/services';
import { ITratamientoRepository } from '@clinickeys-agents/core/domain/tratamiento';
import { IMedicoRepository } from '@clinickeys-agents/core/domain/medico';
import { IEspacioRepository } from '@clinickeys-agents/core/domain/espacio';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { getClinicLocalTimestamp } from '@clinickeys-agents/core/utils';
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
}

interface StepDefinition {
  tipo: string;
  filtros: { con_medico: boolean; rango_dias_extra: number; rango_dias_antes?: number };
  params: AvailabilityFilterResult & { rango_dias_extra?: number; rango_dias_antes?: number };
}

export class CheckAvailabilityUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly availabilityService: AvailabilityDomainService,
    private readonly availabilityRequestExtractorService: AvailabilityRequestExtractorService,
    private readonly tratamientoRepositoryMySQL: ITratamientoRepository,
    private readonly medicoRepositoryMySQL: IMedicoRepository,
    private readonly espacioRepositoryMySQL: IEspacioRepository,
  ) { }

  public async execute(input: CheckAvailabilityInput): Promise<CheckAvailabilityOutput> {
    const { botConfig, leadId, normalizedLeadCF, params, timezone, tiempoActualDT, subdomain } = input;
    const { tratamiento, medico, espacio, fechas, horas, summary } = params;

    const localTimeForPrompts = getClinicLocalTimestamp(tiempoActualDT, timezone);

    Logger.info('[CheckAvailability] Inicio', { leadId, tratamiento, medico, espacio, fechas, horas });

    // 1. Mensaje inicial "please-wait"
    Logger.debug('[CheckAvailability] Enviando mensaje inicial al bot');
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message: 'Muy bien, voy a mirar la agenda para ver las citas que tenemos disponibles. Un momento por favor.',
    });

    // 2. Obtener filtros estructurados antes de los STEPS
    const tratamientos = await this.tratamientoRepositoryMySQL.getActiveTreatmentsForClinic(
      botConfig.clinicId,
      botConfig.superClinicId
    );
    const nombresTratamientos = tratamientos.map((t) => t.nombre_tratamiento);
    const medicos = await this.medicoRepositoryMySQL.getMedicos(
      botConfig.clinicId,
      botConfig.superClinicId
    );
    const nombresMedicos = medicos.map((m) => m.nombre_completo);
    const espacios = await this.espacioRepositoryMySQL.findByClinica(botConfig.clinicId);
    const nombresEspacios = espacios.map((e) => e.nombre);

    Logger.debug('[CheckAvailability] Extrayendo filtros estructurados');
    const structuredFilters = await this.availabilityRequestExtractorService.extract(JSON.stringify(params), {
      id_clinica: botConfig.clinicId,
      id_super_clinica: botConfig.superClinicId,
      tiempo_actual: tiempoActualDT.toISO() as string,
      localTimeForPrompts,
      tratamientosDisponibles: nombresTratamientos,
      medicosDisponibles: nombresMedicos,
      espaciosDisponibles: nombresEspacios,
    });

    let finalPayload: any = null;
    let fechas_buscadas: any = null;

    for (const filter of structuredFilters) {
      const firstFecha = filter.fechas?.[0]?.fecha;

      const steps: StepDefinition[] = [];

      // Paso original
      steps.push({
        tipo: 'original',
        filtros: { con_medico: !!filter.medicos.length, rango_dias_extra: 0 },
        params: { ...filter },
      });

      // Paso intermedio: desde hoy hasta la primera fecha solicitada
      if (firstFecha) {
        const diffDias = Math.max(0, Math.floor((new Date(firstFecha).getTime() - tiempoActualDT.toJSDate().getTime()) / (1000 * 60 * 60 * 24)));
        steps.push({
          tipo: 'intermedio_hasta_fecha',
          filtros: { con_medico: !!filter.medicos.length, rango_dias_extra: 0, rango_dias_antes: diffDias },
          params: { ...filter, rango_dias_antes: diffDias },
        });
      }

      // Paso ampliado con mismo médico
      steps.push({
        tipo: 'ampliada_mismo_medico',
        filtros: { con_medico: !!filter.medicos.length, rango_dias_extra: 45 },
        params: { ...filter, rango_dias_extra: 45 },
      });

      // Paso sin médico con rango original
      steps.push({
        tipo: 'ampliada_sin_medico_rango_dias_original',
        filtros: { con_medico: false, rango_dias_extra: 0 },
        params: { ...filter, medicos: [] },
      });

      // Paso sin médico con rango extendido
      steps.push({
        tipo: 'ampliada_sin_medico_rango_dias_extendido',
        filtros: { con_medico: false, rango_dias_extra: 45 },
        params: { ...filter, medicos: [], rango_dias_extra: 45 },
      });

      for (const step of steps) {
        Logger.debug('[CheckAvailability] Buscando disponibilidad', { step: step.tipo, filtros: step.filtros });

        const fechasStep = step.filtros.rango_dias_extra === 45
          ? `${JSON.stringify(filter.fechas)}, los próximos 45 días`
          : JSON.stringify(filter.fechas);

        const availability = await this.availabilityService.getAvailabilityInfo({
          localTimeForPrompts,
          id_clinica: botConfig.clinicId,
          id_super_clinica: botConfig.superClinicId,
          tiempo_actual: tiempoActualDT.toISO() as string,
          mensajeBotParlante: JSON.stringify({
            tratamiento,
            fechas: fechasStep,
            horas,
            medico: step.params.medicos?.[0] || null,
            espacio: step.params.espacios?.[0] || null,
            summary,
          }),
          subdomain,
          leadId,
          contextoDisponibilidades: botConfig?.placeholders?.CONFIGURACION_DE_DISPONIBILIDADES || "",
        });

        Logger.info(`[CheckAvailability] Paso '${step.tipo}' respuesta recibida`, { success: availability.success, presentacion_disponibilidades: availability.presentacion_disponibilidades });

        fechas_buscadas = availability.fechas_buscadas;

        if (availability.success && availability.disponibilidades.length) {
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

      if (finalPayload) break;
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
    const toolOutput = `#consultaAgendar\n    TIEMPO_LOCAL: ${localTimeForPrompts}\n    DISCLAIMER_FECHAS_BUSCADAS: Se buscaron solo las siguientes fechas ${JSON.stringify(fechas_buscadas)}\n    HORARIOS_DISPONIBLES: ${JSON.stringify(finalPayload)}\n    MENSAJE_USUARIO: ${JSON.stringify(params)}\n    `;
    Logger.info('[CheckAvailability] Ejecución completada', { success: true });

    return { success: true, toolOutput };
  }
}