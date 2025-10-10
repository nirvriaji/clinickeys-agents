/**
 * Tipos base para Responses API (SDK v5)
 * Simplificados y adaptados a la nueva estructura basada en responses.create().
 */

export interface FunctionCallPayload {
  tool_call_id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolOutputPayload {
  tool_call_id: string;
  output: any; // Puede ser string o JSON, según la tool.
}

export interface ResponseResult {
  responseId: string;
  message?: string | null;
  functionCalls: FunctionCallPayload[];
}

/**
 * Estructuras extendidas opcionales para soporte avanzado.
 */

export interface ReasoningTrace {
  step: string;
  details?: string;
}

export interface ResponseMetadata {
  model?: string;
  created_at?: number;
  reasoning_traces?: ReasoningTrace[];
}

export interface ParsedResponse<T = any> {
  data: T;
  metadata?: ResponseMetadata;
}

export type ParsedJSONResponse<T = any> = ParsedResponse<T>;

export type ParsedSchemaResponse<T = any> = ParsedResponse<T>;