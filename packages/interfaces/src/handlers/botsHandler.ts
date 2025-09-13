// packages/core/src/interface/handlers/botsHandler.ts (RESTful refactor)

import { createDynamoDocumentClient, getEnvVar } from "@clinickeys-agents/core/infrastructure/helpers";
import { BotConfigRepositoryDynamo } from "@clinickeys-agents/core/infrastructure/botConfig";
import { OpenAIGateway } from "@clinickeys-agents/core/infrastructure/integrations/openai";
import { OpenAIAssistantRepository } from "@clinickeys-agents/core/infrastructure/openai";
import { BotConfigService } from "@clinickeys-agents/core/application/services";
import { BotConfigType } from "@clinickeys-agents/core/domain/botConfig";
import { BotController } from "../controllers/BotController";
import { jsonResponse, defaultPlaceholders } from "@clinickeys-agents/core/utils";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import {
  AddBotUseCase,
  UpdateBotConfigUseCase,
  DeleteBotUseCase,
  GetBotConfigUseCase,
  ListGlobalBotConfigsUseCase,
  type UpdateBotConfigInput,
  type ListGlobalBotConfigsInput,
} from "@clinickeys-agents/core/application/usecases";

import type { Handler, APIGatewayProxyEventV2 as E, APIGatewayProxyResultV2 as R } from "aws-lambda";

// -------------------- DI --------------------
const docClient = createDynamoDocumentClient({
  region: getEnvVar("AWS_REGION"),
});

const botConfigTableName = getEnvVar("BOT_CONFIGS_TABLE_NAME");
const botConfigRepo = new BotConfigRepositoryDynamo({ tableName: botConfigTableName, docClient });
const botConfigService = new BotConfigService(botConfigRepo);

// Factory que crea un repositorio de assistants para el apiKey recibido
const openaiRepoFactory = (apiKey: string) =>
  new OpenAIAssistantRepository(new OpenAIGateway({ apiKey }));

const controller = new BotController({
  addUseCase: new AddBotUseCase(botConfigRepo, openaiRepoFactory),
  updateUseCase: new UpdateBotConfigUseCase({ botConfigService }),
  deleteUseCase: new DeleteBotUseCase({ botConfigRepo, openaiRepoFactory }),
  getUseCase: new GetBotConfigUseCase({ botConfigService }),
  listGlobalUseCase: new ListGlobalBotConfigsUseCase({ botConfigService }),
});

// -------------------- helpers --------------------
function parseBody(event: E): any | undefined {
  if (event.body == null) return undefined;

  // Soporte para base64
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return undefined;
    try {
      return JSON.parse(s);
    } catch (e: any) {
      throw new Error("Invalid JSON body");
    }
  }
  // En algunos runtimes/locals ya llega como objeto
  if (typeof raw === "object") return raw as any;
  return undefined;
}

function isValidBotConfigType(t: string): t is BotConfigType {
  return t === BotConfigType.ChatBot || t === BotConfigType.NotificationBot;
}

