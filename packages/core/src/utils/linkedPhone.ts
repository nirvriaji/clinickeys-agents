/*
 * Domain: Conversation → Linked Phones
 * Purpose: Represent and manipulate the set of phone numbers linked to the interlocutor.
 * Scope: Vendor-neutral (no provider terms). Focus on business rules: origin, precedence, dedupe, upsert.
 */

import { z } from "zod";
import { PhoneNumber } from "@clinickeys-agents/core/domain/common";

// ---------------------------------------------------------
// Public API
// ---------------------------------------------------------

/**
 * Canonical, vendor-neutral origins for a linked phone.
 */
export enum LinkedPhoneOrigin {
  ContactoPrincipal = "contacto_principal", // Contact base phone (main contact phone)
  TelefonoAdicionalEnLead = "telefono_adicional_en_lead", // Additional/secondary phone stored for the lead
  AportadoEnConversacion = "aportado_en_conversacion", // Provided on-the-fly by the user in chat
  DetectadoEnHistorial = "detectado_en_historial", // Parsed from previous messages/logs
}

/**
 * Minimal representation of a phone linked to the interlocutor.
 */
export interface LinkedPhone {
  telefono: string; // Raw representation as provided/received. Keep formatting for traceability.
  origen?: LinkedPhoneOrigin; // Optional metadata to help precedence/dedupe/audit.
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
  const candidate: LinkedPhone = { telefono: String(telefono || "").trim(), origen };
  LinkedPhoneSchema.parse(candidate);
  return candidate;
}

// ---------------------------------------------------------
// Normalization & comparison helpers (reuse PhoneNumber VO)
// ---------------------------------------------------------

function digitsOnly(raw: string, defaultCountry?: string): string {
  const pn = PhoneNumber.fromFreeform(raw, (defaultCountry || "").toUpperCase());
  return pn.digitsOnly || "";
}

function samePhone(a: string, b: string, defaultCountry?: string): boolean {
  const da = digitsOnly(a, defaultCountry);
  const db = digitsOnly(b, defaultCountry);
  return da.length > 0 && da === db;
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

function choosePreferable(a?: LinkedPhone, b?: LinkedPhone): LinkedPhone | undefined {
  if (!a) return b;
  if (!b) return a;
  // Prefer entry with origin over one without
  if (a.origen && !b.origen) return a;
  if (b.origen && !a.origen) return b;
  // If both have origins, apply precedence
  if (a.origen && b.origen) {
    const pa = ORIGIN_PRECEDENCE[a.origen];
    const pb = ORIGIN_PRECEDENCE[b.origen];
    if (pa !== pb) return pa < pb ? a : b;
  }
  // Tie-breaker: keep the first
  return a;
}

/**
 * Remove duplicates by phone (digits-only), keeping the entry with better origin precedence.
 * `defaultCountry` is optional, but improves robustness when numbers lack `+`.
 */
export function dedupeLinkedPhones(list: LinkedPhone[], defaultCountry?: string): LinkedPhone[] {
  const byDigits = new Map<string, LinkedPhone>();
  for (const item of list || []) {
    if (!item || !item.telefono) continue;
    const key = digitsOnly(item.telefono, defaultCountry);
    if (!key) continue;
    const current = byDigits.get(key);
    const winner = choosePreferable(current, item);
    if (winner) byDigits.set(key, winner);
  }
  return Array.from(byDigits.values());
}

/**
 * Merge two lists and dedupe using origin precedence.
 */
export function mergeLinkedPhones(a: LinkedPhone[], b: LinkedPhone[], defaultCountry?: string): LinkedPhone[] {
  return dedupeLinkedPhones([...(a || []), ...(b || [])], defaultCountry);
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

export function containsPhone(list: LinkedPhone[], telefono: string, defaultCountry?: string): boolean {
  const targetDigits = digitsOnly(telefono, defaultCountry);
  if (!targetDigits) return false;
  for (const item of list || []) {
    if (!item || !item.telefono) continue;
    if (samePhone(item.telefono, telefono, defaultCountry)) return true;
  }
  return false;
}

// ---------------------------------------------------------
// Utility: ensure a phone exists in the set with proper precedence
// ---------------------------------------------------------

export function upsertLinkedPhone(
  list: LinkedPhone[],
  telefono: string,
  origen?: LinkedPhoneOrigin,
  defaultCountry?: string
): LinkedPhone[] {
  const entry = createLinkedPhone(telefono, origen);
  return dedupeLinkedPhones([...(list || []), entry], defaultCountry);
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