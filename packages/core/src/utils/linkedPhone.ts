/*
 * Domain: Conversation → Linked Phones
 * Purpose: Represent and manipulate the set of phone numbers linked to the interlocutor.
 * Notes:
 *  - Vendor-neutral: no Kommo-specific terms here.
 *  - Lightweight normalization/dedup: compare by digits-only; keep a single entry per phone.
 *  - Origin is optional and strictly informative (precedence rules applied on dedup).
 */

import { z } from "zod";

// ---------------------------------------------------------
// Public API
// ---------------------------------------------------------

/**
 * Canonical, vendor-neutral origins for a linked phone.
 */
export enum LinkedPhoneOrigin {
  ContactoPrincipal = "contacto_principal", // Contact base phone (e.g., main contact phone)
  TelefonoAdicionalEnLead = "telefono_adicional_en_lead", // Additional/secondary phone stored for the lead
  AportadoEnConversacion = "aportado_en_conversacion", // Provided ad-hoc by the user during chat
  DetectadoEnHistorial = "detectado_en_historial", // (Optional) Parsed from previous messages/logs
}

/**
 * Minimal representation of a phone linked to the interlocutor.
 */
export interface LinkedPhone {
  telefono: string; // Raw representation as provided/received. Keep formatting for traceability.
  origen?: LinkedPhoneOrigin; // Optional metadata to help with precedence, dedupe and audit.
}

/** Zod schema for runtime validation */
export const LinkedPhoneSchema = z.object({
  telefono: z.string().min(3, "Teléfono inválido"),
  origen: z.nativeEnum(LinkedPhoneOrigin).optional(),
});

/** Array schema */
export const LinkedPhoneArraySchema = z.array(LinkedPhoneSchema);

/**
 * Create a LinkedPhone after validating inputs. Throws if invalid.
 */
export function createLinkedPhone(telefono: string, origen?: LinkedPhoneOrigin): LinkedPhone {
  const candidate: LinkedPhone = { telefono: telefono.trim(), origen };
  LinkedPhoneSchema.parse(candidate);
  return candidate;
}

// ---------------------------------------------------------
// Normalization & comparison helpers (vendor-neutral)
// ---------------------------------------------------------

/**
 * Produce two lightweight normal forms for comparison:
 * - digits: only numeric characters, suitable for equality checks
 * - e164Like: keep leading "+" if present + digits (NOT a full E.164 guarantee)
 */
export function normalizePhone(telefono: string): { digits: string; e164Like: string } {
  const raw = String(telefono || "").trim();
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D+/g, "");
  const e164Like = hasPlus ? `+${digits}` : digits;
  return { digits, e164Like };
}

/**
 * Compare two raw phone strings by digits-only equality.
 */
export function isSamePhone(a: string, b: string): boolean {
  const na = normalizePhone(a).digits;
  const nb = normalizePhone(b).digits;
  return na.length > 0 && na === nb;
}

// ---------------------------------------------------------
// Dedupe & precedence
// ---------------------------------------------------------

/**
 * Origin precedence for deduplication. Lower number = higher priority.
 */
const ORIGIN_PRECEDENCE: Record<LinkedPhoneOrigin, number> = {
  [LinkedPhoneOrigin.ContactoPrincipal]: 0,
  [LinkedPhoneOrigin.TelefonoAdicionalEnLead]: 1,
  [LinkedPhoneOrigin.AportadoEnConversacion]: 2,
  [LinkedPhoneOrigin.DetectadoEnHistorial]: 3,
};

function betterOf(a?: LinkedPhone, b?: LinkedPhone): LinkedPhone | undefined {
  if (!a) return b;
  if (!b) return a;
  // Prefer one that has an origin over one without
  if (a.origen && !b.origen) return a;
  if (b.origen && !a.origen) return b;
  // If both have origins, apply precedence
  if (a.origen && b.origen) {
    const pa = ORIGIN_PRECEDENCE[a.origen];
    const pb = ORIGIN_PRECEDENCE[b.origen];
    if (pa !== pb) return pa < pb ? a : b;
  }
  // Tie-breaker: keep the first argument
  return a;
}

/**
 * Remove duplicates by phone (digits-only), keeping the entry with better origin precedence.
 */
export function dedupeLinkedPhones(list: LinkedPhone[]): LinkedPhone[] {
  const byDigits = new Map<string, LinkedPhone>();
  for (const item of list) {
    const { digits } = normalizePhone(item.telefono);
    if (!digits) continue;
    const current = byDigits.get(digits);
    const winner = betterOf(current, item) as LinkedPhone | undefined;
    if (winner) byDigits.set(digits, winner);
  }
  return Array.from(byDigits.values());
}

/**
 * Merge two lists and dedupe using origin precedence.
 */
export function mergeLinkedPhones(a: LinkedPhone[], b: LinkedPhone[]): LinkedPhone[] {
  return dedupeLinkedPhones([...(a || []), ...(b || [])]);
}

// ---------------------------------------------------------
// Builders from known sources (no vendor naming)
// ---------------------------------------------------------

export function fromContactoPrincipal(telefono: string): LinkedPhone {
  return createLinkedPhone(telefono, LinkedPhoneOrigin.ContactoPrincipal);
}

export function fromTelefonoAdicionalEnLead(telefono: string): LinkedPhone {
  return createLinkedPhone(telefono, LinkedPhoneOrigin.TelefonoAdicionalEnLead);
}

export function fromAportadoEnConversacion(telefono: string): LinkedPhone {
  return createLinkedPhone(telefono, LinkedPhoneOrigin.AportadoEnConversacion);
}

export function fromDetectadoEnHistorial(telefono: string): LinkedPhone {
  return createLinkedPhone(telefono, LinkedPhoneOrigin.DetectadoEnHistorial);
}

// ---------------------------------------------------------
// Utility: find if a number already exists in the list
// ---------------------------------------------------------

export function containsPhone(list: LinkedPhone[], telefono: string): boolean {
  const target = normalizePhone(telefono).digits;
  if (!target) return false;
  for (const item of list) {
    if (isSamePhone(item.telefono, telefono)) return true;
  }
  return false;
}

// ---------------------------------------------------------
// Utility: ensure a phone exists in the set with proper precedence
// ---------------------------------------------------------

export function upsertLinkedPhone(list: LinkedPhone[], telefono: string, origen?: LinkedPhoneOrigin): LinkedPhone[] {
  const entry = createLinkedPhone(telefono, origen);
  return dedupeLinkedPhones([...(list || []), entry]);
}

// ---------------------------------------------------------
// Narrow type guards
// ---------------------------------------------------------

export function isLinkedPhone(value: unknown): value is LinkedPhone {
  const res = LinkedPhoneSchema.safeParse(value);
  return res.success;
}

export function isLinkedPhoneArray(value: unknown): value is LinkedPhone[] {
  const res = LinkedPhoneArraySchema.safeParse(value);
  return res.success;
}