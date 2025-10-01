// packages/core/src/application/services/AvailabilityRequestExtractorService.ts

import { ConsultaCitaSchema } from "@clinickeys-agents/core/domain/availability";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import { readFile } from "fs/promises";
import path from "path";

// =============================
// Tipos
// =============================

export interface AvailabilityFilterResult {
  tratamientos: string[];
  medicos: string[];
  espacios: string[];
  fechas: { fecha: string }[];
}

// =============================
// Clase Extractor
// =============================

export class AvailabilityRequestExtractorService {
  private readonly openAIService: IOpenAIService;
  private static cachedSystemPrompt: string | null = null;

  constructor(openAIService: IOpenAIService) {
    this.openAIService = openAIService;
  }

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
      Logger.info("[AvailabilityRequestExtractorService] Prompt cargado desde archivo .md");
      return content;
    } catch (err) {
      Logger.error(
        "[AvailabilityRequestExtractorService] No se pudo leer el prompt; usando fallback inline",
        err
      );
      const fallback =
        "Eres un extractor de filtros para disponibilidad de citas. Devuelves un objeto JSON con tratamientos, médicos, espacios y fechas. Debes usar únicamente los nombres provistos en las listas de tratamientosDisponibles, medicosDisponibles y espaciosDisponibles. Si no hay coincidencia exacta, devuelve un array vacío.";
      AvailabilityRequestExtractorService.cachedSystemPrompt = fallback;
      return fallback;
    }
  }

  /**
   * Interpreta un mensaje del paciente y devuelve filtros estructurados.
   */
  public async extract(
    mensajeBotParlante: string,
    contexto: {
      id_clinica: number;
      id_super_clinica: number;
      tiempo_actual: string;
      localTimeForPrompts: string;
      tratamientosDisponibles: string[];
      medicosDisponibles: string[];
      espaciosDisponibles: string[];
    }
  ): Promise<AvailabilityFilterResult[]> {
    const systemPrompt = await this.loadSystemPrompt();

    const userPrompt = `
El paciente consultó por una cita y le respondimos esto: ${mensajeBotParlante}

Contexto:
- id_clinica: ${contexto.id_clinica}
- id_super_clinica: ${contexto.id_super_clinica}
- tiempo_actual: ${contexto.localTimeForPrompts}
- tratamientos disponibles: ${JSON.stringify(contexto.tratamientosDisponibles)}
- médicos disponibles: ${JSON.stringify(contexto.medicosDisponibles)}
- espacios disponibles: ${JSON.stringify(contexto.espaciosDisponibles)}
`;

    Logger.info("[AvailabilityRequestExtractorService] Iniciando extracción de filtros", {
      mensajeBotParlante,
      contexto,
      prompt: userPrompt,
    });

    try {
      const { filters } = await this.openAIService.getSchemaStructuredResponse(
        systemPrompt,
        userPrompt,
        ConsultaCitaSchema,
        'consultaCitaSchema',
        'gpt-4o-mini',
      );

      Logger.info(
        "[AvailabilityRequestExtractorService] Filtros obtenidos",
        { cantidad: (filters || []).length, filtros: filters }
      );

      return filters as AvailabilityFilterResult[];
    } catch (error) {
      Logger.error(
        "[AvailabilityRequestExtractorService] Error al extraer filtros",
        error
      );
      return [];
    }
  }
}