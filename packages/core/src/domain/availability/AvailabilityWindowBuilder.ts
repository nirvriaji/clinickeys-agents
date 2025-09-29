// packages/core/src/domain/availability/AvailabilityWindowBuilder.ts

import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import {
  SlotDisponibilidad,
  TratamientoEntrada,
  ProgramacionMedicoRow,
  ProgramacionEspacioRow,
  ProgramacionMedicoEspacioRow,
  CitaProgramadaRow,
  Ventana,
} from "@clinickeys-agents/core/domain/availability";

import {
  toMinutes,
  toHHMMSS,
  ymd,
  isSameYMD,
  intersectRange,
  subtractRanges,
} from "@clinickeys-agents/core/utils";

// =============================
// Builders (raw windows)
// =============================

export function buildGeneralRaw(
  tratamientos: TratamientoEntrada[],
  prog_medicos: ProgramacionMedicoRow[],
  prog_espacios: ProgramacionEspacioRow[]
): Ventana[] {
  const out: Ventana[] = [];

  for (const t of tratamientos) {
    const { id_tratamiento, nombre_tratamiento, duracion_tratamiento } =
      t.tratamiento;

    for (const med of t.medicos) {
      const pmList = prog_medicos.filter((pm) => pm.id_medico === med.id_medico);

      for (const esp of med.espacios) {
        const peList = prog_espacios.filter((pe) => pe.id_espacio === esp.id_espacio);

        for (const pm of pmList) {
          for (const pe of peList) {
            if (!isSameYMD(pm.fecha_inicio, pe.fecha_inicio)) continue;
            if (pm.hora_inicio >= pm.hora_fin || pe.hora_inicio >= pe.hora_fin) continue;

            const inter = intersectRange(
              toMinutes(pm.hora_inicio),
              toMinutes(pm.hora_fin),
              toMinutes(pe.hora_inicio),
              toMinutes(pe.hora_fin)
            );

            Logger.debug("[AWB] Intersección prog médico/espacio", {
              fecha: ymd(pm.fecha_inicio),
              id_medico: med.id_medico,
              nombre_medico: med.nombre_medico,
              id_espacio: esp.id_espacio,
              nombre_espacio: esp.nombre_espacio,
              tratamiento: { id_tratamiento, nombre_tratamiento, duracion_tratamiento },
              r_medico: { start: pm.hora_inicio, end: pm.hora_fin },
              r_espacio: { start: pe.hora_inicio, end: pe.hora_fin },
              r_inter: inter ? { start: toHHMMSS(inter[0]), end: toHHMMSS(inter[1]) } : null,
            });

            if (!inter) continue;

            out.push({
              fecha_cita: ymd(pm.fecha_inicio),
              id_medico: med.id_medico,
              nombre_medico: med.nombre_medico,
              id_espacio: esp.id_espacio,
              nombre_espacio: esp.nombre_espacio,
              id_tratamiento,
              nombre_tratamiento,
              duracion_tratamiento,
              startMin: inter[0],
              endMin: inter[1],
              origen: "general",
            });
          }
        }
      }
    }
  }

  Logger.info("[AWB] Ventanas generales construidas", { count: out.length });
  return out;
}

export function buildSpecificRaw(
  tratamientos: TratamientoEntrada[],
  prog_medico_espacio: ProgramacionMedicoEspacioRow[]
): Ventana[] {
  const out: Ventana[] = [];

  for (const pme of prog_medico_espacio) {
    const fecha_cita = ymd(pme.fecha_inicio);
    const start = toMinutes(pme.hora_inicio);
    const end = toMinutes(pme.hora_fin);
    if (start >= end) continue;

    for (const t of tratamientos) {
      const { id_tratamiento, nombre_tratamiento, duracion_tratamiento } =
        t.tratamiento;

      const medico = t.medicos.find((m) => m.id_medico === pme.id_medico);
      if (!medico) continue;
      const espacio = medico.espacios.find((e) => e.id_espacio === pme.id_espacio);
      if (!espacio) continue;

      const ventana: Ventana = {
        fecha_cita,
        id_medico: medico.id_medico,
        nombre_medico: medico.nombre_medico,
        id_espacio: espacio.id_espacio,
        nombre_espacio: espacio.nombre_espacio,
        id_tratamiento,
        nombre_tratamiento,
        duracion_tratamiento,
        startMin: start,
        endMin: end,
        origen: "especifica",
      };

      Logger.debug("[AWB] Ventana específica detectada", {
        fecha: ventana.fecha_cita,
        id_medico: ventana.id_medico,
        nombre_medico: ventana.nombre_medico,
        id_espacio: ventana.id_espacio,
        nombre_espacio: ventana.nombre_espacio,
        tratamiento: { id_tratamiento, nombre_tratamiento, duracion_tratamiento },
        rango: { start: toHHMMSS(start), end: toHHMMSS(end) },
      });

      out.push(ventana);
    }
  }

  Logger.info("[AWB] Ventanas específicas construidas", { count: out.length });
  return out;
}

