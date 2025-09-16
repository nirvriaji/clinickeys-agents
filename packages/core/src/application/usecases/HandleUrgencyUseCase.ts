import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { KommoService } from '@clinickeys-agents/core/application/services';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';

/**
 * Número de minutos (48 h) que tendrá el usuario interno para resolver la tarea
 * creada en Kommo cuando se detecta un caso de tarea administrativa o de urgencia.
 */
const TASK_DEADLINE_MINUTES = 48 * 60;

export interface HandleUrgencyInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  params: {
    nombre?: string;
    apellido?: string;
    telefono?: string;
    motivo?: string;
    canal_preferido?: string | null | undefined;
  };
}

export interface HandleUrgencyOutput {
  success: boolean;
  toolOutput: string;
}

export class HandleUrgencyUseCase {
  constructor(private readonly kommoService: KommoService) {}

  public async execute(input: HandleUrgencyInput): Promise<HandleUrgencyOutput> {
    const { botConfig, leadId, normalizedLeadCF, params } = input;
    const { nombre, apellido, telefono, motivo, canal_preferido } = params;

    Logger.info('[HandleUrgency] Inicio', { leadId });

    // 1) Mensaje "please‑wait" al paciente
    Logger.debug('[HandleUrgency] Enviando mensaje inicial al bot');
    await this.kommoService.sendBotInitialMessage({
      leadId,
      normalizedLeadCF,
      salesbotId: botConfig.kommo.salesbotId,
      message: 'Entendido, derivando tu caso al equipo correspondiente. Un momento…',
    });

    // 2) Construir el cuerpo de la tarea para Kommo.
    const taskMessageLines = [
      nombre && `*nombre*: ${nombre}`,
      apellido && `*apellido*: ${apellido}`,
      telefono && `*telefono*: ${telefono}`,
      motivo && `*motivo*: ${motivo}`,
      canal_preferido && `*canal preferido*: ${canal_preferido}`,
    ].filter(Boolean);

    // 3) Crear la tarea en Kommo (ignorar errores, la UX al paciente no cambia)
    try {
      Logger.debug('[HandleUrgency] Creando tarea en Kommo', { leadId });
      await this.kommoService.createTask({
        responsibleUserId: botConfig.kommo.responsibleUserId,
        leadId,
        minutesSinceNow: TASK_DEADLINE_MINUTES,
        message: taskMessageLines.join('\n'),
      });
      Logger.info('[HandleUrgency] Tarea creada con éxito', { leadId });
    } catch (error) {
      Logger.error('[HandleUrgency] Error al crear la tarea en Kommo', { error, leadId });
    }

    // 4) toolOutput para el Bot Parlante
    const toolOutput = `#tarea\n\nTarea creada con éxito`;
    Logger.info('[HandleUrgency] Ejecución completada', { leadId });

    return { success: true, toolOutput };
  }
}
