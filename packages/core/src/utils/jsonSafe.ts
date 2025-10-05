/**
 * jsonSafe.ts — utilidades robustas para serializar, deserializar y sanear JSON
 *
 * Objetivos:
 * - Evitar errores típicos (cadenas sin cerrar, comillas “inteligentes”, fences de Markdown, comas finales, BOM, etc.)
 * - Extraer el primer bloque JSON válido de un texto libre (por si un LLM devolvió texto alrededor)
 * - Ofrecer stringify/parse seguros para prompts y logs
 */

// =============================
// Tipos y opciones
// =============================

export type SafeParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export interface SafeStringifyOptions {
  spaces?: number; // indentación (default 2)
  onError?: "throw" | "emptyObject" | "emptyArray" | "null"; // default "emptyObject"
  preferArrayFallback?: boolean; // si onError no es "throw" y no se puede inferir el tipo
}

export interface SafeParseOptions<T> {
  fallback?: T; // valor a devolver si falla el parse
  sanitize?: boolean; // aplicar saneos previos (default true)
}

// =============================
// Utilidades internas de saneo de texto
// =============================

const SMART_DOUBLE_QUOTES = /[\u201C\u201D\u00AB\u00BB]/g; // “ ” « »
const SMART_SINGLE_QUOTES = /[\u2018\u2019\u2032]/g; // ‘ ’ ′
const NBSP = /\u00A0/g; // &nbsp;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g; // zero-width chars
const BOM = /^\uFEFF/;

/** Elimina fences ```...``` que a veces envuelven el JSON. */
export function stripCodeFences(input: string): string {
  // Remueve triple backticks al inicio/fin, con o sin etiqueta (```json)
  let s = input.trim();
  if (s.startsWith("```")) {
    // consume primera línea
    const firstNewline = s.indexOf("\n");
    if (firstNewline !== -1) s = s.slice(firstNewline + 1);
    // quita cierre
    if (s.endsWith("```")) {
      s = s.slice(0, s.lastIndexOf("```"));
    }
  }
  return s.trim();
}

/** Normaliza comillas tipográficas a ASCII. */
export function normalizeQuotes(input: string): string {
  return input
    .replace(SMART_DOUBLE_QUOTES, '"')
    .replace(SMART_SINGLE_QUOTES, "'");
}

/** Quita BOM, no-break spaces, zero-width y normaliza saltos de línea. */
export function normalizeWhitespace(input: string): string {
  return input
    .replace(BOM, "")
    .replace(NBSP, " ")
    .replace(ZERO_WIDTH, "")
    .replace(/\r\n?|\u2028|\u2029/g, "\n")
    .trim();
}

