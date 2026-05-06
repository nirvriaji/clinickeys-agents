// packages/core/src/application/services/AvailabilityService/AvailabilityRequestExtractorService.ts

import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import { readFile } from "fs/promises";
import path from "path";
import {
  ExtractorResultSchema,
  type ExtractorResult,
} from "@clinickeys-agents/core/application/services/types";

// =============================
// Tipos de entrada/salida (contrato del servicio)
// =============================
export interface ExtractorContext {
  id_clinica: number;
  id_super_clinica: number;
  tiempo_actual: string;
  localTimeForPrompts: string;
  tratamientosDisponibles: { id: number; nombre: string }[];
  medicosDisponibles: { id: number; nombre: string }[];
  espaciosDisponibles: { id: number; nombre: string }[];
}

export interface ExtractorOptions {
  // Cabecera de control para el extractor (orientativa para el modelo)
  header?: {
    DEFAULT_FORWARD_DAYS?: number; // p.ej. 45 o 90
  };
  // Modelo a usar (si se quiere forzar). Si no, lo decide el servicio OpenAI
  model?: string;
}

export type AvailabilityFilterResult = ExtractorResult["filters"][number];

export class AvailabilityRequestExtractorService {
  private static cachedSystemPrompt: string | null = null;

  constructor(private readonly openAIService: IOpenAIService) {}

  // Carga y cachea el prompt system desde el archivo .md
  private async loadSystemPrompt(): Promise<string> {
    if (AvailabilityRequestExtractorService.cachedSystemPrompt) {
      return AvailabilityRequestExtractorService.cachedSystemPrompt;
    }

    // Ruta principal (build) y fallback (ejecución local)
    const mainPath = path.resolve(
      __dirname,
      "packages/core/src/prompts/bot_extractor_consulta_cita.md",
    );
    const fallbackPath = path.resolve(
      process.cwd(),
      "packages/core/src/prompts/bot_extractor_consulta_cita.md",
    );

    const tryRead = async (p: string) => {
      const content = await readFile(p, "utf8");
      Logger.info(
        "[AvailabilityRequestExtractorService] Prompt cargado desde archivo .md",
        { promptsPath: p },
      );
      return content;
    };

    try {
      const content = await tryRead(mainPath);
      AvailabilityRequestExtractorService.cachedSystemPrompt = content;
      return content;
    } catch (errMain) {
      Logger.warn(
        "[AvailabilityRequestExtractorService] No se encontró prompt en ruta principal; intentando fallback",
        { mainPath },
      );
      try {
        const content = await tryRead(fallbackPath);
        AvailabilityRequestExtractorService.cachedSystemPrompt = content;
        return content;
      } catch (errFallback) {
        Logger.error(
          "[AvailabilityRequestExtractorService] No se pudo leer el prompt; abortando",
          { errMain, errFallback },
        );
        throw new Error(
          "No se pudo cargar el prompt del extractor (bot_extractor_consulta_cita.md)",
        );
      }
    }
  }

  // Construye el userPrompt completo, incluyendo cabecera de control
  private buildUserPrompt(
    parametrosSolicitudCita: string,
    contexto: ExtractorContext,
    options?: ExtractorOptions,
  ): string {
    const DEFAULT_FORWARD_DAYS = Number(options?.header?.DEFAULT_FORWARD_DAYS ?? 45);

    // Catálogos en crudo (strings). El prompt system es el responsable de mapear a IDs de BD
    const tratamientosJSON = JSON.stringify(contexto.tratamientosDisponibles);
    const medicosJSON = JSON.stringify(contexto.medicosDisponibles);
    const espaciosJSON = JSON.stringify(contexto.espaciosDisponibles);

    // Cabecera explícita para el extractor (controlada desde código llamante)
    const headerBlock = `HEADER:\nDEFAULT_FORWARD_DAYS: ${DEFAULT_FORWARD_DAYS}`;

    // Mensaje del "bot parlante" puede venir en texto libre o JSON serializado
    const userBlock =
      `Parámetros de la solicitud de cita: ${parametrosSolicitudCita}\n\n` +
      `Contexto:\n` +
      `- id_clinica: ${contexto.id_clinica}\n` +
      `- id_super_clinica: ${contexto.id_super_clinica}\n` +
      `- tiempo_actual: ${contexto.localTimeForPrompts}\n` +
      `- catálogo tratamientos: ${tratamientosJSON}\n` +
      `- catálogo médicos: ${medicosJSON}\n` +
      `- catálogo espacios: ${espaciosJSON}`;

    return `${headerBlock}\n\n${userBlock}`;
  }

  /**
   * Interpreta un mensaje del paciente y devuelve filtros estructurados basados en
   * el esquema ExtractorResult (sin soporte legacy).
   *
   * Importante:
   * - Sin retries internos (los maneja el gateway); cada intento usa el MISMO prompt.
   * - No recorta catálogos.
   */
  public async extract(
    parametrosSolicitudCita: string,
    contexto: ExtractorContext,
    options?: ExtractorOptions,
  ): Promise<ExtractorResult["filters"]> {
    const systemPrompt = await this.loadSystemPrompt();
    const userPrompt = this.buildUserPrompt(parametrosSolicitudCita, contexto, options);

    Logger.info("[AvailabilityRequestExtractorService] Iniciando extracción de filtros", {
      parametrosSolicitudCita,
      contexto: {
        id_clinica: contexto.id_clinica,
        id_super_clinica: contexto.id_super_clinica,
        tiempo_actual: contexto.tiempo_actual,
      },
      header: options?.header ?? {},
      userPrompt,
    });

    try {
      const parsed = await this.openAIService.getSchemaStructuredResponse(
        systemPrompt,
        userPrompt,
        ExtractorResultSchema,
        "ExtractorResultSchema",
        options?.model || "gpt-5.4-mini",
      );

      const result = parsed as ExtractorResult;
      const filters = Array.isArray(result?.filters) ? result.filters : [];

      Logger.info("[AvailabilityRequestExtractorService] Filtros obtenidos", {
        count: filters.length,
      });

      return filters;
    } catch (error) {
      Logger.error(
        "[AvailabilityRequestExtractorService] Error al extraer filtros",
        error,
      );
      // Sin retries acá. El caller decidirá el mensaje al paciente si corresponde
      return [];
    }
  }
}

export default AvailabilityRequestExtractorService;