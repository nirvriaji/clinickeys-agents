// packages/core/src/domain/openai/IOpenAIAssistantRepository.ts

import {
  ResponseResult,
  ToolOutputPayload,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

/**
 * ⚠️ Refactor: Esta interfaz ahora modela el repositorio basado en
 * Responses API (SDK v5). El nombre del archivo se conserva por compatibilidad,
 * pero ya NO expone métodos de Assistants/Threads/Runs.
 */
export interface IOpenAIAssistantRepository {
  /**
   * Crea una respuesta. Si `useTools` es true, el modelo puede emitir tool calls.
   */
  createResponse(
    systemPrompt: string,
    userMessage: string,
    useTools?: boolean,
    model?: string
  ): Promise<ResponseResult>;

  /**
   * Atajo: crea una respuesta con tools habilitados.
   */
  createResponseWithTools(
    systemPrompt: string,
    userMessage: string,
    model?: string
  ): Promise<ResponseResult>;

  /**
   * Continúa una conversación enlazándose a una response previa (sin tool outputs).
   * Útil para seguir el diálogo textual conservando contexto de la response chain.
   */
  continueResponse(
    previousResponseId: string,
    userMessage: string,
    useTools?: boolean,
    model?: string
  ): Promise<ResponseResult>;

  /**
   * Continúa una response previa aportando resultados de tool calls anteriores.
   * El modelo puede solicitar nuevas tools en el mismo turno.
   */
  continueResponseWithToolOutputs(
    responseId: string,
    toolOutputs: ToolOutputPayload[],
    model?: string
  ): Promise<ResponseResult>;

  /**
   * Devuelve un objeto tipado según formato (e.g., zodTextFormat) sin function calling.
   */
  parseResponse(
    systemPrompt: string,
    userMessage: string,
    format: any,
    model?: string
  ): Promise<any>;

  /**
   * Devuelve un JSON estructurado (no tool calling) usando `text.format.type = "json_object"`.
   */
  getJsonStructuredResponse(
    systemPrompt: string,
    userMessage: string
  ): Promise<any>;
}

export default IOpenAIAssistantRepository;