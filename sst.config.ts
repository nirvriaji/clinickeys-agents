// sst.config.ts

/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: `clinickeys-agents-${input.stage}`,
      removal: ["saturnino", "production"].includes(input?.stage) ? "retain" : "remove",
      protect: ["saturnino", "production"].includes(input?.stage),
      home: "aws",
    };
  },
  console: {
    autodeploy: {
      target(event) {
        if (event.type === "branch" && event.branch === "main" && event.action === "pushed") {
          return { stage: "production" };
        } else if (event.type === "branch" && event.branch === "test" && event.action === "pushed") {
          return { stage: "testing" };
        }

        return;
      },
    }
  },
  async run() {
    const databases = await import("./infra/database");
    const apiGateway = await import("./infra/apigateway");
    const lambda = await import("./infra/lambda");
    const cron = await import("./infra/cron");
    await import("./infra/frontend");

    return {
      BotConfigTable: databases.botConfigDynamo.name,
      Gateway: apiGateway.botConfigApiGateway.url,
      ChatbotWebhookFn: lambda.chatbotWebhookFn.url,
      sendNotificationsUrl: cron.sendNotificationsCron.nodes.function.url,
    };
  },
});
