import { KommoService, AppointmentService, PackBonoService } from '@clinickeys-agents/core/application/services';
import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';

interface CancelAppointmentInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  params: {
    id_cita: number;
    id_medico?: number | null;
    id_espacio?: number | null;
    fecha_cita?: string;
    hora_inicio?: string;
    hora_fin?: string;
    summary: string;
  };
}

interface CancelAppointmentOutput {
  success: boolean;
  toolOutput: string;
}

export class CancelAppointmentUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly appointmentService: AppointmentService,
    private readonly packBonoService: PackBonoService,
  ) {}

  public async execute(input: CancelAppointmentInput): Promise<CancelAppointmentOutput> {
    const { botConfig, leadId, normalizedLeadCF, params } = input;
    const { id_cita, summary } = params;

    Logger.info('[CancelAppointment] Inicio', { leadId, id_cita });

    // 1. Mensaje inicial "please‑wait"
    Logger.debug('[CancelAppointment] Enviando mensaje inicial al bot');
    await this.kommoService.sendBotInitialMessage({
      leadId,
      salesbotId: botConfig.kommo.salesbotId,
      normalizedLeadCF,
      message: 'Muy bien, voy a cancelar tu cita. Un momento por favor.',
    });

    // 2. Validación mínima
    if (!id_cita) {
      Logger.warn('[CancelAppointment] id_cita no proporcionado');
      return {
        success: false,
        toolOutput: '#cancelarCita\nLo siento, no pude identificar la cita que deseas cancelar. ¿Podrías volver a indicarme?'
      };
    }

    // 3. Cancelar cita en BD
    Logger.debug('[CancelAppointment] Cancelando cita en base de datos', { id_cita });
    await this.appointmentService.cancelAppointment(id_cita, summary);

    // 4. Procesar packs‑bono / presupuestos
    Logger.debug('[CancelAppointment] Procesando packbono/presupuesto asociado', { id_cita });
    await this.packBonoService.procesarPackbonoPresupuestoDeCita('on_eliminar_cita', id_cita);

    // 5. Construir toolOutput
    const toolOutput = `#cancelarCita\nLa cita fue cancelada con éxito: ${JSON.stringify({ id_cita })}`;
    Logger.info('[CancelAppointment] Ejecución completada con éxito', { id_cita });

    return { success: true, toolOutput };
  }
}
