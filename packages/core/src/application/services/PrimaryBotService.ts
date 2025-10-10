// packages/core/src/application/services/PrimaryBotService.ts

import path from "path";
import { readFile } from "fs/promises";

import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { OpenAIService } from "@clinickeys-agents/core/application/services";
import { ConversationContextService } from "@clinickeys-agents/core/application/services/ConversationContextService";

import type { BotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";
import type { KommoCustomFieldValueBase } from "@clinickeys-agents/core/infrastructure/integrations/kommo";
import type {
  ResponseResult,
  FunctionCallPayload,
  ToolOutputPayload,
} from "@clinickeys-agents/core/infrastructure/integrations/openai/models";

/**
 * PrimaryBotService
 *
 * Orquesta el flujo de conversación completo con OpenAI Responses v5 (function calling)
 * usando un único prompt de sistema (principal_bot.md) y el contexto compilado.
 *
 * Soporta encadenamiento con `previous_response_id` para que el modelo continúe
 * el razonamiento entre turnos sin reiniciar.
 */
export class PrimaryBotService {
  private static cachedSystemPrompt: string | null = null;

  constructor(
    private readonly openAIService: OpenAIService,
    private readonly contextService: ConversationContextService,
    private readonly logger: typeof Logger = Logger
  ) {}

  // =============================
  // Config (límites defensivos)
  // =============================
  private readonly MAX_TOOL_CYCLES = 6; // máximo número de rondas tool→output→continuar
  private readonly MAX_WALLTIME_MS = 240_000; // 4 minutos tope por conversación

  // =============================
  // Prompt de sistema (cacheado)
  // =============================
  private async loadSystemPrompt(): Promise<string> {
    if (PrimaryBotService.cachedSystemPrompt) return PrimaryBotService.cachedSystemPrompt;

    const promptsPath = path.resolve(
      __dirname,
      "packages/core/src/.ia/instructions/prompts/bot_principal.md"
    );

    try {
      const md = await readFile(promptsPath, "utf8");
      PrimaryBotService.cachedSystemPrompt = md;
      this.logger.info("[PrimaryBotService] Prompt principal cargado", { promptsPath });
      return md;
    } catch (err) {
      this.logger.error("[PrimaryBotService] No se pudo leer el prompt principal", { err });
      // Fallback mínimo pero seguro: evita fallar duro si falta el archivo
      const fallback =
        "Eres un asistente clínico conversacional. Usa herramientas cuando sea necesario, y responde siempre con lenguaje claro y empático.";
      PrimaryBotService.cachedSystemPrompt = fallback;
      return fallback;
    }
  }

  // =============================
  // API pública
  // =============================
  public async converse(input: {
    botConfig: BotConfigDTO;
    leadId: number;
    normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
    userMessage: string;
    reminderMessage?: string;
    /**
     * Ejecuta la tool local en backend y devuelve el resultado crudo
     * que será reenviado a OpenAI como function_call_output.
     */
    toolExecutor: (name: string, args: Record<string, any>) => Promise<any>;
    /** Modelo opcional para esta conversación (sino usa el default del gateway). */
    model?: string;
    /** Si llega, se continúa la conversación con previous_response_id en Responses v5. */
    previousResponseId?: string;
  }): Promise<{
    success: boolean;
    message: string;
    responseId: string;
    finalCalls?: FunctionCallPayload[];
  }> {
    const {
      botConfig,
      leadId,
      userMessage,
      reminderMessage,
      toolExecutor,
      model,
      previousResponseId,
    } = input;

    const startTs = Date.now();

    // 1) Preparar prompts y contexto
    const systemPrompt = await this.loadSystemPrompt();
    const context = await this.contextService.build(
      botConfig,
      leadId,
      userMessage,
      reminderMessage,
    );

    this.logger.info("[PrimaryBotService] Conversación iniciada", {
      leadId,
      model,
      wallMaxMs: this.MAX_WALLTIME_MS,
      toolCycleMax: this.MAX_TOOL_CYCLES,
      hasPrev: !!previousResponseId,
    });

    // 2) Primera/continua response con tools habilitadas
    let current: ResponseResult;
    if (previousResponseId) {
      // Continuar el hilo lógico de Responses v5
      current = await this.openAIService.continueResponse(
        previousResponseId,
        context.userPayloadJSON, // enviar SOLO el payload de usuario
        true, // useTools
        model
      );
    } else {
      // Nueva conversación
      current = await this.openAIService.getResponseWithTools(
        systemPrompt,
        context.userPayloadJSON, // enviar SOLO el payload de usuario
        model
      );
    }

    // 3) Resolver llamadas a tools de forma iterativa (varias rondas)
    for (let cycle = 0; cycle < this.MAX_TOOL_CYCLES; cycle++) {
      if (Date.now() - startTs > this.MAX_WALLTIME_MS) {
        this.logger.warn("[PrimaryBotService] Corte por walltime", { leadId, cycle });
        break;
      }

      const calls: FunctionCallPayload[] = current.functionCalls || [];
      const hasCalls = calls.length > 0;

      this.logger.info("[PrimaryBotService] Iteración tools", {
        cycle,
        hasCalls,
        count: calls.length,
        responseId: current.responseId,
      });

      if (!hasCalls) break; // No hay más tools → el próximo paso debe ser mensaje final

      // Ejecutar todas las tools reportadas por el modelo
      const outputs: ToolOutputPayload[] = [];
      for (const call of calls) {
        try {
          this.logToolInvocation(call);
          const out = await toolExecutor(call.name, call.arguments || {});
          outputs.push({ tool_call_id: call.tool_call_id, output: out });
        } catch (err) {
          this.logger.error("[PrimaryBotService] Error ejecutando tool", {
            name: call.name,
            err,
          });
          // Siempre respondemos algo al modelo para que pueda recuperarse
          outputs.push({ tool_call_id: call.tool_call_id, output: { error: String(err) } });
        }
      }

      // Reenviar salidas de tools y continuar la response en el mismo hilo lógico
      current = await this.openAIService.continueResponseWithToolOutputs(
        current.responseId,
        outputs,
        model
      );

      // Si el modelo ya emitió texto final, paramos el loop
      if (current.message && !current.functionCalls?.length) break;
    }

    const elapsed = Date.now() - startTs;

    // 4) Resultado final
    const finalMessage =
      current.message ||
      "Gracias, he registrado su solicitud. Si necesita algo más, dígame por favor.";

    this.logger.info("[PrimaryBotService] Conversación finalizada", {
      leadId,
      responseId: current.responseId,
      elapsedMs: elapsed,
      truncatedByWalltime: elapsed > this.MAX_WALLTIME_MS,
      remainingCalls: current.functionCalls?.length || 0,
    });

    return {
      success: true,
      message: finalMessage,
      responseId: current.responseId,
      finalCalls: current.functionCalls,
    };
  }

  // =============================
  // Utils
  // =============================
  private logToolInvocation(call: FunctionCallPayload) {
    try {
      this.logger.info("[PrimaryBotService] Tool call", {
        tool_call_id: call.tool_call_id,
        name: call.name,
        argKeys: Object.keys(call.arguments || {}),
      });
    } catch {
      // no-op logging safeguard
    }
  }
}

export default PrimaryBotService;