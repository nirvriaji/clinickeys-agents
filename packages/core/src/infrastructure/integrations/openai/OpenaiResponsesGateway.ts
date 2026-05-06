// packages/core/src/infrastructure/integrations/openai/OpenaiResponsesGateway.ts

import OpenAI from "openai";
import { openaiTools } from "@clinickeys-agents/core/utils";
import {
  ResponseResult,
  FunctionCallPayload,
  ToolOutputPayload,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

const DEFAULT_MODEL = "gpt-5.4";

export interface OpenAIResponseGatewayOptions {
  apiKey: string;
  defaultModel?: string;
  client?: OpenAI;
}

export class OpenAIResponseGateway {
  private client: OpenAI;
  private model: string;

  constructor({ apiKey, defaultModel, client }: OpenAIResponseGatewayOptions) {
    this.client = client ?? new OpenAI({ apiKey });
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
    const details = [status && `status=${status}`, code && `code=${code}`, type && `type=${type}`]
      .filter(Boolean)
      .join(" ");
    const composed = details ? `${msg} (${details})` : msg;
    throw new Error(`[OpenAI:${method}] ${composed}`);
  }

  private isRetriableError(error: unknown): boolean {
    const e: any = error || {};
    const status = e?.status ?? e?.response?.status;
    const code = (e?.code || e?.response?.data?.error?.code || "") as string;
    const type = (e?.type || e?.response?.data?.error?.type || "") as string;
    const netCodes = new Set(["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"]);
    if (netCodes.has(code)) return true;
    if ([408, 409, 429].includes(status)) return true;
    if (typeof status === "number" && status >= 500 && status <= 599) return true;
    if (["rate_limit_exceeded", "server_error"].includes(type)) return true;
    return false;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((res) => setTimeout(res, ms));
  }

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
        const jitter = Math.floor(Math.random() * 300);
        await this.sleep(baseDelayMs + jitter);
      }
    }
    this.handleError(label, lastErr);
  }

  /**
   * Extrae llamadas a herramientas del objeto Response de v5.
   * Considera tanto items de nivel superior como contenido dentro de mensajes (defensivo ante variaciones).
   */
  private extractFunctionCalls(response: any): FunctionCallPayload[] {
    const calls: FunctionCallPayload[] = [];

    // 1) Items de nivel superior (lo más común en v5)
    for (const item of response?.output ?? []) {
      if (item?.type === "function_call" && item?.name) {
        let args: Record<string, any> = {};
        try {
          args = item.arguments ? JSON.parse(item.arguments) : {};
        } catch {
          args = {};
        }
        calls.push({
          tool_call_id: item.call_id || item.id || "",
          name: item.name,
          arguments: args,
        });
      }
    }

    // 2) Contenido embebido en mensajes (fallback defensivo)
    for (const out of response?.output ?? []) {
      if (out?.type === "message" && Array.isArray(out?.content)) {
        for (const c of out.content) {
          if (c?.type === "function_call" && c?.name) {
            let args: Record<string, any> = {};
            try {
              args = c.arguments ? JSON.parse(c.arguments) : {};
            } catch {
              args = {};
            }
            calls.push({
              tool_call_id: c.call_id || c.id || "",
              name: c.name,
              arguments: args,
            });
          }
        }
      }
    }

    return calls;
  }

  async createResponse(
    systemPrompt: string,
    userMessage: string,
    useTools = false,
    model?: string
  ): Promise<ResponseResult> {
    const client = this.getClient();

    return this.runWithStableRetry<ResponseResult>("responses.create", async () => {
      const resp = await client.responses.create({
        model: model || this.model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        tools: useTools ? [...openaiTools] : undefined,
      });

      const functionCalls = this.extractFunctionCalls(resp);
      return {
        responseId: resp.id,
        message: resp.output_text ?? null,
        functionCalls,
      };
    });
  }

  async createResponseWithTools(
    systemPrompt: string,
    userMessage: string,
    model?: string
  ): Promise<ResponseResult> {
    return this.createResponse(systemPrompt, userMessage, true, model);
  }

  async continueResponse(
    previousResponseId: string,
    userMessage: string,
    useTools = false,
    model?: string
  ): Promise<ResponseResult> {
    const client = this.getClient();

    return this.runWithStableRetry<ResponseResult>("responses.continue", async () => {
      const resp = await client.responses.create({
        model: model || this.model,
        input: [{ role: "user", content: userMessage }],
        previous_response_id: previousResponseId,
        tools: useTools ? [...openaiTools] : undefined,
      });

      const functionCalls = this.extractFunctionCalls(resp);
      return {
        responseId: resp.id,
        message: resp.output_text ?? null,
        functionCalls,
      };
    });
  }

  /**
   * Continúa una response enviando salidas de tools como items de input de tipo "function_call_output".
   * (En v5 NO existe el campo raíz tool_outputs en responses.create)
   */
  async continueResponseWithToolOutputs(
    previousResponseId: string,
    toolOutputs: ToolOutputPayload[],
    model?: string
  ): Promise<ResponseResult> {
    const client = this.getClient();

    if (!Array.isArray(toolOutputs) || toolOutputs.length === 0) {
      throw new Error("toolOutputs must be a non-empty array");
    }

    // Mapear a items de input requeridos por v5
    const inputItems: any[] = toolOutputs.map((o) => ({
      type: "function_call_output",
      call_id: o.tool_call_id,
      output: typeof o.output === "string" ? o.output : JSON.stringify(o.output ?? {}),
    }));

    return this.runWithStableRetry<ResponseResult>("responses.continueWithTools", async () => {
      const resp = await client.responses.create({
        model: model || this.model,
        previous_response_id: previousResponseId,
        input: inputItems as any,
        tools: [...openaiTools],
      });

      const functionCalls = this.extractFunctionCalls(resp);
      return {
        responseId: resp.id,
        message: resp.output_text ?? null,
        functionCalls,
      };
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
        text: { format },
      });
      return resp.output_parsed;
    });
  }
}

export default OpenAIResponseGateway;