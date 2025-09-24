// infra/queue.ts
import { SUFFIX } from "./config";

export const chatbotQueueDLQ = new sst.aws.Queue(`chatbotQueueDLQ${SUFFIX}`, {
  fifo: { contentBasedDeduplication: false },
});

export const chatbotQueue = new sst.aws.Queue(`ChaybotQueue${SUFFIX}`, {
  fifo: { contentBasedDeduplication: false },
  visibilityTimeout: "930 seconds",
  delay: "10 seconds",
  dlq: {
    queue: chatbotQueueDLQ.arn,
    retry: 1,
  },
  transform: {
    queue: {
      messageRetentionSeconds: 180,
    }
  }
});