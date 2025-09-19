// packages/core/src/application/services/AvailabilityDomainService/availabilityHelpers.ts

import { CITAS_ESTADOS_BLOQUEO } from "@clinickeys-agents/core/utils";

// =============================
// Tipos
// =============================

export interface SQLQuery {
  text: string;
  params: Array<string | number | Date>;
}

// =============================
// Helpers
// =============================

function generarConsultaSQL({
  nombreTabla,
  listaFechas,
  listaIdMedicos = [],
  listaIdEspacios = [],
  idClinica,
}: {
  nombreTabla: "citas" | "prog_medicos" | "prog_espacios" | "prog_medico_espacio";
  listaFechas: { fecha: string }[];
  listaIdMedicos?: number[];
  listaIdEspacios?: number[];
  idClinica: number;
}): SQLQuery {
  const condicionesTiempo: string[] = [];
  const params: Array<string | number | Date> = [];

  for (const fechaObj of listaFechas) {
    if (nombreTabla === "citas") {
      condicionesTiempo.push(`fecha_cita = ?`);
      params.push(fechaObj.fecha);
    } else {
      condicionesTiempo.push(`(? BETWEEN fecha_inicio AND fecha_fin)`);
      params.push(fechaObj.fecha);
    }
  }

  const condicionesIds: string[] = [];
  if (
    listaIdMedicos.length > 0 &&
    ["citas", "prog_medicos", "prog_medico_espacio"].includes(nombreTabla)
  ) {
    condicionesIds.push(`id_medico IN (${listaIdMedicos.map(() => "?").join(", ")})`);
    params.push(...listaIdMedicos);
  }
  if (
    listaIdEspacios.length > 0 &&
    ["citas", "prog_espacios", "prog_medico_espacio"].includes(nombreTabla)
  ) {
    condicionesIds.push(`id_espacio IN (${listaIdEspacios.map(() => "?").join(", ")})`);
    params.push(...listaIdEspacios);
  }

  const condicionesClinica = [`id_clinica = ?`];
  params.push(idClinica);

  const condicionesEstado =
    nombreTabla === "citas"
      ? [`id_estado_cita IN (${CITAS_ESTADOS_BLOQUEO.join(", ")})`]
      : [];

  const whereConditions = [
    `(${condicionesTiempo.join(" OR ")})`,
    ...(condicionesIds.length > 0 ? [`(${condicionesIds.join(" OR ")})`] : []),
    `(${condicionesClinica.join(" AND ")})`,
    ...(condicionesEstado.length > 0 ? [`(${condicionesEstado.join(" AND ")})`] : []),
  ];

  return {
    text: `SELECT * FROM ${nombreTabla} WHERE ${whereConditions.join(" AND ")}`,
    params,
  };
}

// =============================
// Main
// =============================

export function AvailabilitySQLBuilder({
  fechas,
  id_medicos,
  id_espacios,
  id_clinica,
}: {
  fechas: { fecha: string }[];
  id_medicos: number[];
  id_espacios: number[];
  id_clinica: number;
}): {
  sql_citas: SQLQuery;
  sql_prog_medicos: SQLQuery;
  sql_prog_espacios: SQLQuery;
  sql_prog_medico_espacio: SQLQuery;
} {
  if (!fechas || !id_clinica) {
    throw new Error("Los campos 'fechas' e 'id_clinica' son obligatorios.");
  }

  return {
    sql_citas: generarConsultaSQL({
      nombreTabla: "citas",
      listaFechas: fechas,
      listaIdMedicos: id_medicos,
      listaIdEspacios: id_espacios,
      idClinica: id_clinica,
    }),
    sql_prog_medicos: generarConsultaSQL({
      nombreTabla: "prog_medicos",
      listaFechas: fechas,
      listaIdMedicos: id_medicos,
      idClinica: id_clinica,
    }),
    sql_prog_espacios: generarConsultaSQL({
      nombreTabla: "prog_espacios",
      listaFechas: fechas,
      listaIdEspacios: id_espacios,
      idClinica: id_clinica,
    }),
    sql_prog_medico_espacio: generarConsultaSQL({
      nombreTabla: "prog_medico_espacio",
      listaFechas: fechas,
      listaIdMedicos: id_medicos,
      listaIdEspacios: id_espacios,
      idClinica: id_clinica,
    }),
  };
}
