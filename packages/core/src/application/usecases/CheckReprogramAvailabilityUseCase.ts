// packages/core/src/application/usecases/CheckReprogramAvailabilityUseCase.ts

import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { AvailabilityService, KommoService } from '@clinickeys-agents/core/application/services';
import { ITratamientoRepository } from '@clinickeys-agents/core/domain/tratamiento';
import { IMedicoRepository } from '@clinickeys-agents/core/domain/medico';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { getClinicLocalTimestamp } from '@clinickeys-agents/core/utils';
import { DateTime } from 'luxon';
import { GetEstructuredAvailabilityRequestUseCase, AvailabilityFilterResult } from '@clinickeys-agents/core/application/usecases';

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
    fechas: string | string[];
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

interface ReprogramStepDefinition {
  tipo: string;
  filtros: { con_medico: boolean; rango_dias_extra: number; rango_dias_antes?: number };
  params: AvailabilityFilterResult & { rango_dias_extra?: number; rango_dias_antes?: number };
}

export class CheckReprogramAvailabilityUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly availabilityService: AvailabilityService,
    private readonly getEstructuredAvailabilityRequestUseCase: GetEstructuredAvailabilityRequestUseCase,
    private readonly tratamientoRepositoryMySQL: ITratamientoRepository,
    private readonly medicoRepositoryMySQL: IMedicoRepository,
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

    // 2. Obtener filtros estructurados desde el extractor
    Logger.debug('[CheckReprogramAvailability] Extrayendo filtros estructurados');
    const structuredFilters = await this.getEstructuredAvailabilityRequestUseCase.extract(JSON.stringify(params), {
      id_clinica: botConfig.clinicId,
      id_super_clinica: botConfig.superClinicId,
      tiempo_actual: tiempoActualDT.toISO() as string,
      localTimeForPrompts,
      tratamientosDisponibles: nombresTratamientos,
      medicosDisponibles: nombresMedicos
    });

    let finalPayload: Record<string, unknown> | null = null;
    let fechas_buscadas: string | null = null;

    for (const filter of structuredFilters) {
      const firstFecha = filter.fechas?.[0]?.fecha;

      const steps: ReprogramStepDefinition[] = [];

      steps.push({
        tipo: 'original',
        filtros: { con_medico: !!filter.medicos.length, rango_dias_extra: 0 },
        params: { ...filter },
      });

      if (firstFecha) {
        const diffDias = Math.max(0, Math.floor((new Date(firstFecha).getTime() - tiempoActualDT.toJSDate().getTime()) / (1000 * 60 * 60 * 24)));
        steps.push({
          tipo: 'intermedio_hasta_fecha',
          filtros: { con_medico: !!filter.medicos.length, rango_dias_extra: 0, rango_dias_antes: diffDias },
          params: { ...filter, rango_dias_antes: diffDias },
        });
      }

      steps.push({
        tipo: 'ampliada_mismo_medico',
        filtros: { con_medico: !!filter.medicos.length, rango_dias_extra: 45 },
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
        Logger.debug('[CheckReprogramAvailability] Buscando disponibilidad', { step: step.tipo, filtros: step.filtros });

        const fechasStep = step.filtros.rango_dias_extra === 45
          ? `${JSON.stringify(filter.fechas)}, los próximos 45 días`
          : JSON.stringify(filter.fechas);

        const availability = await this.availabilityService.getAvailabilityInfo({
          localTimeForPrompts,
          id_clinica: botConfig.clinicId,
          id_super_clinica: botConfig.superClinicId,
          tiempo_actual: tiempoActualDT.toISO() as string,
          mensajeBotParlante: JSON.stringify({
            summary,
            id_tratamiento: id_tratamiento,
            tratamiento: filter.tratamientos?.[0] || tratamiento,
            fechas: fechasStep,
            horas,
            medico: filter.medicos?.[0] || null,
            id_medico: id_medico ?? null,
            espacio: filter.espacios?.[0] || null,
            id_espacio: params.id_espacio ?? null,
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
            tratamiento: { id: id_tratamiento ?? null, nombre: tratamiento },
            horarios_texto: availability.presentacion_disponibilidades,
          };
          Logger.debug('[CheckReprogramAvailability] Disponibilidad encontrada', { finalPayload });
          break;
        }
      }

      if (finalPayload) break;
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
    const toolOutput = `#consultaReprogramar\n    TIEMPO_LOCAL: ${localTimeForPrompts}\n    PACIENTE: ${JSON.stringify({ id_paciente, nombre, apellido, telefono })}\n    CITA: ${JSON.stringify({ id_cita })}\n    DISCLAIMER_FECHAS_BUSCADAS: Se buscaron solo las siguientes fechas ${JSON.stringify(fechas_buscadas)}\n    HORARIOS_DISPONIBLES: ${JSON.stringify(finalPayload)}\n    MENSAJE_USUARIO: ${JSON.stringify(params)}\n    `;

    Logger.info('[CheckReprogramAvailability] Ejecución completada', { success: true });
    return { success: true, toolOutput };
  }
}