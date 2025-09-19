// packages/core/src/infrastructure/availability/GetEstructuredAvailabilityRequestUseCase.ts

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

export class GetEstructuredAvailabilityRequestUseCase {
  private readonly openAIService: IOpenAIService;
  private static cachedSystemPrompt: string | null = null;

  constructor(openAIService: IOpenAIService) {
    this.openAIService = openAIService;
  }

  private async loadSystemPrompt(): Promise<string> {
    if (GetEstructuredAvailabilityRequestUseCase.cachedSystemPrompt) {
      return GetEstructuredAvailabilityRequestUseCase.cachedSystemPrompt;
    }

    const promptsPath = path.resolve(
      __dirname,
      "packages/core/src/.ia/instructions/prompts/bot_extractor_consulta_cita.md"
    );

    try {
      const content = await readFile(promptsPath, "utf8");
      GetEstructuredAvailabilityRequestUseCase.cachedSystemPrompt = content;
      return content;
    } catch (err) {
      Logger.error(
        "[GetEstructuredAvailabilityRequestUseCase] No se pudo leer el prompt; usando fallback inline",
        err
      );
      const fallback =
        "Eres un extractor de filtros para disponibilidad de citas. Devuelves un objeto JSON con tratamientos, médicos, espacios y fechas.";
      GetEstructuredAvailabilityRequestUseCase.cachedSystemPrompt = fallback;
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
    }
  ): Promise<AvailabilityFilterResult[]> {
    const systemPrompt = await this.loadSystemPrompt();

    const userPrompt = `
El paciente consultó por una cita y le respondimos esto: ${mensajeBotParlante}

Contexto:
- id_clinica: ${contexto.id_clinica}
- id_super_clinica: ${contexto.id_super_clinica}
- tiempo_actual: ${contexto.localTimeForPrompts}
- tratamientos disponibles: ${JSON.stringify(
      contexto.tratamientosDisponibles
    )}
- médicos disponibles: ${JSON.stringify(contexto.medicosDisponibles)}
`;

    try {
      const { filters } = await this.openAIService.getSchemaStructuredResponse(
        systemPrompt,
        userPrompt,
        ConsultaCitaSchema,
        "consultaCitaSchema"
      );

      Logger.info(
        "[GetEstructuredAvailabilityRequestUseCase] Filtros obtenidos:",
        JSON.stringify(filters)
      );

      return filters as AvailabilityFilterResult[];
    } catch (error) {
      Logger.error(
        "[GetEstructuredAvailabilityRequestUseCase] Error al extraer filtros:",
        error
      );
      return [];
    }
  }
}