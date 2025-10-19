// packages/core/src/utils/openaiTools.ts

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
  name: string;
  description: string;
  /** Campo informativo interno; el SDK v5 no lo usa, pero no molesta. */
  summary?: string;
  parameters: JSONSchema;
  /** Strict mode recomendado por OpenAI. */
  strict: boolean;
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

// Colección tipada de herramientas compatibles con SDK v5 (Responses API)
export const openaiTools: OpenAITool[] = [
  {
    type: "function",
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
        telefono: {
          type: "string",
          description:
            "Teléfono del paciente (NO PUEDE ESTAR VACÍO; incluir código de país si es posible)",
        },
      },
      required: ["nombre", "apellido", "telefono"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "consulta_agendar",
    description:
      "Busca y devuelve los bloques de horarios disponibles para que el paciente pueda agendar una cita futura. " +
      "Invócala únicamente cuando ya se tenga definido el tratamiento y un rango de fechas y de horas en texto libre. " +
      "Regla de sedes: si existe LISTA_DE_SEDES_DE_LA_CLINICA, el campo ‘espacio’ debe contener el NOMBRE EXACTO de la SEDE elegida por el interlocutor; " +
      "el sistema resolverá internamente el id_espacio. Si no existe lista de sedes, envía ‘espacio: null’.",
    parameters: {
      type: "object",
      properties: {
        tratamiento: {
          type: "string",
          description:
            "Tratamiento solicitado por el paciente (NO PUEDE ESTAR VACÍO; normalizar contra el catálogo si aplica, se puede deducir dependiendo de lo que mencionó el paciente en anteriores turnos, llenar con la razón de por qué no se reconoce el tratamiento)",
        },
        medico: {
          type: ["string", "null"],
          description:
            "Nombre del médico SOLO si el paciente lo eligió o la configuración externa lo exige; en caso contrario, usar null.",
        },
        fechas: { type: "string", description: "Rango de fechas en TEXTO LIBRE." },
        horas: { type: "string", description: "Rango de horas en TEXTO LIBRE (mañana, tarde, etc.)." },
        espacio: {
          type: ["string", "null"],
          description: "SEDE elegida por el interlocutor (nombre exacto) o null si no aplica.",
        },
        summary: {
          type: "string",
          description: "Resumen breve (80–150 caracteres) con la intención y rango de fechas/horas. No mencionar el nombre del paciente",
        },
      },
      required: ["tratamiento", "medico", "espacio", "fechas", "horas", "summary"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "agendar_cita",
    description:
      "Confirma y formaliza la reserva de un horario disponible para un paciente identificado. " +
      "Se utiliza únicamente después de haber mostrado disponibilidades y cuando el paciente elige un horario específico.",
    parameters: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)" },
        apellido: { type: "string", description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)" },
        telefono: { type: "string", description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)" },
        id_pack_bono: { type: ["integer", "null"], description: "Id del pack/bono si aplica." },
        id_presupuesto: { type: ["integer", "null"], description: "Id del presupuesto si aplica." },
        summary: {
          type: "string",
          description: "Resumen breve (80–150 caracteres), sin identificadores internos, ni mencionar el nombre del paciente.",
        },
        id_paciente: { type: ["integer", "null"], description: "ID del paciente si ya existe; null si debe crearse." },
        shouldCreatePatient: { type: "boolean", description: "true si se debe crear un nuevo paciente." },
        isThirdParty: { type: "boolean", description: "true si el interlocutor actúa en nombre de otra persona." },
        horarioEscogido: {
          type: "object",
          properties: {
            fecha_cita: { type: "string", description: "Fecha de la cita en formato YYYY-MM-DD." },
            fecha_legible: { type: "string", description: "Devuelve una representación legible en español tipo: [NOMBRE DÍA SEMANA], [NRO DÍA] de [NOMBRE MES]" },
            hora_inicio: { type: "string", description: "Hora de inicio en formato HH:MM (24h)." },
            hora_fin: { type: "string", description: "Hora de fin en formato HH:MM (24h)." },
            id_tratamiento: { type: "integer", description: "ID del tratamiento asociado." },
            id_medico: { type: "integer", description: "ID del médico asignado." },
            id_espacio: { type: "integer", description: "ID del espacio o sede." },
          },
          required: ["fecha_cita", "fecha_legible", "hora_inicio", "hora_fin", "id_tratamiento", "id_medico", "id_espacio"],
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
  {
    type: "function",
    name: "gestionar_estado_cita",
    description:
      "Actualiza el estado de una cita futura ya existente (confirmar, cancelar o 'en camino'). " +
      "Debe operar únicamente sobre citas futuras.",
    parameters: {
      type: "object",
      properties: {
        id_cita: { type: "integer", description: "ID de la cita a actualizar." },
        estado: {
          type: "string",
          enum: ["PROGRAMADA", "CANCELADA", "CONFIRMADA", "EN_CAMINO"],
          description: "Nuevo estado de la cita.",
        },
        summary: { type: "string", description: "Resumen breve (80–150 caracteres). No mencionar el nombre del paciente" },
      },
      required: ["id_cita", "estado", "summary"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "crear_tarea",
    description:
      "Registra una tarea administrativa o de seguimiento para gestión humana. " +
      "Úsala en urgencias, reclamos, consultas no resueltas o sustituciones configuradas externamente.",
    parameters: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre del paciente." },
        apellido: { type: "string", description: "Apellido del paciente." },
        telefono: { type: "string", description: "Teléfono del paciente." },
        motivo: { type: "string", description: "Motivo de la tarea (texto libre o motivo comercial)." },
        canal_preferido: {
          type: ["string", "null"],
          enum: ["llamada", "WhatsApp"],
          description: "Canal preferido ('llamada' o 'WhatsApp').",
        },
      },
      required: ["nombre", "apellido", "telefono", "motivo", "canal_preferido"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "clarificar_paciente",
    description:
      "Resuelve ambigüedades cuando existen varios pacientes candidatos con los mismos datos. " +
      "Solicita al interlocutor seleccionar el paciente correcto antes de continuar.",
    parameters: {
      type: "object",
      properties: {
        candidatos: {
          type: "string",
          description: "JSON serializado con los pacientes candidatos devuelto por backend.",
        },
      },
      required: ["candidatos"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export default openaiTools;