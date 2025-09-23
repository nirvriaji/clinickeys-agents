// /config/openaiTools.ts

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
        "Registra los datos básicos de identidad de un paciente cuando no existe ninguno asociado al interlocutor. " +
        "Se utiliza al inicio del flujo o cuando no hay forma de vincular al usuario con un paciente existente. " +
        "Siempre requiere nombre, apellido y teléfono antes de proceder con cualquier otra gestión.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)" },
          apellido: { type: "string", description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)" },
          telefono: { type: "string", description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)" },
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
        "El asistente debe invocarla únicamente cuando ya se tenga definido el tratamiento, el rango de fechas y de horas, " +
        "y opcionalmente médico o sede. El resultado nunca se reescribe: se muestra tal como llega desde el servicio externo.",
      parameters: {
        type: "object",
        properties: {
          tratamiento: { type: "string", description: "Tratamiento solicitado por el paciente (NO PUEDE ESTAR VACÍO)" },
          medico: { type: ["string", "null"], description: "Nombre opcional del médico indicado por el paciente (ES OPCIONAL)" },
          fechas: { type: "string", description: "Fechas solicitadas por el paciente (NO PUEDE ESTAR VACÍO)" },
          horas: { type: "string", description: "Horas solicitadas por el paciente (NO PUEDE ESTAR VACÍO)" },
          espacio: { type: ["string", "null"], description: "SEDE solicitada. Usar null si no aplica o es una sala/cabina." },
          summary: { type: "string", description: "Breve resumen (80–150 caracteres) con las fechas/horas solicitadas y/o descartadas por el paciente" },
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
        "El asistente debe validar paciente, tratamiento, sede y fecha/hora antes de invocarla.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)" },
          apellido: { type: "string", description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)" },
          telefono: { type: "string", description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)" },
          tratamiento: { type: "string", description: "Tratamiento solicitado por el paciente (NO PUEDE ESTAR VACÍO)" },
          medico: { type: ["string", "null"], description: "Nombre opcional del médico (ES OPCIONAL)" },
          fechas: { type: "string", description: "Fechas solicitadas (NO PUEDE ESTAR VACÍO)" },
          horas: { type: "string", description: "Horas solicitadas (NO PUEDE ESTAR VACÍO)" },
          id_pack_bono: { type: ["integer", "null"], description: "Id del pack/bono si aplica (ES OPCIONAL)" },
          id_presupuesto: { type: ["integer", "null"], description: "Id del presupuesto si aplica (ES OPCIONAL)" },
          espacio: { type: ["string", "null"], description: "SEDE solicitada. Null si no aplica o es sala/cabina." },
          summary: { type: "string", description: "Resumen breve de la interacción (150–400 caracteres, sin viñetas ni formato)." },
          id_paciente: { type: ["integer", "null"], description: "ID del paciente si ya existe, o null si debe crearse." },
          shouldCreatePatient: { type: "boolean", description: "Indica si se debe crear un nuevo paciente." },
          isThirdParty: { type: "boolean", description: "Indica si el interlocutor actúa en nombre de otra persona." },
        },
        required: [
          "nombre","apellido","telefono","tratamiento","medico","espacio",
          "fechas","horas","summary","id_pack_bono","id_presupuesto",
          "id_paciente","shouldCreatePatient","isThirdParty",
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
        "Actualiza el estado de una cita futura ya existente. " +
        "Puede usarse para confirmar asistencia, cancelar la cita o marcar que el paciente está en camino. " +
        "Siempre debe operar sobre citas en el futuro, nunca pasadas.",
      parameters: {
        type: "object",
        properties: {
          id_cita: { type: "integer", description: "ID de la cita a actualizar" },
          estado: { type: "string", enum: ["cancelar","confirmar","en_camino"], description: "Nuevo estado de la cita" },
          summary: { type: "string", description: "Resumen breve de la interacción (150–400 caracteres)." },
        },
        required: ["id_cita","estado","summary"],
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
        "Se utiliza en casos de urgencia, reclamos, consultas no resueltas o cuando la configuración lo indique como sustitución. " +
        "Debe contener siempre un motivo claro y los datos básicos de contacto del paciente.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)" },
          apellido: { type: "string", description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)" },
          telefono: { type: "string", description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)" },
          motivo: { type: "string", description: "Motivo de la tarea (NO PUEDE ESTAR VACÍO)" },
          canal_preferido: { type: ["string","null"], enum: ["llamada","WhatsApp"], description: "Canal preferido; null si no aplica" },
        },
        required: ["nombre","apellido","telefono","motivo","canal_preferido"],
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
        "Resuelve una ambigüedad cuando hay varios pacientes posibles asociados al mismo interlocutor. " +
        "Presenta la lista de candidatos y solicita al usuario que seleccione cuál es el paciente objetivo de la gestión.",
      parameters: {
        type: "object",
        properties: {
          candidatos: { type: "string", description: "Lista serializada de pacientes candidatos." },
        },
        required: ["candidatos"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
] as const;

export default openaiTools;
