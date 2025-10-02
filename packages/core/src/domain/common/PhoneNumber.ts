/*
 * Domain Value Object: PhoneNumber
 * ------------------------------------------------------------
 * Única fuente de verdad para normalizar teléfonos provenientes
 * de texto libre (chat/usuario) o de integraciones (Kommo).
 *
 * - Totalmente inmutable
 * - Sin opcionales en su interfaz pública
 * - Listo para Clean Architecture + DDD
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Posibles estructuras que llegan desde Kommo para un teléfono.
 * No dependemos de tipos externos aquí para mantener el VO desacoplado.
 */
type KommoRawPhoneValue =
  | string
  | number
  | {
      country_code?: string | number;
      value?: string | number;
      phone?: string | number;
      // Campos adicionales que puedan aparecer no afectan la extracción.
      [k: string]: unknown;
    }
  | Array<string | number | { country_code?: string | number; value?: string | number; phone?: string | number; [k: string]: unknown }>; // a veces Kommo retorna arrays

/** Forma serializable del VO (por si se necesita loggear o enviar a capas superiores) */
export type PhoneNumberDTO = {
  e164: string; // "+34655627287" o "" si no se pudo validar
  national: string; // "655627287" o fallback a digitsOnly si no válido
  digitsOnly: string; // "34655627287" (sin '+')
  country: string; // ISO alpha-2 (e.g., "ES"), o "" si desconocido
  isValid: boolean; // true si libphonenumber lo reconoce como válido
};

export class PhoneNumber {
  private readonly _e164: string;
  private readonly _national: string;
  private readonly _digitsOnly: string;
  private readonly _country: string;
  private readonly _isValid: boolean;

  private constructor(dto: PhoneNumberDTO) {
    this._e164 = dto.e164;
    this._national = dto.national;
    this._digitsOnly = dto.digitsOnly;
    this._country = dto.country;
    this._isValid = dto.isValid;
    Object.freeze(this);
  }

  // =====================
  // Factories
  // =====================

  /**
   * Construye desde texto libre (chat/usuario/UI). Acepta basura y la limpia.
   */
  static fromFreeform(input: string | number | null | undefined, defaultCountry?: string): PhoneNumber {
    const raw = (input ?? '').toString();
    const cleaned = normalizeLooseString(raw);
    const candidate = coercePlusIfIDD(cleaned);

    const phone = tryParse(candidate, defaultCountry);

    if (phone && phone.isValid()) {
      const e164 = phone.number || '';
      const country = (phone.country || '').toString();
      const national = phone.nationalNumber?.toString?.() ?? '';
      const digitsOnly = stripNonDigits(e164 || candidate);
      return new PhoneNumber({
        e164,
        national,
        digitsOnly,
        country,
        isValid: true,
      });
    }

    // Fallback no válido: aún proveemos digitsOnly para búsquedas tolerantes
    const digitsOnly = stripNonDigits(candidate);
    return new PhoneNumber({
      e164: '',
      national: digitsOnly,
      digitsOnly,
      country: defaultCountry ? defaultCountry.toUpperCase() : '',
      isValid: false,
    });
  }

  /**
   * Construye desde valores de Kommo. Acepta string, objeto o array.
   * Unifica a un string candidate y delega al mismo flujo de parseo.
   */
  static fromKommo(raw: KommoRawPhoneValue, defaultCountry?: string): PhoneNumber {
    const candidate = extractFromKommo(raw);
    return PhoneNumber.fromFreeform(candidate, defaultCountry);
  }

  // =====================
  // Getters públicos (sin opcionales)
  // =====================

  get e164(): string { return this._e164; }
  get national(): string { return this._national; }
  get digitsOnly(): string { return this._digitsOnly; }
  get country(): string { return this._country; }
  get isValid(): boolean { return this._isValid; }

  toJSON(): PhoneNumberDTO {
    return {
      e164: this._e164,
      national: this._national,
      digitsOnly: this._digitsOnly,
      country: this._country,
      isValid: this._isValid,
    };
  }
}

// =============================================================
// Helpers internos (puros y autocontenidos)
// =============================================================

/** Quita todo lo que no sean dígitos */
function stripNonDigits(v: string): string {
  return (v || '').replace(/\D+/g, '');
}

/**
 * Limpia entradas con ruido (comillas, llaves, texto mezclado) manteniendo
 * únicamente dígitos y el '+' inicial si está presente.
 */
function normalizeLooseString(raw: string): string {
  if (!raw) return '';
  const hasPlus = raw.trim().startsWith('+');
  const digits = stripNonDigits(raw);
  return (hasPlus ? '+' : '') + digits;
}

/**
 * Convierte prefijos de marcado internacional tipo "00" en '+' para dar
 * una chance justa al parser sin asumir país por defecto incorrectamente.
 */
function coercePlusIfIDD(s: string): string {
  if (!s) return '';
  if (s.startsWith('00')) return '+' + s.slice(2);
  return s;
}

/** Intenta parsear con libphonenumber-js, usando país por defecto si aplica */
function tryParse(candidate: string, defaultCountry?: string) {
  try {
    if (!candidate) return undefined;
    if (candidate.startsWith('+')) {
      return parsePhoneNumberFromString(candidate);
    }
    // Sin '+': permitimos hint por país
    return defaultCountry
      ? // libphonenumber-js permite (text, defaultCountry)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parsePhoneNumberFromString(candidate, defaultCountry as any) || undefined)
      : parsePhoneNumberFromString(candidate) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extrae el mejor candidato posible desde estructuras variadas de Kommo.
 * - Si es array, toma el primer elemento no vacío.
 * - Si es objeto { country_code, value | phone }, concatena si hace falta.
 * - Si es string/number, lo usa directo.
 */
function extractFromKommo(raw: KommoRawPhoneValue): string {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const s = extractFromKommo(item);
      if (s) return s;
    }
    return '';
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as { country_code?: string | number; value?: string | number; phone?: string | number };

    const cc = (obj.country_code ?? '').toString().replace(/\D+/g, '');
    const val = (obj.value ?? obj.phone ?? '').toString();

    const normalizedVal = normalizeLooseString(val);

    // Si ya viene con '+', respétalo
    if (normalizedVal.startsWith('+')) return normalizedVal;

    // Si viene con IDD "00", conviértelo
    if (normalizedVal.startsWith('00')) return coercePlusIfIDD(normalizedVal);

    // Si hay country_code, construimos +<cc><digits>
    const digits = stripNonDigits(normalizedVal);
    if (cc && digits) return `+${cc}${digits}`;

    // Si no hay cc, devolvemos lo que haya (dejamos que el defaultCountry resuelva)
    return digits;
  }

  // string/number plano
  const str = (raw ?? '').toString();
  return normalizeLooseString(str);
}