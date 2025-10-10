// packages/core/src/application/services/OpenAIService.ts

import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { OpenAIResponseRepository } from "@clinickeys-agents/core/infrastructure/openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodType } from "zod";
import {
  ResponseResult,
  FunctionCallPayload,
  ToolOutputPayload,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

/**
 * OpenAIService (Responses API v5)
 * Capa de aplicación que orquesta flujos con el repositorio de Responses.
 */
export class OpenAIService {
  private repo: OpenAIResponseRepository;

  constructor(repo: OpenAIResponseRepository) {
    this.repo = repo;
  }

  /**
   * Ejecuta una primera respuesta con tools habilitadas (function calling).
   * Si el modelo decide invocar herramientas, éstas vendrán en `functionCalls`.
   */
  async getResponseWithTools(
    systemPrompt: string,
    userMessage: string,
    model?: string
  ): Promise<ResponseResult> {
    Logger.info("[OpenAIService] getResponseWithTools");
    return this.repo.createResponseWithTools(systemPrompt, userMessage, model);
  }

  /**
   * Continúa una response existente enviando un nuevo input (usuario) y,
   * opcionalmente, manteniendo tools habilitadas para que el modelo pueda
   * seguir emitiendo function calls sobre el MISMO responseId.
   */
  async continueResponse(
    previousResponseId: string,
    userMessage: string,
    useTools = true,
    model?: string
  ): Promise<ResponseResult> {
    Logger.info("[OpenAIService] continueResponse", {
      previousResponseId,
      useTools,
    });
    return this.repo.continueResponse(previousResponseId, userMessage, useTools, model);
  }

  /**
   * Recibe una response previa + resultados de tools, y continúa la conversación.
   * Si el modelo genera más tool calls, se devuelven para manejo iterativo.
   */
  async continueResponseWithToolOutputs(
    responseId: string,
    toolOutputs: ToolOutputPayload[],
    model?: string
  ): Promise<ResponseResult> {
    Logger.info("[OpenAIService] continueResponseWithToolOutputs", {
      responseId,
      outputs: toolOutputs?.length,
    });
    return this.repo.continueResponseWithToolOutputs(responseId, toolOutputs, model);
  }

  /**
   * Flujo completo: ejecuta tools, reenvía outputs y resuelve el reasoning final.
   * Útil para tareas batch o utilitarios, pero en producción solemos preferir
   * el control fino de ciclo en capas superiores (p. ej. PrimaryBotService).
   */
  async resolveToolFlow(
    systemPrompt: string,
    userMessage: string,
    executor: (name: string, args: Record<string, any>) => Promise<any>,
    model?: string
  ): Promise<ResponseResult> {
    Logger.info("[OpenAIService] resolveToolFlow - start");

    // Paso 1: generar primera respuesta con tools
    let current = await this.repo.createResponseWithTools(systemPrompt, userMessage, model);

    // Paso 2: manejar llamadas de herramientas iterativamente
    while (current.functionCalls && current.functionCalls.length > 0) {
      const toolOutputs: ToolOutputPayload[] = [];

      for (const call of current.functionCalls as FunctionCallPayload[]) {
        try {
          const output = await executor(call.name, call.arguments);
          toolOutputs.push({ tool_call_id: call.tool_call_id, output });
        } catch (err) {
          Logger.error("[OpenAIService] Error executing tool", { name: call.name, err });
          toolOutputs.push({ tool_call_id: call.tool_call_id, output: { error: String(err) } });
        }
      }

      current = await this.repo.continueResponseWithToolOutputs(current.responseId, toolOutputs, model);
    }

    Logger.info("[OpenAIService] resolveToolFlow - completed", {
      responseId: current.responseId,
    });

    return current;
  }

  /**
   * Ejecuta Responses.parse para obtener un JSON estructurado (sin tools).
   */
  async getJsonStructuredResponse(
    systemPrompt: string,
    userMessage: string
  ): Promise<any> {
    Logger.info("[OpenAIService] getJsonStructuredResponse");
    return this.repo.getJsonStructuredResponse(systemPrompt, userMessage);
  }

  /**
   * Usa zodTextFormat para parsear outputs con esquema Zod (Responses.parse).
   */
  async getSchemaStructuredResponse(
    systemPrompt: string,
    userMessage: string,
    schema: ZodType<any>,
    schemaLabel = "schema",
    model?: string
  ): Promise<any> {
    Logger.info("[OpenAIService] getSchemaStructuredResponse", { schemaLabel });
    const format = zodTextFormat(schema, schemaLabel);
    return this.repo.parseResponse(systemPrompt, userMessage, format, model);
  }

  /**
   * Crea una respuesta de texto simple (sin tools ni JSON parsing).
   */
  async getTextResponse(
    systemPrompt: string,
    userMessage: string,
    model?: string
  ): Promise<string | null> {
    Logger.info("[OpenAIService] getTextResponse");
    const resp = await this.repo.createResponse(systemPrompt, userMessage, false, model);
    return resp.message ?? null;
  }
}

export default OpenAIService;