/** Elimina comentarios // y /* *\/ estilo JS sin tocar cadenas. */
export function stripComments(input: string): string {
  let out = "";
  let i = 0;
  const n = input.length;
  let inString: false | '"' | "'" = false;
  let escaped = false;

  while (i < n) {
    const ch = input[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = false;
      }
      i++;
      continue;
    }

    // No estamos dentro de una cadena
    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i++;
      continue;
    }

    // Comentario de línea
    if (ch === "/" && input[i + 1] === "/") {
      i += 2;
      while (i < n && input[i] !== "\n") i++;
      continue;
    }

    // Comentario de bloque
    if (ch === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < n && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2; // consume */
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** Escapa caracteres de control no permitidos dentro de literales JSON. */
export function escapeControlChars(input: string): string {
  // Permitimos \t, \r, \n; el resto \u0000-\u001F se escapan
  return input.replace(/[\u0000-\u001F]/g, (m) => {
    if (m === "\n" || m === "\r" || m === "\t") return m;
    const code = m.charCodeAt(0).toString(16).padStart(4, "0");
    return `\\u${code}`;
  });
}

/** Quita comas finales antes de } o ]: {"a":1,} → {"a":1} */
export function stripTrailingCommas(input: string): string {
  return input.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Intenta extraer el primer objeto/array JSON balanceado de un texto libre.
 * Mantiene awareness de cadenas y escapes para no romper llaves internas.
 */
export function extractFirstJSONBlock(input: string): { jsonText: string; start: number; end: number } | null {
  const s = input;
  const n = s.length;
  let i = 0;
  let inString: false | '"' | "'" = false;
  let escaped = false;
  const stack: string[] = [];
  let startIdx = -1;

  while (i < n) {
    const ch = s[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      i++;
      continue;
    }

    if (ch === "{" || ch === "[") {
      if (stack.length === 0) startIdx = i;
      stack.push(ch);
      i++;
      continue;
    }

    if (ch === "}" || ch === "]") {
      const last = stack[stack.length - 1];
      if ((ch === "}" && last === "{") || (ch === "]" && last === "[")) {
        stack.pop();
        if (stack.length === 0 && startIdx !== -1) {
          const endIdx = i + 1;
          return { jsonText: s.slice(startIdx, endIdx), start: startIdx, end: endIdx };
        }
        i++;
        continue;
      } else {
        // desbalance: aborta búsqueda
        return null;
      }
    }

    i++;
  }

  return null;
}

// =============================
// Stringify/Parse seguros
// =============================

/** Stringify robusto (soporta referencias circulares y BigInt). */
export function safeStringify(value: unknown, opts: SafeStringifyOptions = {}): string {
  const spaces = Number.isFinite(opts.spaces) ? Number(opts.spaces) : 2;
  const seen = new WeakSet<object>();

  const replacer = (_k: string, v: any) => {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "symbol") return String(v);
    if (typeof v === "function") return undefined; // se omite
    if (v && typeof v === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  };

  try {
    return JSON.stringify(value, replacer, spaces);
  } catch (e) {
    if (opts.onError === "throw") throw e as Error;

    if (Array.isArray(value) || opts.onError === "emptyArray" || opts.preferArrayFallback) {
      return "[]";
    }
    if (opts.onError === "null") return "null";
    return "{}";
  }
}

/** Prepara un JSON para inyectarlo en prompts (comillas ASCII, sin control chars). */
export function toPromptJSON(value: unknown, spaces = 2): string {
  const raw = safeStringify(value, { spaces });
  // Control chars → \uXXXX; normaliza comillas tipográficas (por si hay strings del usuario)
  const cleaned = escapeControlChars(normalizeQuotes(raw));
  return cleaned;
}

/** Sanea texto que *debería* ser JSON antes de parsear. */
export function sanitizeJSONText(text: string): string {
  let s = text == null ? "" : String(text);
  s = stripCodeFences(s);
  s = normalizeWhitespace(s);
  s = normalizeQuotes(s);
  s = stripComments(s);
  s = stripTrailingCommas(s);
  s = escapeControlChars(s);
  return s.trim();
}

/** Parse seguro con saneo; intenta extraer primer bloque JSON si hace falta. */
export function safeParse<T = unknown>(text: string, options: SafeParseOptions<T> = {}): SafeParseResult<T> {
  const sanitize = options.sanitize !== false;
  let candidate = text;

  try {
    if (sanitize) candidate = sanitizeJSONText(candidate);
    // Intento directo
    return { ok: true, value: JSON.parse(candidate) as T };
  } catch (e1) {
    try {
      // Intento de extracción de primer bloque JSON
      const cleaned = sanitize ? candidate : sanitizeJSONText(candidate);
      const found = extractFirstJSONBlock(cleaned);
      if (found) {
        const inner = stripTrailingCommas(found.jsonText);
        return { ok: true, value: JSON.parse(inner) as T };
      }
      // Fallback final
      if (Object.prototype.hasOwnProperty.call(options, "fallback")) {
        return { ok: true, value: options.fallback as T };
      }
      return { ok: false, error: e1 as Error };
    } catch (e2) {
      if (Object.prototype.hasOwnProperty.call(options, "fallback")) {
        return { ok: true, value: options.fallback as T };
      }
      return { ok: false, error: e2 as Error };
    }
  }
}

// =============================
// Validadores simples
// =============================

export function isJSONObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

export function isJSONArray(x: unknown): x is unknown[] {
  return Array.isArray(x);
}

export function ensureJSONObject(x: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  return isJSONObject(x) ? (x as Record<string, unknown>) : fallback;
}

export function ensureJSONArray<T = unknown>(x: unknown, fallback: T[] = []): T[] {
  return Array.isArray(x) ? (x as T[]) : fallback;
}

// =============================
// API agrupada
// =============================

export const JSONSafe = {
  stripCodeFences,
  normalizeQuotes,
  normalizeWhitespace,
  stripComments,
  stripTrailingCommas,
  escapeControlChars,
  extractFirstJSONBlock,
  safeStringify,
  toPromptJSON,
  sanitizeJSONText,
  safeParse,
  isJSONObject,
  isJSONArray,
  ensureJSONObject,
  ensureJSONArray,
} as const;

export default JSONSafe;
