// packages/core/src/utils/errorMapper.ts

import { AppError } from "../infrastructure/availability/AppError";

/**
 * Mapea cualquier error recibido (AppError, Error nativo, error de infra, etc)
 * a un objeto estandarizado para API/UI y logging.
 *
 * @param error El error capturado (puede ser de cualquier tipo)
 * @returns Objeto plano { success, code, message, context }
 */
export function ErrorMapper(error: unknown): {
  success: false;
  code: string;
  message: string;
  context: Record<string, any>;
} {
  // Si es una instancia de AppError, usar su mapeo.
  if (error instanceof AppError) {
    return {
      success: false,
      code: error.code,
      message: error.message,
      context: error.context ?? {},
    };
  }

  // Si es un error de infra (Error nativo)
  if (error instanceof Error) {
    return {
      success: false,
      code: "ERR500",
      message: error.message || "Internal server error",
      context: {},
    };
  }

  // Si es un error serializable pero no Error (ejemplo: throw { ... })
  if (typeof error === "object" && error !== null) {
    return {
      success: false,
      code: (error as any).code || "ERR500",
      message: (error as any).message || "Unknown error",
      context: (error as any).context || {},
    };
  }

  // Para cualquier otro caso (string, number, etc)
  return {
    success: false,
    code: "ERR500",
    message: typeof error === "string" ? error : "Unknown error",
    context: {},
  };
}
