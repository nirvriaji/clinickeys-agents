// packages/core/src/application/usecases/MarkPatientOnTheWayUseCase.ts

import { Logger } from '@clinickeys-agents/core/infrastructure/external';

import { AppointmentService } from '@clinickeys-agents/core/application/services';

interface MarkOnTheWayInput {
  leadId: number;
  params: {
    id_cita: number;
    summary: string; // Comentario opcional proveniente del LLM/extractor
  };
}

interface MarkOnTheWayOutput {
  success: boolean;
  toolOutput: string;
}

// Estado "en camino" (columna: id_estados_cita_in)
const ID_ESTADOS_CITA_IN_EN_CAMINO = 10;

/**
 * Marca que el paciente va "en camino" para una cita existente, seteando id_estados_cita_in = 10
 * y registrando un comentario breve en la cita.
 */
export class MarkPatientOnTheWayUseCase {
  constructor(
    private readonly appointmentService: AppointmentService,
  ) {}

  public async execute(input: MarkOnTheWayInput): Promise<MarkOnTheWayOutput> {
    const { leadId, params } = input;
    const { id_cita, summary } = params;

    Logger.info('[MarkPatientOnTheWay] Inicio', { leadId, id_cita });

    await this.appointmentService.updateAppointment({
      id_cita,
      id_estados_cita_in: ID_ESTADOS_CITA_IN_EN_CAMINO,
      comentario_ia: summary,
    } as any); // as any: si tu tipo no expone aún id_estados_cita_in, extiéndelo en AppointmentService

    Logger.info('[MarkPatientOnTheWay] Estado actualizado a EN_CAMINO', { id_cita });

    // 3) toolOutput para el bot/consumidor
    const toolOutput = `#pacienteEnCamino\nTu cita sigue programada. Hemos notificado al equipo que vas en camino. (id_cita: ${id_cita}).`;

    return { success: true, toolOutput };
  }
}
