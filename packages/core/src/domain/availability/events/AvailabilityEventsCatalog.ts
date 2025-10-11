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
  // Eventos técnicos
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
    const fechasStr = fechas.map(f => f.fecha).join(", ");
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
}