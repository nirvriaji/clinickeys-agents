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
  tiempo_actual: string; // ISO local de la clínica
  localTimeForPrompts: string; // string legible ya usado en otros prompts
  tratamientosDisponibles: string[];
  medicosDisponibles: string[];
  espaciosDisponibles: string[];
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

/**
 * Servicio principal para extraer filtros de disponibilidad a partir
 * del mensaje del usuario, catálogos y contexto temporal.
 *
 * - Lee y cachea el prompt de sistema desde `.md`.
 * - Construye un userPrompt con cabecera de control + catálogos completos.
 * - Llama a `openAIService.getSchemaStructuredResponse(...)` (Responses v5 + zod).
 * - Devuelve un arreglo de filtros (posiblemente vacío en caso de error o falta de señales).
 */
export class AvailabilityRequestExtractorService {
  private static cachedSystemPrompt: string | null = null;

  constructor(private readonly openAIService: IOpenAIService) {}

  // Carga y cachea el prompt system desde el archivo .md
  private async loadSystemPrompt(): Promise<string> {
    if (AvailabilityRequestExtractorService.cachedSystemPrompt) {
      return AvailabilityRequestExtractorService.cachedSystemPrompt;
    }

    const promptsPath = path.resolve(
      __dirname,
      "packages/core/src/.ia/instructions/prompts/bot_extractor_consulta_cita.md"
    );

    try {
      const content = await readFile(promptsPath, "utf8");
      AvailabilityRequestExtractorService.cachedSystemPrompt = content;
      Logger.info(
        "[AvailabilityRequestExtractorService] Prompt cargado desde archivo .md",
        { promptsPath }
      );
      return content;
    } catch (err) {
      Logger.error(
        "[AvailabilityRequestExtractorService] No se pudo leer el prompt; abortando",
        err
      );
      // Preferimos fallar de forma explícita: el caller decidirá el mensaje al paciente
      throw new Error(
        "No se pudo cargar el prompt del extractor (bot_extractor_consulta_cita.md)"
      );
    }
  }

  // Construye el userPrompt completo, incluyendo cabecera de control
  private buildUserPrompt(
    parametrosSolicitudCita: string,
    contexto: ExtractorContext,
    options?: ExtractorOptions
  ): string {
    const DEFAULT_FORWARD_DAYS = Number(
      options?.header?.DEFAULT_FORWARD_DAYS ?? 45
    );

    // Catálogos en crudo, SIN recortes
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
    options?: ExtractorOptions
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
    });

    try {
      const parsed = await this.openAIService.getSchemaStructuredResponse(
        systemPrompt,
        userPrompt,
        ExtractorResultSchema,
        "ExtractorResultSchema",
        options?.model || "gpt-4o-mini"
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
        error
      );
      // Sin retries acá. El caller decidirá el mensaje al paciente si corresponde
      return [];
    }
  }
}

export default AvailabilityRequestExtractorService;