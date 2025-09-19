// packages/core/src/application/services/AvailabilityDomainService/AvailabilityError.ts

export class AvailabilityError extends Error {
  code: string;
  context: Record<string, any>;
  isLogOnly: boolean;

  constructor({
    code,
    humanMessage,
    context = {},
    isLogOnly = false,
  }: {
    code: string;
    humanMessage: string;
    context?: Record<string, any>;
    isLogOnly?: boolean;
  }) {
    super(humanMessage);
    this.name = "AvailabilityError";
    this.code = code;
    this.context = context;
    this.isLogOnly = isLogOnly;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      success: false,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }

  toString() {
    let base = `[${this.code}] ${this.message}`;
    if (Object.keys(this.context).length > 0) {
      base += ` | Context: ${JSON.stringify(this.context)}`;
    }
    return base;
  }

  // -------------------
  // Errores de negocio
  // -------------------

  static FALTA_ID_CLINICA() {
    return new AvailabilityError({
      code: "ERR100",
      humanMessage:
        "Falta el ID de la clínica en la solicitud. Por favor avisar al equipo de desarrollo.",
    });
  }

  static CLINICA_NO_ENCONTRADA(id_clinica: number) {
    return new AvailabilityError({
      code: "ERR202",
      humanMessage: `No se encontró la clínica con ID ${id_clinica}. Por favor, verifique la información o contacte al soporte.`,
      context: { id_clinica },
    });
  }

  static NINGUN_TRATAMIENTO_SELECCIONADO() {
    return new AvailabilityError({
      code: "ERR101",
      humanMessage:
        "No se ha detectado ningún tratamiento en la solicitud. Por favor avisar al equipo de desarrollo.",
    });
  }

  static NINGUNA_FECHA_SELECCIONADA() {
    return new AvailabilityError({
      code: "ERR102",
      humanMessage:
        "No se ha detectado ninguna fecha en la solicitud. Por favor avisar al equipo de desarrollo.",
    });
  }

  static TRATAMIENTOS_NO_ENCONTRADOS(tratamientos: string[] = []) {
    return new AvailabilityError({
      code: "ERR200",
      humanMessage: `Los tratamientos en la solicitud no existen en la base de datos: ${tratamientos.join(
        ", "
      )}. Por favor, revise si existe o cree los tratamientos.`,
      context: { tratamientos },
    });
  }

  static TRATAMIENTOS_NO_EXACTOS(tratamientos: string[] = []) {
    return new AvailabilityError({
      code: "ERR201",
      humanMessage: `Ninguno de los tratamientos proporcionados coincide exactamente en la base de datos: ${tratamientos.join(
        ", "
      )}. Por favor, revise o ajuste los nombres de los tratamientos.`,
      context: { tratamientos },
    });
  }

  static NINGUN_MEDICO_ENCONTRADO(tratamientos: string[] = []) {
    return new AvailabilityError({
      code: "ERR202",
      humanMessage: `No hay médicos configurados para el tratamiento(s) "${tratamientos.join(
        ", "
      )}".`,
      context: { tratamientos },
      isLogOnly: true,
    });
  }

  static MEDICOS_SOLICITADOS_NO_ENCONTRADOS(medicos: string[] = []) {
    return new AvailabilityError({
      code: "ERR203",
      humanMessage: `Los médicos solicitados no se encontraron: "${medicos.join(
        ", "
      )}". Por favor, verifique si los nombres solicitados existen en la base de datos.`,
      context: { medicos },
    });
  }

  static MEDICO_NO_ASOCIADO_A_TRATAMIENTO(
    medicos: string[] = [],
    tratamientos: string[] = []
  ) {
    return new AvailabilityError({
      code: "ERR203",
      humanMessage: `El médico(s) "${medicos.join(
        ", "
      )}" no está asociado a los tratamientos "${tratamientos.join(", ")}".`,
      context: { medicos, tratamientos },
      isLogOnly: true,
    });
  }

  static NINGUN_ESPACIO_ENCONTRADO(
    tratamientos: string[] = [],
    medicos: string[] = []
  ) {
    return new AvailabilityError({
      code: "ERR203",
      humanMessage: `No hay espacios disponibles para el tratamiento(s) "${tratamientos.join(
        ", "
      )}" con los médicos [${medicos.join(", ")}].`,
      context: { tratamientos, medicos },
      isLogOnly: true,
    });
  }