// =============================
// Merge & dedup
// =============================

function ventanaKey(v: Ventana): string {
  return [
    v.fecha_cita,
    v.id_medico,
    v.id_espacio,
    v.id_tratamiento,
    v.startMin,
    v.endMin,
  ].join("|");
}

export function mergeWindows(a: Ventana[], b: Ventana[]): Ventana[] {
  const map = new Map<string, Ventana>();
  let duplicates = 0;
  let overridesToSpecific = 0;

  const add = (v: Ventana) => {
    const k = ventanaKey(v);
    if (!map.has(k)) {
      map.set(k, { ...v });
    } else {
      duplicates++;
      const prev = map.get(k)!;
      if (v.origen === "especifica" && prev.origen !== "especifica") {
        overridesToSpecific++;
        map.set(k, { ...prev, origen: "especifica" });
      }
    }
  };

  a.forEach(add);
  b.forEach(add);
  const merged = Array.from(map.values());

  Logger.info("[AWB] Merge de ventanas (general + específica)", {
    generales: a.length,
    especificas: b.length,
    merged: merged.length,
    duplicates,
    overridesToSpecific,
  });

  return merged;
}

// =============================
// Subtract appointments (apply once)
// =============================

interface Range {
  start: number;
  end: number;
}

export function subtractAppointments(
  ventanas: Ventana[],
  citas: CitaProgramadaRow[]
): Ventana[] {
  if (!ventanas.length) return [];
  if (!citas || !citas.length) return ventanas;

  const citasByFecha = new Map<string, CitaProgramadaRow[]>();
  for (const c of citas) {
    const f = ymd(c.fecha_cita);
    const list = citasByFecha.get(f) || [];
    list.push(c);
    citasByFecha.set(f, list);
  }

  Logger.info("[AWB] Citas agrupadas por fecha", {
    fechas: Array.from(citasByFecha.keys()),
  });

  const out: Ventana[] = [];

  for (const v of ventanas) {
    const dayCitas = citasByFecha.get(v.fecha_cita) || [];

    const blocks: Range[] = [];
    for (const c of dayCitas) {
      // Bloquea si coincide médico O espacio
      if (c.id_medico !== v.id_medico && c.id_espacio !== v.id_espacio) continue;
      const r = intersectRange(
        v.startMin,
        v.endMin,
        toMinutes(c.hora_inicio),
        toMinutes(c.hora_fin)
      );
      if (r) blocks.push({ start: r[0], end: r[1] });
    }

    Logger.debug("[AWB] Resta de citas en ventana", {
      fecha: v.fecha_cita,
      id_medico: v.id_medico,
      nombre_medico: v.nombre_medico,
      id_espacio: v.id_espacio,
      nombre_espacio: v.nombre_espacio,
      base: { start: toHHMMSS(v.startMin), end: toHHMMSS(v.endMin) },
      bloques: blocks.map((b) => ({ start: toHHMMSS(b.start), end: toHHMMSS(b.end) })),
      totalCitasDia: dayCitas.length,
    });

    const free = subtractRanges({ start: v.startMin, end: v.endMin }, blocks);

    Logger.debug("[AWB] Huecos libres resultantes", {
      fecha: v.fecha_cita,
      id_medico: v.id_medico,
      id_espacio: v.id_espacio,
      libres: free.map((fr) => ({ start: toHHMMSS(fr.start), end: toHHMMSS(fr.end) })),
    });

    for (const fr of free) {
      out.push({ ...v, startMin: fr.start, endMin: fr.end });
    }
  }

  Logger.info("[AWB] Ventanas libres tras restar citas", { count: out.length });
  return out;
}

