// Interfaces propias para desacoplar del SDK de OpenAI v4

export interface Assistant {
  id: string;
  name: string;
  instructions?: string;
  model: string;
  created_at?: number;
  metadata?: Record<string, any>;
}

export interface Thread {
  id: string;
  created_at?: number;
  metadata?: Record<string, any>;
}

export interface Run {
  id: string;
  status: string; // e.g., "queued" | "in_progress" | "requires_action" | "completed" | "failed" | "expired" | "cancelling"
  assistant_id: string;
  thread_id: string;
  created_at?: number;
  required_action?: {
    submit_tool_outputs?: {
      tool_calls: Array<{
        id: string;
        function: {
          name: string;
          arguments: string; // JSON string per OpenAI API
        };
      }>;
    };
  };
}

export interface OpenAIMessageResponse {
  id: string;
  role: string; // "user" | "assistant" | "tool" | ...
  content:
    | Array<{
        type: string;
        text?: { value: string };
      }>
    | { text?: { value: string } };
  created_at?: number;
}

export interface FunctionCallPayload {
  tool_call_id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface SubmitToolOutputsPayload {
  threadId: string;
  runId: string;
  toolOutputs: Array<{
    tool_call_id: string;
    output: any; // OpenAI acepta string; mantenemos any para compatibilidad ascendente de capas
  }>;
}

export interface CreateAssistantPayload {
  name: string;
  instructions: string;
  model?: string;
  temperature?: number;
  top_p?: number;
}

export interface UpdateAssistantPayload {
  instructions?: string;
}

// Resultado estándar que consumen los orquestadores/UCs
export interface ResponseResult {
  threadId: string;
  runId: string;
  message?: string;
  functionCalls?: FunctionCallPayload[];
}