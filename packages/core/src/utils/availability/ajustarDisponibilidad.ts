import { DateTime } from "luxon";
import { formatFechaLegible } from "@clinickeys-agents/core/utils";
import { Disponibilidad } from "@clinickeys-agents/core/utils/availability/presentAndFilterAvailability";

/**
 * Ajusta la lista de disponibilidades para que solo incluya slots
 * válidos al menos 3 horas después del tiempo actual.
 *
 * - Compara con fecha+hora completas, no solo fecha.
 * - Si el slot es del mismo día y comienza antes del umbral, ajusta el inicio.
 * - Añade `fecha_legible` (ej: "Lunes, 16 de septiembre").
 *
 * @param disponibilidades Array de disponibilidades
 * @param tiempoActual Fecha/hora actual en formato ISO
 */
export function ajustarDisponibilidad(
  disponibilidades: Disponibilidad[],
  tiempoActual: string
): Disponibilidad[] {
  const DEFAULT_OFFSET_HOURS = 3;
  const now = DateTime.fromISO(tiempoActual);
  if (!now.isValid) return [];

  const minDT = now.plus({ hours: DEFAULT_OFFSET_HOURS });
  const out: Disponibilidad[] = [];

  for (const item of disponibilidades || []) {
    if (!item?.fecha_cita || !item?.hora_inicio_minima || !item?.hora_inicio_maxima) {
      continue;
    }

    const day = DateTime.fromISO(String(item.fecha_cita), { zone: minDT.zone });
    if (!day.isValid) continue;

    const [sh, sm, ss] = String(item.hora_inicio_minima)
      .split(":")
      .map((v) => parseInt(v, 10) || 0);
    const [eh, em, es] = String(item.hora_inicio_maxima)
      .split(":")
      .map((v) => parseInt(v, 10) || 0);

    let startDT = day.set({ hour: sh, minute: sm, second: ss });
    const latestStartDT = day.set({ hour: eh, minute: em, second: es });

    if (!startDT.isValid || !latestStartDT.isValid) continue;
    if (latestStartDT <= minDT) continue;

    if (startDT < minDT && startDT.hasSame(minDT, "day")) {
      startDT = minDT;
    }

    if (startDT >= latestStartDT) continue;

    const adjusted: Disponibilidad = {
      ...item,
      hora_inicio_minima: startDT.toFormat("HH:mm:ss"),
      hora_inicio_maxima: latestStartDT.toFormat("HH:mm:ss"),
      fecha_legible: formatFechaLegible(String(item.fecha_cita), now.zoneName ?? undefined),
    };

    out.push(adjusted);
  }

  return out;
}

export default ajustarDisponibilidad;