  // -------------------
  // Errores técnicos
  // -------------------

  static ERROR_CONSULTA_SQL(errorOriginal: Error) {
    return new AvailabilityError({
      code: "ERR204",
      humanMessage: `Ha ocurrido un error interno al consultar la base de datos. Detalle: ${errorOriginal.message}`,
      context: { errorOriginal },
    });
  }

  static NO_PROG_MEDICOS(medicos: string[] = [], fechas: string[] = []) {
    return new AvailabilityError({
      code: "ERR210",
      humanMessage: `No se encontró programación para los médicos [${medicos.join(
        ", "
      )}] en las fechas [${fechas.join(", ")}].`,
      context: { medicos, fechas },
      isLogOnly: true,
    });
  }

  static NO_PROG_ESPACIOS(espacios: string[] = [], fechas: string[] = []) {
    return new AvailabilityError({
      code: "ERR211",
      humanMessage: `No se encontró programación de espacios para [${espacios.join(
        ", "
      )}] en las fechas [${fechas.join(", ")}].`,
      context: { espacios, fechas },
      isLogOnly: true,
    });
  }

  static SIN_HORARIOS_DISPONIBLES(
    tratamientos: string[] = [],
    fechas: any[] = []
  ) {
    const tratamientosStr = tratamientos.join(", ");
    const fechasFormateadas = fechas.map((fechaObj) => {
      const fechaDate = new Date(fechaObj.fecha);
      const dia = String(fechaDate.getDate()).padStart(2, "0");
      const mes = String(fechaDate.getMonth() + 1).padStart(2, "0");
      const anio = fechaDate.getFullYear();
      let fechaStr = `${dia}/${mes}/${anio}`;
      const horasPresentes = (fechaObj.horas || []).filter(
        (horaObj: any) => horaObj.hora_inicio || horaObj.hora_fin
      );
      const horasStr = horasPresentes
        .map((horaObj: any) => {
          const { hora_inicio, hora_fin } = horaObj;
          if (hora_inicio && hora_fin)
            return `entre las ${hora_inicio} y las ${hora_fin}`;
          if (hora_inicio) return `a partir de las ${hora_inicio}`;
          if (hora_fin) return `hasta las ${hora_fin}`;
          return "";
        })
        .filter((s: string) => s !== "")
        .join(", ");
      return horasStr ? `${fechaStr} ${horasStr}` : fechaStr;
    });
    const fechasStr = fechasFormateadas.join(", ");
    return new AvailabilityError({
      code: "ERR300",
      humanMessage: `No se encontraron horarios disponibles para los tratamientos [${tratamientosStr}] en las siguientes fechas: ${fechasStr}.`,
      context: { tratamientos, fechas },
      isLogOnly: true,
    });
  }

  static ERROR_CALCULO_DISPONIBILIDAD() {
    return new AvailabilityError({
      code: "ERR301",
      humanMessage:
        "Ocurrió un error al calcular la disponibilidad. Por favor avisar al equipo de desarrollo.",
    });
  }

  static CONEXION_BD() {
    return new AvailabilityError({
      code: "ERR400",
      humanMessage:
        "Se ha perdido la conexión a la base de datos. Por favor avisar al equipo de desarrollo.",
    });
  }

  static TIEMPO_ESPERA_BD() {
    return new AvailabilityError({
      code: "ERR401",
      humanMessage:
        "La consulta a la base de datos tardó demasiado. Por favor avisar al equipo de desarrollo.",
    });
  }

  static ERROR_INTERNO_SERVIDOR() {
    return new AvailabilityError({
      code: "ERR500",
      humanMessage:
        "Error interno en el servidor. Por favor avisar al equipo de desarrollo.",
    });
  }

  static ERROR_DESCONOCIDO(error: any) {
    return new AvailabilityError({
      code: "ERR501",
      humanMessage: `Error desconocido: ${error.message}. Por favor avisar al equipo de desarrollo.`,
      context: { error },
    });
  }
}
