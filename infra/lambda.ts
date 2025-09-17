// infra/lambda.ts
import { chatbotQueue } from "./queue";
import { botConfigDynamo } from "./database";
import { SUFFIX, ENVIRONMENT } from "./config";

export const chatbotWebhookFn = new sst.aws.Function(`chatbotWebhookFn${SUFFIX}`, {
  handler: "packages/interfaces/src/handlers/leadWebhookHandler.handler",
  link: [chatbotQueue],
  timeout: "30 seconds",
  url: true,
  environment: {
    LEADS_DEBOUNCE_QUEUE_URL: chatbotQueue.url,
  },
  logging: {
    retention: "5 days"
  }
});

chatbotWebhookFn.addEnvironment({ URL: chatbotWebhookFn.url });

// Handler que procesa los mensajes de la cola
chatbotQueue.subscribe({
  handler: "packages/interfaces/src/handlers/leadProcessorHandler.handler",
  timeout: "420 seconds",
  logging: {
    retention: "5 days"
  },
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
  copyFiles: [
    {
      from: "packages/core/src/.ia/instructions/prompts/bot_extractor_de_datos.md",
    },
    {
      from: "packages/core/src/.ia/instructions/prompts/bot_extractor_consulta_cita.md",
    },
    {
      from: "packages/core/src/.ia/instructions/prompts/bot_presentador_disponibilidades.md",
    }
  ]
});