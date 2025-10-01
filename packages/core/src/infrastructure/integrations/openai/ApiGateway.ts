// packages/core/src/infrastructure/integrations/openai/ApiGateway.ts

import OpenAI from "openai";
import { openaiTools } from "@clinickeys-agents/core/utils";
import {
  Assistant,
  Thread,
  Run,
  OpenAIMessageResponse,
  SubmitToolOutputsPayload,
  CreateAssistantPayload,
  UpdateAssistantPayload,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

const DEFAULT_MODEL = "gpt-4.1";

export interface OpenAIGatewayOptions {
  apiKey: string;
  defaultModel?: string;
}

export class OpenAIGateway {
  private client: OpenAI;
  private model: string;

  constructor({ apiKey, defaultModel }: OpenAIGatewayOptions) {
    this.client = new OpenAI({ apiKey });
    this.model = defaultModel || DEFAULT_MODEL;
  }

  private getClient(): OpenAI {
    return this.client;
  }

  private handleError(method: string, error: unknown): never {
    const anyErr = error as any;
    const msg = anyErr?.message ?? String(error);
    const status = anyErr?.status ?? anyErr?.response?.status;
    const code = anyErr?.code ?? anyErr?.response?.data?.error?.code;
    const type = anyErr?.type ?? anyErr?.response?.data?.error?.type;
    const param = anyErr?.param ?? anyErr?.response?.data?.error?.param;
    const details = [
      status !== undefined ? `status=${status}` : null,
      code ? `code=${code}` : null,
      type ? `type=${type}` : null,
      param ? `param=${param}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const composed = details ? `${msg} (${details})` : msg;
    throw new Error(`[OpenAI:${method}] ${composed}`);
  }

  // =========================== Assistants ===========================

  async createAssistant(payload: CreateAssistantPayload): Promise<Assistant> {
    const client = this.getClient();
    try {
      return (await client.beta.assistants.create({
        ...payload,
        model: payload.model || this.model,
        tools: [...openaiTools],
      })) as Assistant;
    } catch (error) {
      this.handleError("assistants.create", error);
    }
  }

  async updateAssistant(
    assistantId: string,
    payload: UpdateAssistantPayload
  ): Promise<Assistant> {
    const client = this.getClient();
    try {
      return (await client.beta.assistants.update(assistantId, {
        ...payload,
        tools: [...openaiTools],
      })) as Assistant;
    } catch (error) {
      this.handleError("assistants.update", error);
    }
  }

  async deleteAssistant(assistantId: string): Promise<void> {
    const client = this.getClient();
    try {
      await client.beta.assistants.del(assistantId);
    } catch (error) {
      this.handleError("assistants.del", error);
    }
  }

  async listAssistants(): Promise<Assistant[]> {
    const client = this.getClient();
    try {
      const result = await client.beta.assistants.list();
      return (result.data as Assistant[]) || [];
    } catch (error) {
      this.handleError("assistants.list", error);
    }
  }

  async getAssistant(assistantId: string): Promise<Assistant> {
    const client = this.getClient();
    try {
      return (await client.beta.assistants.retrieve(assistantId)) as Assistant;
    } catch (error) {
      this.handleError("assistants.retrieve", error);
    }
  }

  // =========================== Threads ===========================

  async createThread(): Promise<Thread> {
    const client = this.getClient();
    try {
      return (await client.beta.threads.create()) as Thread;
    } catch (error) {
      this.handleError("threads.create", error);
    }
  }

  // =========================== Runs ===========================

  async listRuns(threadId: string, limit = 1): Promise<Run[]> {
    const client = this.getClient();
    try {
      const runs = await client.beta.threads.runs.list(threadId, { limit });
      return runs.data as Run[];
    } catch (error) {
      this.handleError("runs.list", error);
    }
  }

  async retrieveRun(threadId: string, runId: string): Promise<Run> {
    const client = this.getClient();
    try {
      return (await client.beta.threads.runs.retrieve(threadId, runId)) as Run;
    } catch (error) {
      this.handleError("runs.retrieve", error);
    }
  }

  async cancelRun(threadId: string, runId: string): Promise<Run> {
    const client = this.getClient();
    try {
      return (await client.beta.threads.runs.cancel(threadId, runId)) as Run;
    } catch (error) {
      this.handleError("runs.cancel", error);
    }
  }

  async createRun(
    threadId: string,
    assistantId: string,
    message: string
  ): Promise<Run> {
    const client = this.getClient();
    try {
      return (await client.beta.threads.runs.create(threadId, {
        assistant_id: assistantId,
        additional_messages: [{ role: "user", content: message }],
      })) as Run;
    } catch (error) {
      this.handleError("runs.create", error);
    }
  }

  // =========================== Messages ===========================

  async listMessages(threadId: string): Promise<OpenAIMessageResponse[]> {
    const client = this.getClient();
    try {
      const msgs = await client.beta.threads.messages.list(threadId);
      return msgs.data as OpenAIMessageResponse[];
    } catch (error) {
      this.handleError("messages.list", error);
    }
  }

  // =========================== Tool Outputs ===========================

  async submitToolOutputs(payload: SubmitToolOutputsPayload): Promise<void> {
    if (!Array.isArray(payload.toolOutputs) || payload.toolOutputs.length === 0) {
      throw new Error("toolOutputs must be a non-empty array");
    }
    for (const { tool_call_id, output } of payload.toolOutputs) {
      if (!tool_call_id || output === undefined) {
        throw new Error("Each toolOutput must contain tool_call_id and output");
      }
    }

    const client = this.getClient();
    try {
      await client.beta.threads.runs.submitToolOutputs(
        payload.threadId,
        payload.runId,
        { tool_outputs: payload.toolOutputs }
      );
    } catch (error) {
      this.handleError("runs.submitToolOutputs", error);
    }
  }

  // =========================== Responses ===========================

  async createResponse(
    systemPrompt: string,
    userMessage: string,
    type: "json_object" | "text"
  ): Promise<any> {
    const client = this.getClient();
    try {
      const resp = await client.responses.create({
        model: this.model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        text: { format: { type } },
      });
      if (type === "json_object") {
        if (!resp.output_text) {
          throw new Error("No output_text returned for JSON object response");
        }
        return JSON.parse(resp.output_text);
      }
      return resp.output_text;
    } catch (error) {
      this.handleError("responses.create", error);
    }
  }

  async parseResponse(
    systemPrompt: string,
    userMessage: string,
    format: any,
    model?: string,
  ): Promise<any> {
    const client = this.getClient();
    try {
      const resp = await client.responses.parse({
        model: model || this.model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        text: { format },
      });
      return resp.output_parsed;
    } catch (error) {
      this.handleError("responses.parse", error);
    }
  }
}

export default OpenAIGateway;
