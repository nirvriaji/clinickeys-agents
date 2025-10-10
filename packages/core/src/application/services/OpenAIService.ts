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
 * Administra todo el flujo de reasoning, function calling y structured outputs.
 * Reemplaza completamente la lógica de Assistants/Threads/Runs.
 */
export class OpenAIService {
  private repo: OpenAIResponseRepository;

  constructor(repo: OpenAIResponseRepository) {
    this.repo = repo;
  }

  /**
   * Ejecuta una respuesta con posibilidad de function calling.
   * Si el modelo decide invocar herramientas, las devuelve como functionCalls[].
   */
  async getResponseWithTools(
    systemPrompt: string,
    userMessage: string,
    model?: string
  ): Promise<ResponseResult> {
    Logger.info("[OpenAIService] getResponseWithTools");
    const response = await this.repo.createResponseWithTools(systemPrompt, userMessage, model);
    return response;
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
   * Crea una respuesta JSON estructurada (no function calling).
   */
  async getJsonStructuredResponse(
    systemPrompt: string,
    userMessage: string
  ): Promise<any> {
    Logger.info("[OpenAIService] getJsonStructuredResponse");
    return this.repo.getJsonStructuredResponse(systemPrompt, userMessage);
  }

  /**
   * Usa zodTextFormat para parsear outputs con esquema Zod.
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