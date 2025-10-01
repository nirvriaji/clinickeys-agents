// packages/core/src/utils/defaultPlaceholders.ts
// ----------------------------------------------------------------------------
// Placeholder únicos por asistente.
// - ASISTENTE_PRINCIPAL_CONFIG: unifica datos de clínica, interacción,
//   catálogo, FAQs y motivos de tarea.
// - ASISTENTE_AGENDA_CONFIG: configuración única usada por los asistentes
//   relacionados a agenda (selector de horarios y redactor de horarios).
//
// Notas importantes:
// - Se elimina "LOS_ESPACIOS_SON_O_NO_SON_SEDES".
// - Solo se usa "LISTA_DE_SEDES_DE_LA_CLINICA". Si está vacío o ausente,
//   se asume que no hay sedes y no deben mencionarse.
// - "LISTA_DE_SEDES_DE_LA_CLINICA" es un string CSV con nombres EXACTOS
//   tal como están en BD (coinciden con nombres de espacios), p. ej.:
//   "Sede Miraflores, Sede San Isidro, Sede Barranco".
// - Los valores aquí son PLANTILLAS por defecto; los equipos de producto
//   o ventas pueden sobrescribirlos externamente.
// ----------------------------------------------------------------------------

export const defaultPlaceholders = {
  /**
   * Config único para el asistente principal (conversa con el paciente
   * y maneja el hilo de la conversación).
   *
   * Secciones sugeridas dentro del mismo placeholder para ordenar la edición
   * desde la interfaz externa. El asistente debe tratar este bloque como un
   * texto estructurado libre (no JSON obligatorio), tolerando campos vacíos.
   */
  ASISTENTE_PRINCIPAL_CONFIG: `
# DATOS_DE_LA_CLINICA
NOMBRE_CLINICA:
TELEFONO_CLINICA:
DIRECCION_CLINICA:
PAGINA_WEB_CLINICA:
APARCAMIENTO_CLINICA:
REDES_SOCIALES_CLINICA:
CORREO_ELECTRONICO_CLINICA:
HORARIOS_DE_ATENCION_CLINICA:
LISTA_DE_SEDES_DE_LA_CLINICA:  

# CONFIGURACION_INTERACCION_ASISTENTE
# (Guías de tono, estilo, límites de derivación humana, validaciones, etc.)

# CATALOGO_TRATAMIENTOS
# (Listado libre o instrucciones de cómo obtener/mostrar tratamientos.)

# PREGUNTAS_FRECUENTES
# (FAQ libre; cada item puede incluir pregunta y respuesta.)

# MOTIVOS_TAREA
# (Motivos y plantillas para crear tareas internas.)
`,

  /**
   * Config único para los asistentes de agenda (selector y redactor de horarios).
   *
   * Este bloque puede ser interpretado como texto libre. Si la capa de dominio
   * requiere leer parámetros numéricos, puede parsear líneas con el patrón
   * "CLAVE: valor". Si no hay valores, se aplicarán defaults a nivel de código.
   *
   * Defaults recomendados en dominio (si no se proveen aquí):
   * - BLOQUE_DIAS: 5
   * - ADELANTE_MAX_DIAS: 45
   * - MAX_OPCIONES: 3
   */
  ASISTENTE_AGENDA_CONFIG: `
# PARAMETROS_BUSQUEDA
BLOQUE_DIAS: 5
ADELANTE_MAX_DIAS: 45
MAX_OPCIONES: 3

# PREFERENCIAS_PRESENTACION
# REGLAS_MINUTOS: (ej. no ofrecer slots con menos de X min de anticipación)
# TOPE_POR_DIA: (ej. máx. N horarios por día en la presentación)
# FORMATO_TEXTO: (lineamientos para redacción, emojis permitidos/no, etc.)
# OBSERVACIONES: (campo libre para reglas locales o excepciones)
`,
} as const;

export type DefaultPlaceholders = typeof defaultPlaceholders;
