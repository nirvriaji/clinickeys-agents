// packages/core/src/domain/openai/IOpenAIService.ts

import { ZodType } from "zod";
import {
  ResponseResult,
  ToolOutputPayload,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

export interface IOpenAIService {
  /**
   * Ejecuta una respuesta con tools habilitados. Puede devolver llamadas a funciones.
   */
  getResponseWithTools(
    systemPrompt: string,
    userMessage: string,
    model?: string
  ): Promise<ResponseResult>;

  /**
   * Continúa una response previa aportando outputs de tools. Puede devolver nuevas tool calls.
   */
  continueResponseWithToolOutputs(
    responseId: string,
    toolOutputs: ToolOutputPayload[],
    model?: string
  ): Promise<ResponseResult>;

  /**
   * Orquesta el loop completo: genera response, ejecuta tools vía `executor` y
   * reinyecta los resultados hasta obtener el mensaje final o que no haya más tool calls.
   */
  resolveToolFlow(
    systemPrompt: string,
    userMessage: string,
    executor: (name: string, args: Record<string, any>) => Promise<any>,
    model?: string
  ): Promise<ResponseResult>;

  /**
   * Estructurado: solicita salida JSON (no function calling).
   */
  getJsonStructuredResponse(
    systemPrompt: string,
    userMessage: string
  ): Promise<any>;

  /**
   * Estructurado: usa zodTextFormat para parsear según esquema Zod.
   */
  getSchemaStructuredResponse(
    systemPrompt: string,
    userMessage: string,
    schema: ZodType<any>,
    schemaLabel?: string,
    model?: string
  ): Promise<any>;

  /**
   * Texto plano: respuesta sin tools ni parsing.
   */
  getTextResponse(
    systemPrompt: string,
    userMessage: string,
    model?: string
  ): Promise<string | null>;
}

export type { ResponseResult } from "@clinickeys-agents/core/infrastructure/integrations/openai/models";