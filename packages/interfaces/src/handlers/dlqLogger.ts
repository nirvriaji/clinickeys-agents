// packages/interfaces/src/handlers/dlqLogger.ts

import type { Handler, SQSEvent } from "aws-lambda";

export const handler: Handler<SQSEvent, void> = async (event) => {
  console.error("🔴 Mensajes recibidos en la DLQ:", event.Records.length);

  for (const record of event.Records) {
    console.error("DLQ message:", {
      messageId: record.messageId,
      body: record.body,
      attributes: record.attributes,
    });
  }
};
