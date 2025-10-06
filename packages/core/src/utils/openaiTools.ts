// packages/core/src/utils/openaiTools.ts

/**
 * Definiciones de herramientas (function calling) para OpenAI en TypeScript.
 * Sin dependencias externas; tipado mínimo para JSON Schema y herramientas.
 */

export type JSONSchema = {
  type: string | string[];
  description?: string;
  enum?: string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    summary?: string;
    parameters: JSONSchema;
    strict?: boolean;
  };
};

export type OpenAITool = OpenAIFunctionTool;

// Unión de nombres de herramientas (intenciones unificadas)
export type ToolName =
  | "consulta_agendar"
  | "agendar_cita"
  | "gestionar_estado_cita"
  | "crear_tarea"
  | "identificar_paciente"
  | "clarificar_paciente";

// Colección tipada de herramientas
export const openaiTools: ReadonlyArray<OpenAITool> = [
  {
    type: "function",
    function: {
      name: "identificar_paciente",
      description:
        "Registra los datos básicos de identidad (nombre, apellido y teléfono) de un paciente cuando no existe ninguno asociado al interlocutor o cuando se gestiona en nombre de un tercero. " +
        "Además de registrar identidad, esta función devuelve todas las citas asociadas al paciente identificado (≈400 días hacia atrás y sin límite hacia adelante). " +
        "Es el mecanismo oficial para acceder a la agenda e historial de un paciente no vinculado directamente al canal y debe completarse antes de cualquier otra gestión. " +
        "El teléfono debe ser válido para contacto (idealmente con código de país). Fechas y horas siempre se comunican en la zona horaria del sistema (24h).",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)" },
          apellido: { type: "string", description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)" },
          telefono: { type: "string", description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO; incluir código de país si es posible)" },
        },
        required: ["nombre", "apellido", "telefono"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "consulta_agendar",
      description:
        "Busca y devuelve los bloques de horarios disponibles para que el paciente pueda agendar una cita futura. " +
        "Invócala únicamente cuando ya se tenga definido el tratamiento y un rango de fechas y de horas en texto libre (p. ej., ‘la próxima semana’, ‘tardes’, ‘después de las 17’, ‘todo el día’). " +
        "Regla de sedes: si existe LISTA_DE_SEDES_DE_LA_CLINICA, el campo ‘espacio’ debe contener el NOMBRE EXACTO de la SEDE elegida por el interlocutor; el sistema resolverá internamente el id_espacio. Si no existe lista de sedes, envía ‘espacio: null’. " +
        "El resultado nunca se reescribe ni reordena: se muestra tal como llega desde el servicio externo. La interpretación temporal y la comunicación al paciente se realizan en la zona horaria del sistema (24h).",
      parameters: {
        type: "object",
        properties: {
          tratamiento: { type: "string", description: "Tratamiento solicitado por el paciente (NO PUEDE ESTAR VACÍO; normalizar contra el catálogo si aplica)" },
          medico: { type: ["string", "null"], description: "Nombre del médico SOLO si el paciente lo eligió o la configuración externa lo exige; en caso contrario, usar null." },
          fechas: { type: "string", description: "Rango de fechas en TEXTO LIBRE (p. ej., ‘entre el 10 y el 20 de octubre’, ‘la próxima semana’, ‘desde mañana’)." },
          horas: { type: "string", description: "Rango de horas en TEXTO LIBRE (p. ej., ‘tardes’, ‘mañanas’, ‘después de las 17’, ‘todo el día’, ‘cualquier hora’)." },
          espacio: { type: ["string", "null"], description: "SEDE elegida por el interlocutor (NOMBRE EXACTO) si la clínica maneja sedes; usar null si no aplica o si la lista de sedes está vacía/ausente." },
          summary: { type: "string", description: "Resumen breve de la solicitud (80–150 caracteres) con la intención y el rango de fechas/horas provisto por el paciente. No debe mencionar el nombre del paciente" },
        },
        required: ["tratamiento", "medico", "espacio", "fechas", "horas", "summary"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "agendar_cita",
      description:
        "Confirma y formaliza la reserva de un horario disponible para un paciente identificado. " +
        "Se utiliza únicamente después de haber mostrado disponibilidades y cuando el paciente elige un horario específico. " +
        "Reconoce el ‘horarioEscogido’ completo (id_tratamiento, id_medico, id_espacio, fecha_cita, hora_inicio y hora_fin). " +
        "Validar previamente paciente y coherencia del horario. La confirmación al paciente se comunica en formato 24h y zona horaria del sistema.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)" },
          apellido: { type: "string", description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)" },
          telefono: { type: "string", description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)" },
          id_pack_bono: { type: ["integer", "null"], description: "Id del pack/bono si aplica (OPCIONAL; puede ser null)." },
          id_presupuesto: { type: ["integer", "null"], description: "Id del presupuesto si aplica (OPCIONAL; puede ser null)." },
          summary: { type: "string", description: "Resumen breve de la confirmación (80–150 caracteres), sin identificadores internos ni viñetas. No debe mencionar el nombre del paciente" },
          id_paciente: { type: ["integer", "null"], description: "ID del paciente si ya existe; null si debe crearse." },
          shouldCreatePatient: { type: "boolean", description: "true si se debe crear un nuevo paciente; false en caso contrario." },
          isThirdParty: { type: "boolean", description: "true si el interlocutor actúa en nombre de otra persona; de lo contrario, false." },
          horarioEscogido: {
            type: "object",
            description: "Horario seleccionado por el paciente, tal como fue devuelto por el buscador (estructura mínima necesaria para crear la cita).",
            properties: {
              fecha_cita: { type: "string", description: "Fecha de la cita en formato YYYY-MM-DD (obligatorio)." },
              fecha_legible: { type: "string", description: "Fecha en texto legible proveniente del contexto (ej.: '[Nombre del día de la semana], [DD] de [MM]')." },
              hora_inicio: { type: "string", description: "Hora de inicio en HH:MM (24h)." },
              hora_fin: { type: "string", description: "Hora de fin en HH:MM (24h)." },
              id_tratamiento: { type: "integer", description: "ID del tratamiento asociado." },
              id_medico: { type: "integer", description: "ID del médico asignado." },
              id_espacio: { type: "integer", description: "ID del espacio (o sede) donde se realizará la cita." },
              nombre_tratamiento: { type: ["string", "null"], description: "Nombre del tratamiento (opcional)." },
              nombre_medico: { type: ["string", "null"], description: "Nombre completo del médico (opcional)." },
              nombre_espacio: { type: ["string", "null"], description: "Nombre del espacio o sede (opcional)." },
              duracion_tratamiento: { type: ["integer", "null"], description: "Duración del tratamiento en minutos (opcional, se puede usar para validar hora_fin)." },
              especifica: { type: ["boolean", "null"], description: "Flag informativo si el slot proviene de regla específica (opcional)." },
            },
            required: [
              "fecha_cita",
              "fecha_legible",
              "hora_inicio",
              "hora_fin",
              "id_tratamiento",
              "id_medico",
              "id_espacio",
              "nombre_tratamiento",
              "nombre_medico",
              "nombre_espacio",
              "duracion_tratamiento",
              "especifica",
            ],
            additionalProperties: false,
          },
        },
        required: [
          "nombre",
          "apellido",
          "telefono",
          "id_pack_bono",
          "id_presupuesto",
          "summary",
          "id_paciente",
          "shouldCreatePatient",
          "isThirdParty",
          "horarioEscogido",
        ],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "gestionar_estado_cita",
      description:
        "Actualiza el estado de una cita futura ya existente (confirmar, cancelar o ‘en camino’). " +
        "Debe operar únicamente sobre citas futuras; no invocar para citas pasadas. La confirmación al paciente se comunica con copy breve y sin identificadores internos.",
      parameters: {
        type: "object",
        properties: {
          id_cita: { type: "integer", description: "ID de la cita a actualizar" },
          estado: { type: "string", enum: ["PROGRAMADA", "CANCELADA", "CONFIRMADA", "EN_CAMINO"], description: "Nuevo estado de la cita" },
          summary: { type: "string", description: "Resumen breve de la interacción (80–150 caracteres). No debe mencionar el nombre del paciente" },
        },
        required: ["id_cita", "estado", "summary"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "crear_tarea",
      description:
        "Registra una tarea administrativa o de seguimiento para gestión humana. " +
        "Úsala en urgencias, reclamos, consultas no resueltas o cuando la configuración externa lo indique como sustitución. Debe incluir un motivo claro y datos básicos de contacto.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)" },
          apellido: { type: "string", description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)" },
          telefono: { type: "string", description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)" },
          motivo: { type: "string", description: "Motivo de la tarea (NO PUEDE ESTAR VACÍO). Puede ser texto libre o uno de los motivos definidos comercialmente." },
          canal_preferido: { type: ["string", "null"], enum: ["llamada", "WhatsApp"], description: "Canal preferido (‘llamada’/‘WhatsApp’). Usar null si el interlocutor no expresó preferencia." },
        },
        required: ["nombre", "apellido", "telefono", "motivo", "canal_preferido"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "clarificar_paciente",
      description:
        "Resuelve una ambigüedad cuando existen varios pacientes candidatos con los mismos datos o tras un proceso de identificación. " +
        "Presenta las opciones mínimas necesarias y solicita al interlocutor que seleccione el paciente objetivo antes de continuar con cualquier otra gestión. El parámetro ‘candidatos’ es un JSON serializado proporcionado por backend (no modificar).",
      parameters: {
        type: "object",
        properties: {
          candidatos: { type: "string", description: "JSON serializado con los pacientes candidatos devuelto por backend." },
        },
        required: ["candidatos"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
] as const;

export default openaiTools;