// packages/core/src/domain/openai/IOpenAIAssistantRepository.ts

import {
  Assistant,
  CreateAssistantPayload,
  UpdateAssistantPayload,
  Thread,
  Run,
  OpenAIMessageResponse,
  SubmitToolOutputsPayload,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

export interface IOpenAIAssistantRepository {
  // =========================== Assistants ===========================
  listAssistants(): Promise<Assistant[]>;
  getAssistant(assistantId: string): Promise<Assistant>;
  createAssistant(payload: CreateAssistantPayload): Promise<Assistant>;
  updateAssistant(assistantId: string, payload: UpdateAssistantPayload): Promise<Assistant>;
  deleteAssistant(assistantId: string): Promise<void>;

  // =========================== Threads & Runs ===========================
  createThread(): Promise<Thread>;
  listRuns(threadId: string, limit?: number): Promise<Run[]>;
  retrieveRun(threadId: string, runId: string): Promise<Run>;
  cancelRun(threadId: string, runId: string): Promise<Run>;
  createRun(threadId: string, assistantId: string, message: string): Promise<Run>;

  // =========================== Messages ===========================
  listMessages(threadId: string): Promise<OpenAIMessageResponse[]>;

  // =========================== Tool Outputs ===========================
  submitToolOutputs(payload: SubmitToolOutputsPayload): Promise<void>;

  // =========================== Responses ===========================
  createResponse(systemPrompt: string, userMessage: string, type: "json_object" | "text"): Promise<any>;
  parseResponse(systemPrompt: string, userMessage: string, format: any, model?: string): Promise<any>;
}
