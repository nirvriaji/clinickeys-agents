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
  | "cargar_pacientes_por_telefono";

// Colección tipada de herramientas compatibles con SDK v5 (Responses API)
export const openaiTools: OpenAITool[] = [
  {
    type: "function",
    name: "consulta_agendar",
    description:
      "Busca y devuelve bloques de horarios disponibles para agendar una cita futura. " +
      "Invócala únicamente cuando ya se tenga definido el tratamiento y un rango de fechas y de horas en TEXTO LIBRE. " +
      "Reglas de sedes: si existe LISTA_DE_SEDES_DE_LA_CLINICA con contenido, el campo ‘espacio’ debe contener el NOMBRE EXACTO de la SEDE elegida por el interlocutor (nunca null); el sistema resolverá internamente el id_espacio. " +
      "Si la lista de sedes está vacía, no se debe pedir sede y se envía ‘espacio: null’. " +
      "Por defecto, ‘medico’ y ‘espacio’ son null salvo preferencia explícita o directriz de la configuración externa. " +
      "Una llamada por TRATAMIENTO. Presentar disponibilidades exactamente como llegan (sin reordenar).",
    parameters: {
      type: "object",
      properties: {
        tratamiento: {
          type: "string",
          description:
            "Tratamiento solicitado por el interlocutor (NO PUEDE ESTAR VACÍO; normalizar contra el catálogo si aplica, se puede deducir dependiendo de lo que mencionó el paciente en anteriores turnos, llenar con la razón de por qué no se reconoce el tratamiento); si no se reconoce, indicar brevemente la razón).",
        },
        medico: {
          type: ["string", "null"],
          description:
            "Nombre del médico SOLO si el paciente lo eligió o la configuración externa lo exige; en caso contrario, usar null.",
        },
        fechas: { type: "string", description: "Rango de fechas en TEXTO LIBRE (p. ej., 'próxima semana')." },
        horas: { type: "string", description: "Rango de horas en TEXTO LIBRE (p. ej., 'tardes', 'después de las 17')." },
        espacio: {
          type: ["string", "null"],
          description:
            "SEDE elegida por el interlocutor (nombre exacto) cuando la clínica lista sedes; si la lista está vacía, enviar null.",
        },
        summary: {
          type: "string",
          description:
            "Resumen breve (80–150 caracteres) con la intención y el rango de fechas/horas. No mencionar el nombre del paciente.",
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
      "Confirma y formaliza la reserva de un horario disponible para un paciente. " +
      "Usar únicamente después de mostrar disponibilidades y cuando el paciente elige un horario específico (slot). " +
      "Identidad: si `shouldCreatePatient` es true, se crea/busca por nombre+apellido+teléfono; si es false, se debe proporcionar `id_paciente`. " +
      "Siempre existe un id_espacio resuelto internamente (sea sede o cabina/sala).",
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
          description:
            "Resumen breve (80–150 caracteres), sin identificadores internos ni mencionar el nombre del paciente.",
        },
        // REQUIRED + NULLABLE: Responses strict exige presencia; null cuando no aplica
        id_paciente: { type: ["integer", "null"], description: "ID del paciente si ya existe; null si se va a crear." },
        shouldCreatePatient: { type: "boolean", description: "true si se debe crear un nuevo paciente." },
        isThirdParty: { type: "boolean", description: "true si el interlocutor actúa en nombre de otra persona." },
        horarioEscogido: {
          type: "object",
          properties: {
            fecha_cita: { type: "string", description: "Fecha de la cita en formato YYYY-MM-DD." },
            fecha_legible: {
              type: "string",
              description:
                "Representación legible en español: [DÍA DE SEMANA], [DÍA] de [MES] (para copy de confirmación).",
            },
            hora_inicio: { type: "string", description: "Hora de inicio en formato HH:MM (24h)." },
            hora_fin: { type: "string", description: "Hora de fin en formato HH:MM (24h)." },
            id_tratamiento: { type: "integer", description: "ID del tratamiento asociado." },
            id_medico: { type: "integer", description: "ID del médico asignado." },
            id_espacio: { type: "integer", description: "ID del espacio o sede." },
          },
          required: [
            "fecha_cita",
            "fecha_legible",
            "hora_inicio",
            "hora_fin",
            "id_tratamiento",
            "id_medico",
            "id_espacio",
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
  {
    type: "function",
    name: "gestionar_estado_cita",
    description:
      "Actualiza el estado de una cita futura ya existente (CONFIRMADA, CANCELADA, EN_CAMINO). " +
      "Operar directamente cuando el usuario se expresa de forma inequívoca (con o sin recordatorio). " +
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
        summary: {
          type: "string",
          description: "Resumen breve (80–150 caracteres). No mencionar el nombre del paciente.",
        },
        motivo_cambio: {
          type: ["string", "null"],
          description:
            "Motivo del cambio en TEXTO LIBRE (p. ej., 'llegará tarde', 'tiene un imprevisto', 'desea reprogramar'). Puede ser null.",
        },
      },
      required: ["id_cita", "estado", "summary", "motivo_cambio"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "crear_tarea",
    description:
      "Registra una tarea administrativa o de seguimiento para gestión humana. " +
      "Úsala en urgencias, reclamos, consultas no resueltas, sustituciones configuradas externamente o hooks post‑acción.",
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
    name: "cargar_pacientes_por_telefono",
    description:
      "Carga al contexto la información de todos los pacientes asociados a un teléfono dado (propio o de un tercero). " +
      "No crea pacientes. Útil para actuar por terceros y para enriquecer el contexto antes de gestionar citas o agendar.",
    parameters: {
      type: "object",
      properties: {
        telefono_consulta: {
          type: "string",
          description: "Teléfono a consultar (idealmente con código de país).",
        },
      },
      required: ["telefono_consulta"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export default openaiTools;