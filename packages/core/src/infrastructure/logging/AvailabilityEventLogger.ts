import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { AvailabilityEvent } from "@clinickeys-agents/core/domain/availability";

/**
 * Servicio responsable de registrar los eventos de disponibilidad.
 * Separa la lógica de logging del dominio para mantener la arquitectura limpia.
 */
export class AvailabilityEventLogger {
  /**
   * Registra un evento de disponibilidad en el log correspondiente.
   * @param event Evento a registrar
   */
  static log(event: AvailabilityEvent): void {
    const { level, code, message, context, timestamp } = event;

    const formattedMessage = `[${code}] ${message}`;

    switch (level) {
      case "debug":
        Logger.debug(formattedMessage, { timestamp, ...context });
        break;
      case "info":
        Logger.info(formattedMessage, { timestamp, ...context });
        break;
      case "warn":
        Logger.warn(formattedMessage, { timestamp, ...context });
        break;
      case "error":
        Logger.error(formattedMessage, { timestamp, ...context });
        break;
      default:
        Logger.info(formattedMessage, { timestamp, ...context });
        break;
    }
  }

  /**
   * Permite registrar múltiples eventos en una sola operación.
   * @param events Lista de eventos de disponibilidad
   */
  static logBatch(events: AvailabilityEvent[]): void {
    for (const event of events) {
      AvailabilityEventLogger.log(event);
    }
  }
}