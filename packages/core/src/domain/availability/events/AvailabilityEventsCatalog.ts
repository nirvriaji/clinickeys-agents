import { AvailabilityEvent, AvailabilityEventFactory } from "./AvailabilityEvent";

/**
 * Catálogo centralizado de eventos del dominio de disponibilidad.
 * Cada método representa una situación de negocio o técnica que debe registrarse.
 * Ninguno de estos eventos interrumpe el flujo de ejecución.
 */
export class AvailabilityEventCatalog {
  // -------------------
  // Eventos de negocio
  // -------------------

  static FALTA_ID_CLINICA(): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT100",
      "Falta el ID de la clínica en la solicitud.",
      "warn"
    );
  }

  static CLINICA_NO_ENCONTRADA(id_clinica: number): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT101",
      `No se encontró la clínica con ID ${id_clinica}.`,
      "warn",
      { id_clinica }
    );
  }

  static NINGUN_TRATAMIENTO_SELECCIONADO(): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT102",
      "No se ha detectado ningún tratamiento en la solicitud.",
      "warn"
    );
  }

  static NINGUNA_FECHA_SELECCIONADA(): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT103",
      "No se ha detectado ninguna fecha en la solicitud.",
      "warn"
    );
  }

  static TRATAMIENTOS_NO_ENCONTRADOS(tratamientos: string[]): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT200",
      `Los tratamientos no existen en la base de datos: ${tratamientos.join(", ")}.`,
      "warn",
      { tratamientos }
    );
  }

  static TRATAMIENTOS_NO_EXACTOS(tratamientos: string[]): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT201",
      `Ninguno de los tratamientos proporcionados coincide exactamente en la base de datos: ${tratamientos.join(", ")}.`,
      "warn",
      { tratamientos }
    );
  }

  static NINGUN_MEDICO_ENCONTRADO(tratamientos: string[]): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT202",
      `No hay médicos configurados para los tratamientos: ${tratamientos.join(", ")}.`,
      "info",
      { tratamientos }
    );
  }

  static MEDICOS_SOLICITADOS_NO_ENCONTRADOS(medicos: string[]): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT203",
      `Los médicos solicitados no se encontraron: ${medicos.join(", ")}.`,
      "warn",
      { medicos }
    );
  }

  static MEDICO_NO_ASOCIADO_A_TRATAMIENTO(medicos: string[], tratamientos: string[]): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT204",
      `El médico(s) ${medicos.join(", ")} no está asociado a los tratamientos ${tratamientos.join(", ")}.`,
      "info",
      { medicos, tratamientos }
    );
  }

  static NINGUN_ESPACIO_ENCONTRADO(tratamientos: string[], medicos: string[]): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT205",
      `No hay espacios disponibles para los tratamientos ${tratamientos.join(", ")} con los médicos [${medicos.join(", ")}].`,
      "info",
      { tratamientos, medicos }
    );
  }

  // -------------------
  // Eventos técnicos (BD / cálculo)
  // -------------------

  static ERROR_CONSULTA_SQL(detalle: string): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT300",
      `Error interno al consultar la base de datos: ${detalle}`,
      "error"
    );
  }

  static NO_PROG_MEDICOS(medicos: string[], fechas: string[]): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT301",
      `No se encontró programación para los médicos [${medicos.join(", ")}] en las fechas [${fechas.join(", ")}].`,
      "info",
      { medicos, fechas }
    );
  }

  static NO_PROG_ESPACIOS(espacios: string[], fechas: string[]): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT302",
      `No se encontró programación de espacios para [${espacios.join(", ")}] en las fechas [${fechas.join(", ")}].`,
      "info",
      { espacios, fechas }
    );
  }

  static SIN_HORARIOS_DISPONIBLES(tratamientos: string[], fechas: { fecha: string }[]): AvailabilityEvent {
    const fechasStr = fechas.map((f) => f.fecha).join(", ");
    return AvailabilityEventFactory.create(
      "EVT303",
      `No se encontraron horarios disponibles para los tratamientos [${tratamientos.join(", ")}] en las fechas: ${fechasStr}.`,
      "info",
      { tratamientos, fechas }
    );
  }

  static ERROR_CALCULO_DISPONIBILIDAD(): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT400",
      "Ocurrió un error al calcular la disponibilidad.",
      "error"
    );
  }

  static CONEXION_BD(): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT401",
      "Se ha perdido la conexión a la base de datos.",
      "error"
    );
  }

  static TIEMPO_ESPERA_BD(): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT402",
      "La consulta a la base de datos tardó demasiado.",
      "error"
    );
  }

  static ERROR_INTERNO_SERVIDOR(): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT500",
      "Error interno en el servidor.",
      "error"
    );
  }

  static ERROR_DESCONOCIDO(error: any): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT501",
      `Error desconocido: ${error?.message || String(error)}`,
      "error",
      { error }
    );
  }

  // -------------------
  // Nuevos eventos: estrategia de ranking/bloques/caché
  // -------------------

  static RANKEO_FECHAS_GENERADO(params: {
    total_fechas: number;
    horizonte_dias: number;
    primeras?: string[];
  }): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT600",
      `Ranking de fechas generado (total=${params.total_fechas}, horizonte=${params.horizonte_dias} días).`,
      "info",
      params
    );
  }

  static FECHAS_DESCARTADAS(fechas: string[], motivo?: string): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT601",
      `Fechas descartadas (${fechas.length})${motivo ? ": " + motivo : ""}.`,
      "debug",
      { fechas, motivo }
    );
  }

  static BLOQUES_PLANIFICADOS(params: { anchors: string[]; blocksCount: number; blockDays: number; forwardMaxDays: number }): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT602",
      `Bloques planificados: ${params.blocksCount} (anchors=${params.anchors.length}, blockDays=${params.blockDays}, forwardMaxDays=${params.forwardMaxDays}).`,
      "info",
      params
    );
  }

  static BLOQUE_CONSULTADO(params: { start: string; end: string; direction: "backward" | "forward"; anchor: string }): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT603",
      `Bloque consultado [${params.start}..${params.end}] (${params.direction}) ancla=${params.anchor}.`,
      "debug",
      params
    );
  }

  static BLOQUE_SIN_RESULTADOS(params: { start: string; end: string; direction: "backward" | "forward"; anchor: string }): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT604",
      `Bloque sin resultados [${params.start}..${params.end}] (${params.direction}) ancla=${params.anchor}.`,
      "info",
      params
    );
  }

  static ACUMULACION_DIAS_OBJETIVO(params: { diasCompletos: number; objetivoDias: number; divisionesCubiertas: number; divisionesObjetivo: number }): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT605",
      `Acumulación de días: ${params.diasCompletos}/${params.objetivoDias} días completos; divisiones ${params.divisionesCubiertas}/${params.divisionesObjetivo}.`,
      "info",
      params
    );
  }

  static POLICY_COMPILADA(params: { minutos_globales: number; reglas_tratamiento: number }): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT606",
      `Política compilada (minutos_globales=${params.minutos_globales}, reglas=${params.reglas_tratamiento}).`,
      "info",
      params
    );
  }

  static POLICY_COMPILER_ERROR(detalle: string): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT607",
      `Error compilando política: ${detalle}`,
      "error"
    );
  }

  static REDACTOR_RESULTADO(params: { diasMostrados: number; slots: number; longitudMensaje: number }): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT608",
      `Redactor: días=${params.diasMostrados}, slots=${params.slots}, longitud=${params.longitudMensaje}.`,
      "info",
      params
    );
  }

  static REDACTOR_ERROR(detalle: string): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT609",
      `Error en redactor de disponibilidades: ${detalle}`,
      "error"
    );
  }

  static DISCLAIMER_RANGOS(count: number): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT610",
      `Disclaimer de rangos compactados: ${count} rango(s).`,
      "debug",
      { count }
    );
  }

  static BACKWARD_FORWARD_CONFIG(params: { blockDays: number; forwardMaxDays: number }): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT611",
      `Configuración de bloques: blockDays=${params.blockDays}, forwardMaxDays=${params.forwardMaxDays}.`,
      "debug",
      params
    );
  }

  // -------------------
  // Capa de caché de búsqueda
  // -------------------

  static CACHE_HIT(key: string, meta?: Record<string, unknown>): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT620",
      `Caché hit para clave ${key}.`,
      "debug",
      { key, ...(meta || {}) }
    );
  }

  static CACHE_MISS(key: string): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT621",
      `Caché miss para clave ${key}.`,
      "debug",
      { key }
    );
  }

  static CACHE_STORE(key: string, items: number, ttlSeconds: number): AvailabilityEvent {
    return AvailabilityEventFactory.create(
      "EVT622",
      `Caché almacenada (key=${key}, items=${items}, ttl=${ttlSeconds}s).`,
      "debug",
      { key, items, ttlSeconds }
    );
  }
}