// =============================
// Windows → Slots
// =============================

export function windowsToSlots(ventanas: Ventana[]): SlotDisponibilidad[] {
  const slots: SlotDisponibilidad[] = [];

  for (const v of ventanas) {
    const latestStart = v.endMin - v.duracion_tratamiento; // inclusivo
    if (latestStart < v.startMin) {
      Logger.debug("[AWB] Ventana descartada (sin espacio suficiente)", {
        fecha: v.fecha_cita,
        id_medico: v.id_medico,
        id_espacio: v.id_espacio,
        duracion: v.duracion_tratamiento,
        rango: { start: toHHMMSS(v.startMin), end: toHHMMSS(v.endMin) },
      });
      continue;
    }

    const slot: SlotDisponibilidad = {
      fecha_cita: v.fecha_cita,
      hora_inicio_minima: toHHMMSS(v.startMin),
      hora_inicio_maxima: toHHMMSS(latestStart),
      id_medico: v.id_medico,
      nombre_medico: v.nombre_medico,
      id_espacio: v.id_espacio,
      nombre_espacio: v.nombre_espacio,
      id_tratamiento: v.id_tratamiento,
      nombre_tratamiento: v.nombre_tratamiento,
      duracion_tratamiento: v.duracion_tratamiento,
      especifica: v.origen === "especifica",
    };

    Logger.debug("[AWB] Slot emitido", {
      fecha: slot.fecha_cita,
      id_medico: slot.id_medico,
      id_espacio: slot.id_espacio,
      duracion: slot.duracion_tratamiento,
      hora_inicio_minima: slot.hora_inicio_minima,
      hora_inicio_maxima: slot.hora_inicio_maxima,
      origen: v.origen,
    });

    slots.push(slot);
  }

  Logger.info("[AWB] Slots construidos a partir de ventanas", { count: slots.length });
  return slots;
}

// =============================
// Orquestador principal
// =============================

export function AvailabilityWindowBuilder(input: {
  tratamientos: TratamientoEntrada[];
  citas_programadas: CitaProgramadaRow[];
  prog_medicos: ProgramacionMedicoRow[];
  prog_espacios: ProgramacionEspacioRow[];
  prog_medico_espacio: ProgramacionMedicoEspacioRow[];
}): SlotDisponibilidad[] {
  if (!input.tratamientos.length) {
    Logger.warn("[AWB] No se recibieron tratamientos, disponibilidad vacía");
    return [];
  }

  Logger.info("[AWB] Inicio AvailabilityWindowBuilder", {
    tratamientos: input.tratamientos.length,
    citas_programadas: input.citas_programadas?.length || 0,
    prog_medicos: input.prog_medicos?.length || 0,
    prog_espacios: input.prog_espacios?.length || 0,
    prog_medico_espacio: input.prog_medico_espacio?.length || 0,
  });

  const generalRaw = buildGeneralRaw(
    input.tratamientos,
    input.prog_medicos,
    input.prog_espacios
  );

  const specificRaw = buildSpecificRaw(
    input.tratamientos,
    input.prog_medico_espacio
  );

  const allRaw = mergeWindows(generalRaw, specificRaw);
  Logger.info("[AWB] Total de ventanas (raw)", { count: allRaw.length });

  const freeWindows = subtractAppointments(allRaw, input.citas_programadas);
  Logger.info("[AWB] Total de ventanas libres tras restar citas", { count: freeWindows.length });

  const slots = windowsToSlots(freeWindows);
  Logger.info("[AWB] Total de slots calculados", { count: slots.length });

  Logger.debug(`[AWB] Slots ejemplo (primeros 5)`, slots.slice(0, 5));
  return slots;
}