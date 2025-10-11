export type AvailabilityEventLevel = "debug" | "info" | "warn" | "error";

/**
 * Representa un evento de disponibilidad dentro del dominio.
 * No interrumpe el flujo de ejecución: es solo información de contexto y observabilidad.
 */
export interface AvailabilityEvent {
  /**
   * Código único que identifica el tipo de evento.
   */
  code: string;

  /**
   * Mensaje legible que describe la situación observada.
   */
  message: string;

  /**
   * Nivel del evento (info, warn o error), según la importancia o impacto.
   */
  level: AvailabilityEventLevel;

  /**
   * Contexto adicional con los datos específicos relacionados con el evento.
   */
  context?: Record<string, any>;

  /**
   * Fecha y hora del evento en formato ISO.
   */
  timestamp: string;
}

/**
 * Creador auxiliar de eventos para mantener consistencia.
 */
export class AvailabilityEventFactory {
  static create(
    code: string,
    message: string,
    level: AvailabilityEventLevel = "info",
    context: Record<string, any> = {}
  ): AvailabilityEvent {
    return {
      code,
      message,
      level,
      context,
      timestamp: new Date().toISOString(),
    };
  }
}