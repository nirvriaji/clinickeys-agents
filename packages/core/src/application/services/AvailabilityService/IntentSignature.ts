import crypto from "crypto";

export function buildIntentSignature(payload: {
  tratamiento_ids?: number[];
  medico_ids?: number[];
  espacio_ids?: number[];
  fechas_texto?: string;
  horas?: string;
  timezone: string;
}): string {
  const norm = JSON.stringify({
    tratamiento_ids: (payload.tratamiento_ids || []).slice().sort(),
    medico_ids: (payload.medico_ids || []).slice().sort(),
    espacio_ids: (payload.espacio_ids || []).slice().sort(),
    fechas_texto: (payload.fechas_texto || "").trim().toLowerCase(),
    horas: (payload.horas || "").trim().toLowerCase(),
    timezone: payload.timezone,
  });
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16);
}
