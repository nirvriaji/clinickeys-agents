// /infra/apigateway.ts

import { SUFFIX, ENVIRONMENT } from "./config";
import { botConfigDynamo } from "./database";

export const botConfigApiGateway = new sst.aws.ApiGatewayV2(`BotConfigApiGateway${SUFFIX}`, {
  cors: {
    allowOrigins: [
      "http://localhost:3000",
      "https://d3m0gnmflpv02n.cloudfront.net", // DEV
      "https://d2vvj4meqgnw27.cloudfront.net", // TESTING
      "https://d1iim6u6uriel9.cloudfront.net", // PRODUCTION
    ],
    allowCredentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: "24 hours",
  },
  accessLog: {
    retention: "5 days"
  },
  link: [botConfigDynamo],
});

const PATH_TO_CLINICS_HANDLER = "packages/interfaces/src/handlers/clinicsHandler.handler";
const PATH_TO_BOT_CONFIG_HANDLER = "packages/interfaces/src/handlers/botsHandler.handler";
const PATH_TO_KOMMO_USERS_HANDLER = "packages/interfaces/src/handlers/kommoUsersHandler.handler";

const routes = [
  ["GET /clinics", PATH_TO_CLINICS_HANDLER],
  ["GET /clinics/{id_clinic}", PATH_TO_CLINICS_HANDLER],

  // BOT CONFIG ROUTES
  ["POST /bots", PATH_TO_BOT_CONFIG_HANDLER],
  ["GET /bot-configs", PATH_TO_BOT_CONFIG_HANDLER], // list all
  ["GET /bot-configs/default-placeholders", PATH_TO_BOT_CONFIG_HANDLER],
  ["GET /bot-configs/{botConfigType}/{botConfigId}/{clinicSource}/{clinicId}", PATH_TO_BOT_CONFIG_HANDLER], // get one
  ["PATCH /bot-configs/{botConfigType}/{botConfigId}/{clinicSource}/{clinicId}", PATH_TO_BOT_CONFIG_HANDLER], // update one
  ["PATCH /bots/{botConfigType}/{botConfigId}/{clinicSource}/{clinicId}/enabled", PATH_TO_BOT_CONFIG_HANDLER], // update one
  ["DELETE /bots/{botConfigType}/{botConfigId}/{clinicSource}/{clinicId}", PATH_TO_BOT_CONFIG_HANDLER], // delete

  // KOMMO USERS ROUTE
  ["POST /kommo/users", PATH_TO_KOMMO_USERS_HANDLER],
];

for (const [route, handler] of routes) {
  botConfigApiGateway.route(route, {
    handler,
    permissions: [
      {
        actions: ["*"],
        resources: ["*"],
      },
    ],
    environment: {
      ...ENVIRONMENT,
      BOT_CONFIGS_TABLE_NAME: botConfigDynamo.name
    },
  });
}
