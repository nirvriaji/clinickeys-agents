import { ZodType } from "zod";
import {
  Assistant,
  CreateAssistantPayload,
  UpdateAssistantPayload,
  Run,
  ResponseResult,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

export interface IOpenAIService {
  // =========================== Assistants ===========================
  listAssistants(): Promise<Assistant[]>;
  getAssistant(assistantId: string): Promise<Assistant>;
  createAssistants(instructions: Record<string, string>): Promise<Record<string, string>>;
  createAssistant(payload: CreateAssistantPayload): Promise<Assistant>;
  deleteAssistants(assistantIds: Record<string, string>): Promise<void>;
  syncAssistants(
    instructions: Record<string, string>,
    currentIds: Record<string, string>
  ): Promise<Record<string, string>>;
  updateAssistant(assistantId: string, payload: UpdateAssistantPayload): Promise<Assistant>;

  // =========================== Messaging ===========================
  getResponseFromAssistant(
    assistantId: string,
    message: string,
    threadId?: string
  ): Promise<ResponseResult>;

  /**
   * Envía en un solo submit todos los tool_outputs preparados por el orquestador
   * y espera hasta que el run cambie de estado (requires_action o completed).
   */
  submitToolOutputsAndPoll(params: {
    threadId: string;
    runId: string;
    outputs: Array<{ tool_call_id: string; output: string }>;
  }): Promise<ResponseResult>;

  // =========================== Structured Responses ===========================
  getJsonStructuredResponse(systemPrompt: string, userMessage: string): Promise<any>;
  getSchemaStructuredResponse(
    systemPrompt: string,
    userMessage: string,
    schema: ZodType<any>,
    schemaLabel?: string,
    model?: string
  ): Promise<any>;

  // =========================== Helpers ===========================
  pollUntilResolved(threadId: string, runId: string, timeoutMs?: number): Promise<Run>;
}

export type { ResponseResult } from "@clinickeys-agents/core/infrastructure/integrations/openai/models";