// packages/core/src/infrastructure/openai/OpenAIResponseRepository.ts

import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { OpenAIResponseGateway } from "@clinickeys-agents/core/infrastructure/integrations/openai";
import {
  ResponseResult,
  ToolOutputPayload,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

/**
 * OpenAIResponseRepository
 * Capa intermedia sobre el Gateway de Responses v5.
 * Se encarga de orquestar las llamadas, registrar logs y propagar errores.
 */
export class OpenAIResponseRepository {
  private gateway: OpenAIResponseGateway;

  constructor(gateway: OpenAIResponseGateway) {
    this.gateway = gateway;
  }

  /**
   * Crea una respuesta simple (sin tools) o con tools (si se indica useTools=true).
   */
  async createResponse(
    systemPrompt: string,
    userMessage: string,
    useTools = false,
    model?: string
  ): Promise<ResponseResult> {
    try {
      Logger.info("[OpenAIResponseRepository] createResponse", { useTools });
      return await this.gateway.createResponse(systemPrompt, userMessage, useTools, model);
    } catch (error) {
      Logger.error("[OpenAIResponseRepository] Error in createResponse", { error });
      throw error;
    }
  }

  /**
   * Crea una respuesta con tools habilitadas (function calling).
   */
  async createResponseWithTools(
    systemPrompt: string,
    userMessage: string,
    model?: string
  ): Promise<ResponseResult> {
    try {
      Logger.info("[OpenAIResponseRepository] createResponseWithTools");
      return await this.gateway.createResponseWithTools(systemPrompt, userMessage, model);
    } catch (error) {
      Logger.error("[OpenAIResponseRepository] Error in createResponseWithTools", { error });
      throw error;
    }
  }

  /**
   * Continúa una conversación, con o sin tools.
   */
  async continueResponse(
    responseId: string,
    userMessage: string,
    useTools = false,
    model?: string
  ): Promise<ResponseResult> {
    try {
      Logger.info("[OpenAIResponseRepository] continueResponse", { useTools });
      return await this.gateway.continueResponse(responseId, userMessage, useTools, model);
    } catch (error) {
      Logger.error("[OpenAIResponseRepository] Error in continueResponse", { error });
      throw error;
    }
  }

  /**
   * Envía los resultados de herramientas (function outputs) y continúa la respuesta.
   */
  async continueResponseWithToolOutputs(
    responseId: string,
    toolOutputs: ToolOutputPayload[],
    model?: string
  ): Promise<ResponseResult> {
    try {
      Logger.info("[OpenAIResponseRepository] continueResponseWithToolOutputs", {
        responseId,
        outputs: toolOutputs?.length,
      });
      return await this.gateway.continueResponseWithToolOutputs(responseId, toolOutputs, model);
    } catch (error) {
      Logger.error("[OpenAIResponseRepository] Error in continueResponseWithToolOutputs", { error });
      throw error;
    }
  }

  /**
   * Ejecuta el endpoint responses.parse con validación Zod (u otro schema).
   */
  async parseResponse(
    systemPrompt: string,
    userMessage: string,
    format: any,
    model?: string
  ): Promise<any> {
    try {
      Logger.info("[OpenAIResponseRepository] parseResponse");
      return await this.gateway.parseResponse(systemPrompt, userMessage, format, model);
    } catch (error) {
      Logger.error("[OpenAIResponseRepository] Error in parseResponse", { error });
      throw error;
    }
  }

  /**
   * Crea una respuesta estructurada en JSON.
   */
  async getJsonStructuredResponse(
    systemPrompt: string,
    userMessage: string
  ): Promise<any> {
    try {
      Logger.info("[OpenAIResponseRepository] getJsonStructuredResponse");
      const result = await this.gateway.createResponse(systemPrompt, userMessage, false);
      return result.message ? JSON.parse(result.message) : null;
    } catch (error) {
      Logger.error("[OpenAIResponseRepository] Error in getJsonStructuredResponse", { error });
      throw error;
    }
  }
}

export default OpenAIResponseRepository;