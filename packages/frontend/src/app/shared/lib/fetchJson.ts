import { ApiError } from "@/app/shared/types/api";

/**
 * Tiny wrapper around the native `fetch` API that:
 *  1. Prepends `NEXT_PUBLIC_API_URL` to every request.
 *  2. Serialises the `body` as JSON (when provided).
 *  3. Allows `?query` object shorthand.
 *  4. Converts any non‑2xx response into a typed {@link ApiError}.
 *
 * Usage:
 * ```ts
 * const botConfigs = await fetchJson<Paginated<BotConfig>>("/bot-configs", {
 *   query: { cursor: nextCursor, limit: 20 },
 * });
 * ```
 */
export interface FetchJsonOptions
  extends Omit<RequestInit, "body" | "method"> {
  /** HTTP verb. Defaults to `GET`. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Request payload (will be `JSON.stringify`‑ed). */
  body?: unknown;
  /** Optional query‑string object — keys with `undefined` are skipped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Skip "Content‑Type: application/json" header (for file uploads, etc.). */
  skipJsonContentType?: boolean;
}

const NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function fetchJson<T = unknown>(
  path: string,
  {
    method = "GET",
    body,
    query,
    skipJsonContentType,
    headers,
    ...init
  }: FetchJsonOptions = {},
): Promise<T> {
  // Build query string (skip undefined values)
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";

  const url = `${NEXT_PUBLIC_API_URL}${path}${qs ? `?${qs}` : ""}`;

  const finalHeaders: HeadersInit = {
    Accept: "application/json",
    ...(!skipJsonContentType && { "Content-Type": "application/json" }),
    ...headers,
  };

  const response = await fetch(url, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include", // send cookies by default (adjust if not needed)
    ...init,
  });

  // Determine if the response is JSON
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  // Handle non‑OK status codes
  if (!response.ok) {
    let errorPayload: unknown = null;

    if (isJson) {
      try {
        errorPayload = await response.json();
      } catch {
        /* swallow */
      }
    } else {
      errorPayload = await response.text();
    }

    const error: ApiError = {
      name: "ApiError",
      message:
        (errorPayload as any)?.error ??
        (errorPayload as any)?.message ??
        response.statusText ??
        "Unknown error",
      status: response.status,
      data: errorPayload,
    } as ApiError;

    throw error;
  }

  // 204 No Content → return undefined
  if (response.status === 204) return undefined as unknown as T;

  // Successful non‑JSON (e.g. blob / text)
  if (!isJson) {
    return response as unknown as T;
  }

  return (await response.json()) as T;
}

export default fetchJson;
