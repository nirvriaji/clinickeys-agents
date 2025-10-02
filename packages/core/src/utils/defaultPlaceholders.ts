// packages/core/src/utils/defaultPlaceholders.ts

export const defaultPlaceholders = {
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

  ASISTENTE_AGENDA_CONFIG: `
`,
} as const;

export type DefaultPlaceholders = typeof defaultPlaceholders;
