// packages/core/src/application/services/IOpenAIService.ts

import { ZodType } from "zod";
import {
  CreateAssistantPayload,
  UpdateAssistantPayload,
  Assistant,
  FunctionCallPayload,
  Run,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

export interface ResponseResult {
  threadId: string;
  runId: string;
  message?: string;
  functionCalls?: FunctionCallPayload[];
}

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
  getJsonStructuredResponse(systemPrompt: string, userMessage: string): Promise<any>;
  getSchemaStructuredResponse(
    systemPrompt: string,
    userMessage: string,
    schema: ZodType<any>,
    schemaLabel?: string,
    model?: string,
  ): Promise<any>;

  // =========================== Helpers ===========================
  pollUntilResolved(threadId: string, runId: string, timeoutMs?: number): Promise<Run>;
}