// -------------------- Handler --------------------
export const handler: Handler<E, R> = async (event) => {
  try {
    const { method, path } = event.requestContext.http;
    const qs = event.queryStringParameters ?? {};

    let body: any;
    try {
      body = parseBody(event);
    } catch (err: any) {
      return jsonResponse(400, { error: err.message || "Invalid JSON body" });
    }

    // ─── GET default placeholders ───────────────────────────────
    if (method === "GET" && path === "/bot-configs/default-placeholders") {
      return jsonResponse(200, defaultPlaceholders);
    }

    // --- CREATE BOT ---------------------------------------------------------
    if (method === "POST" && path === "/bots") {
      if (!body || !body.botConfigType) {
        return jsonResponse(400, { error: "Missing botConfigType" });
      }
      if (!isValidBotConfigType(body.botConfigType)) {
        return jsonResponse(400, { error: "Unknown botConfigType" });
      }

      if (body.botConfigType === BotConfigType.ChatBot) {
        await controller.addChatBot(body);
        return jsonResponse(201, { ok: true, botConfigType: BotConfigType.ChatBot });
      } else {
        await controller.addNotificationBot(body);
        return jsonResponse(201, { ok: true, botConfigType: BotConfigType.NotificationBot });
      }
    }

    // --- DELETE BOT ---------------------------------------------------------
    const deleteMatch = path.match(/^\/bots\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)$/);
    if (method === "DELETE" && deleteMatch) {
      const [, botConfigType, botConfigId, clinicSource, clinicIdStr] = deleteMatch;
      if (!isValidBotConfigType(botConfigType)) {
        return jsonResponse(400, { error: "Unknown botConfigType" });
      }
      if (botConfigType === BotConfigType.ChatBot) {
        await controller.deleteChatBot(botConfigId, clinicSource, Number(clinicIdStr));
      } else {
        await controller.deleteNotificationBot(botConfigId, clinicSource, Number(clinicIdStr));
      }
      return jsonResponse(204);
    }

    // --- UPDATE BOT-CONFIG (ahora solo por path, no por body id) ------------
    const patchMatch = path.match(/^\/bot-configs\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)$/);
    if (method === "PATCH" && patchMatch) {
      const [, botConfigType, botConfigId, clinicSource, clinicIdStr] = patchMatch;
      if (!isValidBotConfigType(botConfigType)) {
        return jsonResponse(400, { error: "Unknown botConfigType" });
      }
      if (!body) {
        return jsonResponse(400, { error: "Missing body" });
      }

      await controller.updateBotConfig({
        botConfigType: botConfigType as BotConfigType,
        botConfigId,
        clinicSource,
        clinicId: Number(clinicIdStr),
        updates: { ...body },
      } as UpdateBotConfigInput);
      return jsonResponse(200, { ok: true });
    }

    // --- GET ONE BOT-CONFIG por path ----------------------------------------
    const singleConfigMatch = path.match(/^\/bot-configs\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)$/);
    if (method === "GET" && singleConfigMatch) {
      const [, botConfigType, botConfigId, clinicSource, clinicIdStr] = singleConfigMatch;
      if (!isValidBotConfigType(botConfigType)) {
        return jsonResponse(400, { error: "Unknown botConfigType" });
      }
      const config = await controller.getBotConfig(
        botConfigType as BotConfigType,
        botConfigId,
        clinicSource,
        Number(clinicIdStr)
      );
      return jsonResponse(200, config);
    }

    // --- LIST GLOBAL BOT-CONFIGS -------------------------------------------
    if (method === "GET" && path === "/bot-configs") {
      const limit = qs.limit ? Number(qs.limit) : undefined;

      let cursor: Record<string, Record<string, any>> | undefined = undefined;
      if (qs.cursor) {
        try {
          cursor = JSON.parse(qs.cursor) as Record<string, Record<string, any>>;
        } catch {
          return jsonResponse(400, { error: "Invalid cursor format" });
        }
      }

      const result = await controller.listGlobalBotConfigs({ limit, cursor } as ListGlobalBotConfigsInput);
      return jsonResponse(200, result);
    }

    // --- ENABLE/DISABLE BOT ---------------------------------------------------
    const enableMatch = path.match(/^\/bots\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)\/enabled$/);
    if (method === "PATCH" && enableMatch) {
      const [, botConfigType, botConfigId, clinicSource, clinicIdStr] = enableMatch;
      if (!isValidBotConfigType(botConfigType)) {
        return jsonResponse(400, { error: "Unknown botConfigType" });
      }
      if (!body || typeof body.isEnabled !== "boolean") {
        return jsonResponse(400, { error: "Missing or invalid isEnabled in body" });
      }
      await controller.updateBotConfig({
        botConfigType: botConfigType as BotConfigType,
        botConfigId,
        clinicSource,
        clinicId: Number(clinicIdStr),
        updates: { isEnabled: body.isEnabled },
      } as UpdateBotConfigInput);
      return jsonResponse(200, { ok: true, isEnabled: body.isEnabled });
    }

    // -------------------- Not found ----------------------------------------
    return jsonResponse(404, { error: "Not found" });
  } catch (error: any) {
    Logger.error("Error in botsHandler:", error);
    return jsonResponse(500, { error: error.message ?? "Internal server error" });
  }
};
