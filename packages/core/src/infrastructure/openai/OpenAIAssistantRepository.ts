// packages/core/src/infrastructure/openai/OpenAIAssistantRepository.ts

import { OpenAIGateway } from "@clinickeys-agents/core/infrastructure/integrations/openai";
import {
  Assistant,
  Thread,
  Run,
  OpenAIMessageResponse,
  SubmitToolOutputsPayload,
  CreateAssistantPayload,
  UpdateAssistantPayload,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";
import { IOpenAIAssistantRepository } from "@clinickeys-agents/core/domain/openai";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";

export class OpenAIAssistantRepository implements IOpenAIAssistantRepository {
  private gateway: OpenAIGateway;

  constructor(gateway: OpenAIGateway) {
    this.gateway = gateway;
  }

  // =========================== Assistants ===========================

  async listAssistants(): Promise<Assistant[]> {
    try {
      Logger.info("Listing assistants from OpenAI");
      return await this.gateway.listAssistants();
    } catch (error) {
      Logger.error("Error listing assistants", { error });
      throw error;
    }
  }

  async getAssistant(assistantId: string): Promise<Assistant> {
    if (!assistantId) throw new Error("assistantId is required");
    try {
      Logger.info("Retrieving assistant", { assistantId });
      return await this.gateway.getAssistant(assistantId);
    } catch (error) {
      Logger.error("Error retrieving assistant", { assistantId, error });
      throw error;
    }
  }

  async createAssistant(payload: CreateAssistantPayload): Promise<Assistant> {
    if (!payload?.name) throw new Error("Assistant name is required");
    try {
      Logger.info("Creating assistant", { name: payload.name });
      return await this.gateway.createAssistant(payload);
    } catch (error) {
      Logger.error("Error creating assistant", { payload, error });
      throw error;
    }
  }

  async updateAssistant(assistantId: string, payload: UpdateAssistantPayload): Promise<Assistant> {
    if (!assistantId) throw new Error("assistantId is required");
    try {
      Logger.info("Updating assistant", { assistantId });
      return await this.gateway.updateAssistant(assistantId, payload);
    } catch (error) {
      Logger.error("Error updating assistant", { assistantId, payload, error });
      throw error;
    }
  }

  async deleteAssistant(assistantId: string): Promise<void> {
    if (!assistantId) throw new Error("assistantId is required");
    try {
      Logger.info("Deleting assistant", { assistantId });
      await this.gateway.deleteAssistant(assistantId);
    } catch (error) {
      Logger.error("Error deleting assistant", { assistantId, error });
      throw error;
    }
  }

  // =========================== Threads & Runs ===========================

  async createThread(): Promise<Thread> {
    try {
      Logger.info("Creating thread");
      return await this.gateway.createThread();
    } catch (error) {
      Logger.error("Error creating thread", { error });
      throw error;
    }
  }

  async listRuns(threadId: string, limit?: number): Promise<Run[]> {
    if (!threadId) throw new Error("threadId is required");
    try {
      Logger.info("Listing runs", { threadId, limit });
      return await this.gateway.listRuns(threadId, limit);
    } catch (error) {
      Logger.error("Error listing runs", { threadId, error });
      throw error;
    }
  }

  async retrieveRun(threadId: string, runId: string): Promise<Run> {
    if (!threadId || !runId) throw new Error("threadId and runId are required");
    try {
      Logger.info("Retrieving run", { threadId, runId });
      return await this.gateway.retrieveRun(threadId, runId);
    } catch (error) {
      Logger.error("Error retrieving run", { threadId, runId, error });
      throw error;
    }
  }

  async cancelRun(threadId: string, runId: string): Promise<Run> {
    if (!threadId || !runId) throw new Error("threadId and runId are required");
    try {
      Logger.info("Cancelling run", { threadId, runId });
      return await this.gateway.cancelRun(threadId, runId);
    } catch (error) {
      Logger.error("Error cancelling run", { threadId, runId, error });
      throw error;
    }
  }

  async createRun(threadId: string, assistantId: string, message: string): Promise<Run> {
    if (!threadId || !assistantId || !message) {
      throw new Error("threadId, assistantId and message are required");
    }
    try {
      Logger.info("Creating run", { threadId, assistantId });
      return await this.gateway.createRun(threadId, assistantId, message);
    } catch (error) {
      Logger.error("Error creating run", { threadId, assistantId, error });
      throw error;
    }
  }

  // =========================== Messages ===========================

  async listMessages(threadId: string): Promise<OpenAIMessageResponse[]> {
    if (!threadId) throw new Error("threadId is required");
    try {
      Logger.info("Listing messages", { threadId });
      return await this.gateway.listMessages(threadId);
    } catch (error) {
      Logger.error("Error listing messages", { threadId, error });
      throw error;
    }
  }

  // =========================== Tool Outputs ===========================

  async submitToolOutputs(payload: SubmitToolOutputsPayload): Promise<void> {
    if (!payload?.threadId || !payload?.runId) {
      throw new Error("threadId and runId are required in payload");
    }
    if (!Array.isArray(payload.toolOutputs) || payload.toolOutputs.length === 0) {
      throw new Error("toolOutputs must be a non-empty array");
    }
    try {
      Logger.info("Submitting tool outputs", { payload });
      return await this.gateway.submitToolOutputs(payload);
    } catch (error) {
      Logger.error("Error submitting tool outputs", { payload, error });
      throw error;
    }
  }

  // =========================== Responses ===========================

  async createResponse(systemPrompt: string, userMessage: string, type: "json_object" | "text"): Promise<any> {
    if (!systemPrompt || !userMessage) {
      throw new Error("systemPrompt and userMessage are required");
    }
    try {
      Logger.info("Creating response", { type });
      return await this.gateway.createResponse(systemPrompt, userMessage, type);
    } catch (error) {
      Logger.error("Error creating response", { error });
      throw error;
    }
  }

  async parseResponse(systemPrompt: string, userMessage: string, format: any, model?: string): Promise<any> {
    if (!systemPrompt || !userMessage || !format) {
      throw new Error("systemPrompt, userMessage and format are required");
    }
    try {
      Logger.info("Parsing response");
      return await this.gateway.parseResponse(systemPrompt, userMessage, format, model);
    } catch (error) {
      Logger.error("Error parsing response", { error });
      throw error;
    }
  }
}

export default OpenAIAssistantRepository;
