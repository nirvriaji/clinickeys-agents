// packages/core/src/utils/ErrorReporter.ts

import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { AppError } from "../infrastructure/availability/AppError";

/**
 * Servicio centralizado para registrar y reportar errores críticos del sistema.
 * Puede ser extendido para enviar errores a servicios externos como Sentry, Datadog, etc.
 */
export class ErrorReporter {
  /**
   * Reporta el error en logs y en servicios externos si aplica.
   * @param error El error capturado
   * @param contexto Contexto adicional relevante (opcional)
   */
  static report(error: unknown, contexto?: Record<string, any>): void {
    // Si es AppError, log personalizado
    if (error instanceof AppError) {
      Logger.error(error.toString(), contexto ?? error.context);
      // Aquí puedes enviar el error a Sentry/Datadog, etc., si se desea
      return;
    }

    // Si es un error estándar de Node.js/JS
    if (error instanceof Error) {
      Logger.error(`[ERROR] ${error.name}: ${error.message}`, {
        ...contexto,
        stack: error.stack,
      });
      // Aquí puedes enviar el error a Sentry/Datadog, etc., si se desea
      return;
    }

    // Si es un objeto plano o algo no tipado
    Logger.error("[ERROR] Error desconocido", { error, ...contexto });
    // Aquí puedes enviar el error a Sentry/Datadog, etc., si se desea
  }
}
