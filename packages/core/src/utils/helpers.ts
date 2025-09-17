// packages/core/src/utils/helpers.ts

import { RANDOM_STAMP } from '@clinickeys-agents/core/utils';
import { DateTime, IANAZone } from 'luxon';

// packages/core/src/utils/helpers.ts

/**
 * Parsea la respuesta dependiendo del tipo de contenido (json, text, blob)
 */
export const parseResponse = async (r: Response) => {
  const contentType = r.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    return await r.json();
  } else if (contentType.startsWith('text/')) {
    return await r.text();
  } else {
    return await r.blob();
  }
};

/**
 * Lanza un error si la respuesta no es OK y parsea el body automáticamente.
 * Si la respuesta es un error, intenta extraer el mensaje del body.
 */
export const ok = async (r: Response, url: string) => {
  if (!r.ok) {
    let errorData: any = undefined;
    try {
      errorData = await parseResponse(r);
    } catch (_) {
      // Ignorar errores de parsing para casos donde no hay body
    }
    const message = errorData?.message || r.statusText || `Request failed: ${url}`;
    const error: any = new Error(message);
    error.status = r.status;
    error.data = errorData;
    error.url = url;
    throw error;
  }
  return parseResponse(r);
};

/**
 * Helper para construir headers con auth y JSON por defecto.
 * Puedes combinar con otros headers si lo necesitas.
 */
export const hdr = (
  token: string,
  extraHeaders: Record<string, string> = {}
): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  ...extraHeaders,
});

export function canSendReminder(now: DateTime, minHour: number): boolean {
  return now.hour >= minHour;
}

export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

export function safeISODate(dt: DateTime): string {
  const iso = dt.toISODate();
  if (!iso) throw new Error("Invalid DateTime for ISO date");
  return iso;
}

/** Retorna DateTime ahora en la zona de la clínica */
export function localTime(timezone: string): DateTime {
  if (!IANAZone.isValidZone(timezone)) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
  return DateTime.utc().setZone(timezone)!;
}

export function isAppointmentSoon(appointmentDate: string, nowISO: string, tz: string): boolean {
  const now = DateTime.fromISO(nowISO, { zone: tz }).startOf('day');
  const cita = DateTime.fromISO(appointmentDate, { zone: tz }).startOf('day');
  const diff = cita.diff(now, 'days').days;
  return diff === 0 || diff === 1;
}

export function getActualTimeForPrompts(tiempoActualDT: DateTime, timezone: string) {
  const LANGUAGE = 'es';
  const weekDay = new Intl.DateTimeFormat(LANGUAGE, {
    weekday: 'long',
    timeZone: timezone,
  }).format(tiempoActualDT.toJSDate());
  const fechaISO = tiempoActualDT.toISODate() + "T00:00:00.000Z";
  const hora = tiempoActualDT.toFormat("HH:mm") + ":00";

  return `Hoy es ${weekDay}, fecha ${fechaISO} y hora ${hora}`;
}

/** Convierte fecha u objeto Date a DateTime en TZ */
export const parseClinicDate = (d: string | Date, tz: string) =>
  (typeof d === 'string' ? DateTime.fromISO(d, { zone: tz }) : DateTime.fromJSDate(d, { zone: tz }));

// --- 1. Obtener el valor de un custom field desde custom_fields_values de Kommo --- //
export function getCustomFieldValue(
  customFields: { field_id?: number | string; field_name?: string; values?: { value: string }[] }[],
  fieldName: string,
  key: "field_name" | "field_id" = "field_name"
): string {
  const field = customFields.find((item) => item[key] === fieldName);
  return field?.values?.[0]?.value || "";
}

// --- 4. Helper profesional y DDD para esperar y verificar si un campo cambió en Kommo --- //
type ShouldLambdaContinueParams = {
  latestLead: { custom_fields_values: any[] };
  initialValue: string;
};

export async function shouldLambdaContinue({
  latestLead,
  initialValue,
}: ShouldLambdaContinueParams): Promise<boolean> {
  // Siempre comparamos el counter
  const current = getCustomFieldValue(
    latestLead.custom_fields_values || [],
    RANDOM_STAMP
  );
  // La lambda sigue solo si el counter no cambió
  return current === initialValue;
}

export function formatFechaCita(fecha: string) {
  if (fecha && !fecha.includes("T")) {
    return `${fecha}T00:00:00.000Z`;
  }
  return fecha;
}

export function mapKommoCustomFields(requiredCustomFields: string[], allFields: { name: string; type: string }[]) {
  return requiredCustomFields.map(name => {
    const field = allFields.find(f => f.name === name && f.type === "textarea");
    return {
      field_name: name,
      field_type: field ? field.type : "",
      exists: !!field,
    };
  });
}

export function sanitizeComment(input: string, maxLen = 600): string {
  const txt = (input || "").toString().trim().replace(/\s+/g, " ");
  return txt.length > maxLen ? txt.slice(0, maxLen - 1) + "…" : txt;
}

/**
 * Devuelve una representación legible en español tipo: "Lunes, 16 de septiembre".
 *
 * @param isoDate Cadena ISO de fecha o fecha+hora (ej.: "2025-09-16" o "2025-09-16T10:00:00-05:00")
 * @param zone Zona horaria IANA (ej.: "America/Lima"). Si se omite, usa "America/Lima" por defecto.
 * @param locale Locale a usar para nombres (por defecto "es-PE").
 */
export function formatFechaLegible(
  isoDate: string,
  zone?: string,
  locale: string = "es-PE"
): string {
  const z = zone ?? "America/Lima";
  const dt = DateTime.fromISO(isoDate, { zone: z, locale });
  if (!dt.isValid) return isoDate;

  const weekday = dt.setLocale(locale).toFormat("cccc"); // lunes
  const day = dt.toFormat("d"); // 16
  const month = dt.setLocale(locale).toFormat("LLLL"); // septiembre

  const weekdayCap = capitalizeFirst(weekday);
  const monthLower = (month || "").toLowerCase();

  return `${weekdayCap}, ${day} de ${monthLower}`;
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Convierte los placeholders de configuración en un bloque de contexto legible.
 * Esto permite pasarlos al assistant como parte del mensaje del usuario
 * (en RecognizeUserIntent y CommunicateWithAssistant), excepto los que estén en la blacklist.
 */
export function mergePlaceholdersIntoContext(
  placeholders: Record<string, string | undefined> = {}
): string {
  if (!placeholders || Object.keys(placeholders).length === 0) {
    return "";
  }

  // Lista de placeholders que no deben incluirse en el contexto
  const EXCLUDED_KEYS = new Set<string>(["CONFIGURACION_DE_DISPONIBILIDADES"]);

  const entries = Object.entries(placeholders)
    .filter(([key, value]) => !EXCLUDED_KEYS.has(key) && value != null && value !== "")
    .map(([key, value]) => `${key}: ${value}`);

  if (entries.length === 0) {
    return "";
  }

  return `\n\n=== CONTEXTO_PLACEHOLDERS ===\n${entries.join("\n")}\n============================\n`;
}