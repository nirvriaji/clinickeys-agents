import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { AvailabilityEvent } from "@clinickeys-agents/core/domain/availability";

/**
 * AvailabilityEventLogger
 * Centraliza el logging de eventos del dominio de disponibilidad.
 *
 * - No lanza errores: el logging nunca debe interrumpir el flujo.
 * - Normaliza el payload y añade metadatos útiles (timestamp, code, level).
 * - Ofrece un método batch para registrar múltiples eventos en orden.
 */
export class AvailabilityEventLogger {
  /**
   * Registra un único evento de disponibilidad.
   * @param event Evento a registrar
   */
  static log(event: AvailabilityEvent): void {
    try {
      const { level, code, message, context, timestamp } = event || ({} as AvailabilityEvent);

      // Mensaje estandarizado para que sea fácil de grepear en logs
      const formattedMessage = `[${code ?? "EVT-UNKNOWN"}] ${message ?? "(sin mensaje)"}`;

      // Contexto enriquecido con timestamp y code para facilitar trazabilidad
      const meta = {
        timestamp: timestamp ?? new Date().toISOString(),
        code: code ?? "EVT-UNKNOWN",
        level: (level ?? "info") as AvailabilityEvent["level"],
        ...safeContext(context),
      } as Record<string, unknown>;

      switch (level) {
        case "debug":
          Logger.debug(formattedMessage, meta);
          break;
        case "info":
          Logger.info(formattedMessage, meta);
          break;
        case "warn":
          Logger.warn(formattedMessage, meta);
          break;
        case "error":
          Logger.error(formattedMessage, meta);
          break;
        default:
          Logger.info(formattedMessage, meta);
          break;
      }
    } catch (err) {
      // Falla silenciosa: nunca se debe romper el flujo por un problema de logging
      try {
        Logger.warn("[AvailabilityEventLogger] Error al registrar evento (continuando)", {
          error: toErrorString(err),
        });
      } catch {
        // último recurso: no hacer nada
      }
    }
  }

  /**
   * Registra múltiples eventos en orden. Ignora entradas nulas.
   */
  static logBatch(events: AvailabilityEvent[]): void {
    if (!Array.isArray(events) || events.length === 0) return;
    for (const ev of events) {
      if (!ev) continue;
      AvailabilityEventLogger.log(ev);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Helpers privados
// ────────────────────────────────────────────────────────────────────────────────

function toErrorString(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function safeContext(ctx: unknown): Record<string, unknown> | undefined {
  if (ctx == null) return undefined;
  if (typeof ctx === "object") {
    // Evita errores de serialización por referencias circulares
    try {
      const json = JSON.stringify(ctx);
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return { context_serialization_error: true };
    }
  }
  return { context: ctx } as Record<string, unknown>;
}

export default AvailabilityEventLogger;