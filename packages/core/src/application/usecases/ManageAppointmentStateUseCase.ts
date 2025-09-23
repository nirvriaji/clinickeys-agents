// packages/core/src/application/usecases/ManageAppointmentStateUseCase.ts

import { AppointmentService } from '@clinickeys-agents/core/application/services';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';

export type AppointmentState = "CANCELADA" | "CONFIRMADA" | "EN_CAMINO";

interface ManageAppointmentStateInput {
  leadId: number;
  params: {
    id_cita: number;
    estado: AppointmentState;
    summary: string;
  };
}

interface ManageAppointmentStateOutput {
  success: boolean;
  toolOutput: string;
}

// Estados según base de datos / dominio
const STATE_CODES = {
  CANCELADA: { field: "id_estado_cita", value: 2 },
  CONFIRMADA: { field: "id_estados_cita_in", value: 36 },
  EN_CAMINO: { field: "id_estados_cita_in", value: 10 },
};

/**
 * Caso de uso unificado para manejar el estado de una cita:
 * - Cancelar
 * - Confirmar
 * - Marcar en camino
 */
export class ManageAppointmentStateUseCase {
  constructor(private readonly appointmentService: AppointmentService) {}

  public async execute(input: ManageAppointmentStateInput): Promise<ManageAppointmentStateOutput> {
    const { leadId, params } = input;
    const { id_cita, estado, summary } = params;

    Logger.info('[ManageAppointmentState] Inicio', { leadId, id_cita, estado });

    if (!id_cita) {
      Logger.warn('[ManageAppointmentState] id_cita no proporcionado');
      return {
        success: false,
        toolOutput: `#gestionarEstadoCita\nNo se pudo identificar la cita que deseas gestionar. ¿Podrías confirmarme?`
      };
    }

    const config = STATE_CODES[estado];
    if (!config) {
      Logger.error('[ManageAppointmentState] Estado no soportado', { estado });
      return {
        success: false,
        toolOutput: `#gestionarEstadoCita\nEl estado "${estado}" no es válido.`
      };
    }

    Logger.debug('[ManageAppointmentState] Actualizando cita en BD', { id_cita, estado, field: config.field, value: config.value });
    await this.appointmentService.updateAppointment({
      id_cita,
      [config.field]: config.value,
      comentario_ia: summary,
    } as any);

    Logger.info('[ManageAppointmentState] Estado actualizado con éxito', { id_cita, estado });

    const toolOutput = `#gestionarEstadoCita\nLa cita ${id_cita} fue actualizada al estado ${estado}.`;
    return { success: true, toolOutput };
  }
}
