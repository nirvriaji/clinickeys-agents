/*
 * Session utilities for Kommo lead conversation lifecycle.
 * All new CFs are TEXT in Kommo. Numbers/timestamps are stored as strings.
 */

import {
  PATIENT_MESSAGE_PROCESSED_CHUNK,
  LAST_PATIENT_MESSAGE,
  PLEASE_WAIT_MESSAGE,
  PATIENT_MESSAGE,
  BOT_MESSAGE,
  RESP_ID,
  // New control CFs (TEXT)
  SESSION_ID,
  SESSION_SEQ,
  SESSION_PHASE,
  CONVERSATION_LAST_ACTIVE_MS,
} from "@clinickeys-agents/core/utils";

/**
 * Session phases for deterministic, observable runs.
 */
export type SessionPhase = "IDLE" | "ACTIVE" | "RENDERING" | "CLEAN_PENDING";

export const SESSION_PHASES: Record<SessionPhase, SessionPhase> = {
  IDLE: "IDLE",
  ACTIVE: "ACTIVE",
  RENDERING: "RENDERING",
  CLEAN_PENDING: "CLEAN_PENDING",
};

/** Ephemeral CFs that must be empty (or neutral) between patient messages. */
export const EPHEMERAL_FIELDS: readonly string[] = [
  PATIENT_MESSAGE_PROCESSED_CHUNK,
  LAST_PATIENT_MESSAGE,
  PATIENT_MESSAGE,
  BOT_MESSAGE,
  RESP_ID,
];

/**
 * Returns a mapping that resets all ephemeral CFs to empty strings and
 * ensures PLEASE_WAIT_MESSAGE is set to "false".
 */
export function getEphemeralResetMap(): Record<string, string> {
  const reset: Record<string, string> = {};
  for (const key of EPHEMERAL_FIELDS) reset[key] = "";
  // Always force neutral waiting flag at boundaries
  reset[PLEASE_WAIT_MESSAGE] = "false";
  return reset;
}

/**
 * Safe epoch-now (ms) as string.
 */
export function nowEpochMsString(): string {
  return String(Date.now());
}

/**
 * Increment a decimal number encoded as string. If invalid/empty, start at "0" then +1 => "1".
 */
export function nextSequenceString(prev?: string | null): string {
  const n = prev && /^\d+$/.test(prev) ? parseInt(prev, 10) : 0;
  return String(n + 1);
}

/**
 * Generate a v4-like UUID as string. Uses crypto.randomUUID when available,
 * with a fallback for environments without it.
 */
export function generateSessionId(): string {
  // @ts-ignore
  if (typeof globalThis !== "undefined" && typeof (globalThis as any).crypto?.randomUUID === "function") {
    // @ts-ignore
    return (globalThis as any).crypto.randomUUID();
  }
  try {
    // Node.js crypto fallback
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomUUID } = require("crypto");
    if (typeof randomUUID === "function") return randomUUID();
  } catch (_) {
    // ignore
  }
  // Minimal fallback UUIDv4 (RFC4122-ish): xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  const b = Array.from(bytes, toHex).join("");
  return `${b.substring(0, 8)}-${b.substring(8, 12)}-${b.substring(12, 16)}-${b.substring(16, 20)}-${b.substring(20)}`;
}

/**
 * Build the pre-flight patch (no Salesbot):
 * - Reset ephemerals and pleaseWait=false
 * - Start/advance session with ACTIVE phase
 */
export function buildPreFlightPatch(params: {
  prevSessionSeq?: string | null;
  newSessionId?: string; // optional injection for tests; otherwise generated
}): Record<string, string> {
  const sessionId = params.newSessionId || generateSessionId();
  const sessionSeq = nextSequenceString(params.prevSessionSeq);
  return {
    ...getEphemeralResetMap(),
    [SESSION_ID]: sessionId,
    [SESSION_SEQ]: sessionSeq,
    [SESSION_PHASE]: SESSION_PHASES.ACTIVE,
  };
}

/**
 * Build the RENDERING phase patch (no Salesbot): marks that reply was sent and we are rendering.
 */
export function buildRenderingPhasePatch(): Record<string, string> {
  return {
    [SESSION_PHASE]: SESSION_PHASES.RENDERING,
  };
}

/**
 * Build the post-flight patch (no Salesbot):
 * - Reset ephemerals and pleaseWait=false
 * - Mark CLEAN_PENDING then finalize to IDLE with lastActive timestamp.
 *
 * Use the two-step pattern in code if you want strict phase transitions. This helper
 * returns the final state (what should remain on the lead).
 */
export function buildPostFlightPatch(): Record<string, string> {
  return {
    ...getEphemeralResetMap(),
    [CONVERSATION_LAST_ACTIVE_MS]: nowEpochMsString(),
    [SESSION_PHASE]: SESSION_PHASES.IDLE,
  };
}

/**
 * Utility to quickly verify lead state matches expected sessionId.
 * Pass a simple map of CF name -> value (as strings) built from normalizedLeadCF.
 */
export function isSameSession(
  leadFieldMap: Record<string, string | undefined>,
  expectedSessionId: string
): boolean {
  return (leadFieldMap[SESSION_ID] || "") === expectedSessionId;
}

/**
 * Convert normalizedLeadCF array into a simple name->value map (string-only),
 * guarding against undefined/null values.
 */
export function toLeadFieldMap(
  normalizedLeadCF: Array<{ field_name: string; value: unknown }>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cf of normalizedLeadCF) {
    const v = cf?.value;
    out[cf.field_name] = v == null ? "" : String(v);
  }
  return out;
}