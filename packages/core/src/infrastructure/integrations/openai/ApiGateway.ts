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
  // Optional: pass a custom OpenAI client (useful for testing/DI)
  client?: OpenAI;
}

export class OpenAIGateway {
  private client: OpenAI;
  private model: string;

  constructor({ apiKey, defaultModel, client }: OpenAIGatewayOptions) {
    this.client = client ?? new OpenAI({ apiKey });
    this.model = defaultModel || DEFAULT_MODEL;
  }

  private getClient(): OpenAI {
    return this.client;
  }

  /**
   * Centralizado: normaliza y compone mensajes de error del SDK de OpenAI.
   */
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

  /**
   * Determina si un error es reintetable (red, 429, 5xx, timeout).
   */
  private isRetriableError(error: unknown): boolean {
    const e: any = error || {};
    const status = e?.status ?? e?.response?.status;
    const code = (e?.code || e?.response?.data?.error?.code || "") as string;
    const type = (e?.type || e?.response?.data?.error?.type || "") as string;

    // Errores típicos de red / DNS / timeouts del runtime
    const netCodes = new Set(["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"]);
    if (netCodes.has(code)) return true;

    // HTTP reintetables
    if (status === 408) return true; // timeout
    if (status === 409) return true; // conflict (ocasional en runs)
    if (status === 429) return true; // rate limit
    if (typeof status === "number" && status >= 500 && status <= 599) return true; // 5xx

    // Códigos de OpenAI reintetables
    if (type === "rate_limit_exceeded" || type === "server_error") return true;

    return false;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((res) => setTimeout(res, ms));
  }

  /**
   * Reintentos estables: mismo input, mismo modelo, sin alterar prompts entre intentos.
   * Se reintenta sólo si el intento falla; si tarda, se respeta (no se dispara un retry en paralelo).
   */
  private async runWithStableRetry<T>(
    label: string,
    fn: () => Promise<T>,
    maxAttempts = 3,
    baseDelayMs = 1200
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt >= maxAttempts || !this.isRetriableError(err)) break;
        // Fijo + jitter leve (0–300 ms). No cambiamos inputs.
        const jitter = Math.floor(Math.random() * 300);
        await this.sleep(baseDelayMs + jitter);
      }
    }
    // Lanza con formato uniforme
    this.handleError(label, lastErr);
  }

  // =========================== Assistants ===========================

  async createAssistant(payload: CreateAssistantPayload): Promise<Assistant> {
    const client = this.getClient();
    return this.runWithStableRetry<Assistant>("assistants.create", async () => {
      const result = await client.beta.assistants.create({
        ...payload,
        model: payload.model || this.model,
        tools: [...openaiTools],
      });
      return result as Assistant;
    });
  }

  async updateAssistant(
    assistantId: string,
    payload: UpdateAssistantPayload
  ): Promise<Assistant> {
    const client = this.getClient();
    return this.runWithStableRetry<Assistant>("assistants.update", async () => {
      const result = await client.beta.assistants.update(assistantId, {
        ...payload,
        tools: [...openaiTools],
      });
      return result as Assistant;
    });
  }

  async deleteAssistant(assistantId: string): Promise<void> {
    const client = this.getClient();
    return this.runWithStableRetry<void>("assistants.del", async () => {
      await client.beta.assistants.del(assistantId);
    });
  }

  async listAssistants(): Promise<Assistant[]> {
    const client = this.getClient();
    return this.runWithStableRetry<Assistant[]>("assistants.list", async () => {
      const result = await client.beta.assistants.list();
      return (result.data as Assistant[]) || [];
    });
  }

  async getAssistant(assistantId: string): Promise<Assistant> {
    const client = this.getClient();
    return this.runWithStableRetry<Assistant>("assistants.retrieve", async () => {
      const result = await client.beta.assistants.retrieve(assistantId);
      return result as Assistant;
    });
  }

  // =========================== Threads ===========================

  async createThread(): Promise<Thread> {
    const client = this.getClient();
    return this.runWithStableRetry<Thread>("threads.create", async () => {
      const result = await client.beta.threads.create();
      return result as Thread;
    });
  }

  // =========================== Runs ===========================

  async listRuns(threadId: string, limit = 1): Promise<Run[]> {
    const client = this.getClient();
    return this.runWithStableRetry<Run[]>("runs.list", async () => {
      const runs = await client.beta.threads.runs.list(threadId, { limit });
      return runs.data as Run[];
    });
  }

  async retrieveRun(threadId: string, runId: string): Promise<Run> {
    const client = this.getClient();
    return this.runWithStableRetry<Run>("runs.retrieve", async () => {
      const result = await client.beta.threads.runs.retrieve(threadId, runId);
      return result as Run;
    });
  }

  async cancelRun(threadId: string, runId: string): Promise<Run> {
    const client = this.getClient();
    return this.runWithStableRetry<Run>("runs.cancel", async () => {
      const result = await client.beta.threads.runs.cancel(threadId, runId);
      return result as Run;
    });
  }

  async createRun(
    threadId: string,
    assistantId: string,
    message: string
  ): Promise<Run> {
    const client = this.getClient();
    return this.runWithStableRetry<Run>("runs.create", async () => {
      const result = await client.beta.threads.runs.create(threadId, {
        assistant_id: assistantId,
        additional_messages: [{ role: "user", content: message }],
      });
      return result as Run;
    });
  }

  // =========================== Messages ===========================

  async listMessages(threadId: string): Promise<OpenAIMessageResponse[]> {
    const client = this.getClient();
    return this.runWithStableRetry<OpenAIMessageResponse[]>("messages.list", async () => {
      const msgs = await client.beta.threads.messages.list(threadId);
      return msgs.data as OpenAIMessageResponse[];
    });
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
    return this.runWithStableRetry<void>("runs.submitToolOutputs", async () => {
      await client.beta.threads.runs.submitToolOutputs(
        payload.threadId,
        payload.runId,
        { tool_outputs: payload.toolOutputs }
      );
    });
  }

  // =========================== Responses ===========================

  async createResponse(
    systemPrompt: string,
    userMessage: string,
    type: "json_object" | "text"
  ): Promise<any> {
    const client = this.getClient();
    return this.runWithStableRetry<any>("responses.create", async () => {
      const resp = await client.responses.create({
        model: this.model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        // No limitamos max_output_tokens según lo acordado.
        text: { format: { type } },
      });
      if (type === "json_object") {
        if (!resp.output_text) {
          throw new Error("No output_text returned for JSON object response");
        }
        return JSON.parse(resp.output_text);
      }
      return resp.output_text;
    });
  }

  async parseResponse(
    systemPrompt: string,
    userMessage: string,
    format: any,
    model?: string
  ): Promise<any> {
    const client = this.getClient();
    return this.runWithStableRetry<any>("responses.parse", async () => {
      const resp = await client.responses.parse({
        model: model || this.model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        // No se fijan límites de salida.
        text: { format },
      });
      return resp.output_parsed;
    });
  }
}

export default OpenAIGateway;