import { IOpenAIAssistantRepository, IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodType } from "zod";
import {
  CreateAssistantPayload,
  UpdateAssistantPayload,
  Assistant,
  FunctionCallPayload,
  ResponseResult,
  Run,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

const TIME_TO_POLL = 300000; // 5 minutos

export class OpenAIService implements IOpenAIService {
  private repo: IOpenAIAssistantRepository;
  private logger: typeof Logger;

  constructor(repo: IOpenAIAssistantRepository, logger: typeof Logger) {
    this.repo = repo;
    this.logger = logger;
  }

  // =========================== Assistants ===========================

  async listAssistants(): Promise<Assistant[]> {
    this.logger.info("Listando assistants de OpenAI");
    return this.repo.listAssistants();
  }

  async getAssistant(assistantId: string): Promise<Assistant> {
    this.logger.info("Obteniendo assistant de OpenAI", { assistantId });
    return this.repo.getAssistant(assistantId);
  }

  async createAssistant(payload: CreateAssistantPayload): Promise<Assistant> {
    this.logger.info("Creando assistant único", { name: payload.name });
    return this.repo.createAssistant(payload);
  }

  async createAssistants(
    instructions: Record<string, string>
  ): Promise<Record<string, string>> {
    const ids: Record<string, string> = {};
    for (const [name, md] of Object.entries(instructions)) {
      this.logger.info("Creando assistant", { name });
      const assistant = await this.repo.createAssistant({
        name,
        instructions: md,
        top_p: 0.01,
        temperature: 0.01,
      });
      ids[name] = assistant.id;
    }
    return ids;
  }

  async deleteAssistants(
    assistantIds: Record<string, string>
  ): Promise<void> {
    for (const id of Object.values(assistantIds || {})) {
      try {
        this.logger.info("Eliminando assistant", { assistantId: id });
        await this.repo.deleteAssistant(id);
      } catch (error) {
        this.logger.warn("Error eliminando assistant", {
          assistantId: id,
          error,
        });
      }
    }
  }

  async syncAssistants(
    instructions: Record<string, string>,
    currentIds: Record<string, string>
  ): Promise<Record<string, string>> {
    const result = { ...currentIds };
    for (const [name, md] of Object.entries(instructions)) {
      if (currentIds[name]) {
        this.logger.info("Actualizando assistant en sync", { name });
        await this.repo.updateAssistant(currentIds[name], { instructions: md });
      } else {
        this.logger.info("Creando nuevo assistant en sync", { name });
        const assistant = await this.repo.createAssistant({
          name,
          instructions: md,
          top_p: 0.01,
          temperature: 0.01,
        });
        result[name] = assistant.id;
      }
    }
    return result;
  }

  async updateAssistant(
    assistantId: string,
    payload: UpdateAssistantPayload
  ): Promise<Assistant> {
    this.logger.info("Actualizando instrucciones de assistant", {
      assistantId,
    });
    return this.repo.updateAssistant(assistantId, payload);
  }

  // =========================== Messaging ===========================

  async getResponseFromAssistant(
    assistantId: string,
    message: string,
    threadId?: string
  ): Promise<ResponseResult> {
    let tId = threadId;
    if (!tId) {
      const thread = await this.repo.createThread();
      tId = thread.id;
      this.logger.info("OpenAIService: Thread creado", { threadId: tId });
    }

    const runs = await this.repo.listRuns(tId, 1);
    let last: any = runs[0];

    if (last) {
      this.logger.info("Last run detected", { runId: last.id, status: last.status });
    }

    if (last?.status === "requires_action") {
      this.logger.warn("OpenAIService: Run requiere acción", {
        runId: last.id,
      });
      return {
        threadId: tId,
        runId: last.id,
        functionCalls: last.required_action?.submit_tool_outputs?.tool_calls.map((tc: any) => ({
          tool_call_id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })) as FunctionCallPayload[],
      };
    }

    if (["in_progress", "queued", "cancelling"].includes(last?.status || "")) {
      this.logger.info("Waiting for or cancelling stale run", { runId: last.id, status: last.status });

      try {
        if (last.status !== "cancelling") {
          await this.repo.cancelRun(tId, last.id);
        }
        last = await this.pollUntilResolved(tId, last.id);
      } catch (e) {
        this.logger.warn("Error cancelando/esperando run activo", e);
        last = undefined;
      }
    }

    if (!last || ["failed", "expired", "completed"].includes(last.status)) {
      const newRun = await this.repo.createRun(tId, assistantId, message);
      this.logger.info("CREATED NEW RUN", { runId: newRun.id, status: newRun.status });
      return this.getResponseFromWaitingAssistant({
        threadId: tId,
        runId: newRun.id,
        functionCalls: newRun.required_action?.submit_tool_outputs?.tool_calls?.map(tc => ({
          tool_call_id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })) || [],
        rawOutput: message,
      });
    }

    return { threadId: tId, runId: last.id, message: "" };
  }

  async getResponseFromWaitingAssistant({
    threadId,
    runId,
    functionCalls,
    rawOutput,
  }: {
    threadId: string;
    runId: string;
    functionCalls: FunctionCallPayload[];
    rawOutput: unknown;
  }): Promise<ResponseResult> {
    this.logger.info("OpenAIService: Resolviendo run pendiente", {
      threadId,
      runId,
    });
    if (functionCalls.length > 0) {
      const toolOutputs = functionCalls.map(fc => ({
        tool_call_id: fc.tool_call_id,
        output: typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput),
      }));
      await this.repo.submitToolOutputs({ runId, threadId, toolOutputs });
    }

    const finished = await this.pollUntilResolved(threadId, runId);
    this.logger.info("OpenAIService: Run finalizado", {
      threadId,
      runId: finished.id,
      status: finished.status,
    });

    if (finished.status === "requires_action") {
      return {
        threadId,
        runId: finished.id,
        functionCalls: finished.required_action?.submit_tool_outputs?.tool_calls.map(tc => ({
          tool_call_id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })) as FunctionCallPayload[],
      };
    }

    if (finished.status === "completed") {
      const messages = await this.repo.listMessages(threadId);
      const assistantMsg = messages.find((m: any) => m.role === "assistant");
      if (!assistantMsg) throw new Error("No assistant message found");
      const contentRaw = assistantMsg.content as any;
      const content = Array.isArray(contentRaw) ? contentRaw[0]?.text?.value : contentRaw?.text?.value;
      return { threadId, runId: finished.id, message: content || "" };
    }

    throw new Error(`Run en estado inesperado: ${finished.status}`);
  }

  // =========================== NUEVO: submit en lote y poll ===========================

  async submitToolOutputsAndPoll(params: {
    threadId: string;
    runId: string;
    outputs: Array<{ tool_call_id: string; output: string }>;
  }): Promise<ResponseResult> {
    const { threadId, runId, outputs } = params;

    if (!threadId || !runId) {
      throw new Error("threadId y runId son obligatorios en submitToolOutputsAndPoll");
    }
    if (!Array.isArray(outputs) || outputs.length === 0) {
      throw new Error("outputs debe ser un arreglo no vacío en submitToolOutputsAndPoll");
    }

    for (const o of outputs) {
      if (!o?.tool_call_id || typeof o.output !== "string") {
        throw new Error("Cada output debe incluir tool_call_id y output:string");
      }
    }

    this.logger.info("OpenAIService: submitToolOutputsAndPoll → submit", {
      threadId,
      runId,
      outputs: outputs.length,
    });

    await this.repo.submitToolOutputs({
      threadId,
      runId,
      toolOutputs: outputs,
    });

    const finished = await this.pollUntilResolved(threadId, runId);

    this.logger.info("OpenAIService: submitToolOutputsAndPoll → polled", {
      threadId,
      runId: finished.id,
      status: finished.status,
    });

    if (finished.status === "requires_action") {
      return {
        threadId,
        runId: finished.id,
        functionCalls: finished.required_action?.submit_tool_outputs?.tool_calls.map((tc: any) => ({
          tool_call_id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })),
      } as ResponseResult;
    }

    if (finished.status === "completed") {
      const messages = await this.repo.listMessages(threadId);
      const assistantMsg = messages.find((m: any) => m.role === "assistant");
      if (!assistantMsg) throw new Error("No assistant message found");
      const contentRaw = assistantMsg.content as any;
      const content = Array.isArray(contentRaw) ? contentRaw[0]?.text?.value : contentRaw?.text?.value;
      return { threadId, runId: finished.id, message: content || "" };
    }

    throw new Error(`Run en estado inesperado tras submit: ${finished.status}`);
  }

  async getJsonStructuredResponse(
    systemPrompt: string,
    userMessage: string
  ): Promise<any> {
    return this.repo.createResponse(systemPrompt, userMessage, "json_object");
  }

  async getSchemaStructuredResponse(
    systemPrompt: string,
    userMessage: string,
    schema: ZodType<any>,
    schemaLabel = "schema",
    model?: string,
  ): Promise<any> {
    this.logger.info("OpenAIService: getSchemaStructuredResponse", {
      schemaLabel,
    });
    const format = zodTextFormat(schema, schemaLabel);
    return this.repo.parseResponse(systemPrompt, userMessage, format, model);
  }

  // =========================== Helpers ===========================

  async pollUntilResolved(
    threadId: string,
    runId: string,
    timeoutMs = TIME_TO_POLL
  ): Promise<Run> {
    const start = Date.now();
    while (true) {
      const run = await this.repo.retrieveRun(threadId, runId);
      if (["completed", "requires_action", "failed", "expired"].includes(run.status)) return run;
      if (Date.now() - start > timeoutMs) throw new Error(`Run ${runId} polling timed out`);
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}