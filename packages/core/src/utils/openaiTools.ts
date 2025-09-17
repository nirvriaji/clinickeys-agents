// /config/openaiTools.ts

/**
 * Definiciones de herramientas (function calling) para OpenAI en TypeScript.
 * Sin dependencias externas; tipado mínimo para JSON Schema y herramientas.
 */

// Tipos mínimos para un esquema JSON (suficiente para este archivo)
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

export type OpenAITool = OpenAIFunctionTool; // extender a futuro si se agregan otros tipos

// Unión útil de nombres de herramientas
export type ToolName =
  | "consulta_agendar"
  | "agendar_cita"
  | "consulta_reprogramar"
  | "reprogramar_cita"
  | "cancelar_cita"
  | "confirmar_cita"
  | "paciente_en_camino"
  | "tarea"
  | "clarificar_paciente";

// Colección tipada de herramientas
export const openaiTools: ReadonlyArray<OpenAITool> = [
  {
    type: "function",
    function: {
      name: "consulta_agendar",
      description: "Busca huecos disponibles para agendar una cita.",
      parameters: {
        type: "object",
        properties: {
          tratamiento: {
            type: "string",
            description:
              "Tratamiento solicitado por el paciente (NO PUEDE ESTAR VACÍO)",
          },
          medico: {
            type: ["string", "null"],
            description:
              "Nombre opcional del médico que indica el paciente (ES OPCIONAL)",
          },
          fechas: {
            type: "string",
            description: "Fechas solicitadas por el paciente (NO PUEDE ESTAR VACÍO)",
          },
          horas: {
            type: "string",
            description: "Horas solicitadas por el paciente (NO PUEDE ESTAR VACÍO)",
          },
          espacio: {
            type: ["string", "null"],
            description:
              "SEDE solicitada. Usar null si el paciente no indicó sede o si mencionó una sala/cabina.",
          },
          summary: {
            type: "string",
            description: "Breve resumen (80–150 caracteres) con las fechas/horas solicitadas y/o descartadas por el paciente"
          },
        },
        required: ["tratamiento", "medico", "espacio", "fechas", "horas", "summary",],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "agendar_cita",
      description: "Formaliza la agenda de una cita con datos del paciente.",
      parameters: {
        type: "object",
        properties: {
          nombre: {
            type: "string",
            description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)",
          },
          apellido: {
            type: "string",
            description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)",
          },
          telefono: {
            type: "string",
            description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)",
          },
          tratamiento: {
            type: "string",
            description:
              "Tratamiento solicitado por el paciente (NO PUEDE ESTAR VACÍO)",
          },
          medico: {
            type: ["string", "null"],
            description:
              "Nombre opcional del médico que indica el paciente (ES OPCIONAL)",
          },
          fechas: {
            type: "string",
            description: "Fechas solicitadas por el paciente (NO PUEDE ESTAR VACÍO)",
          },
          horas: {
            type: "string",
            description: "Horas solicitadas por el paciente (NO PUEDE ESTAR VACÍO)",
          },
          id_pack_bono: {
            type: ["integer", "null"],
            description:
              "Id del pack/bono si el paciente quiere usarlo (ES OPCIONAL)",
          },
          id_presupuesto: {
            type: ["integer", "null"],
            description:
              "Id del presupuesto si el paciente quiere usarlo (ES OPCIONAL)",
          },
          espacio: {
            type: ["string", "null"],
            description:
              "SEDE solicitada. Usar null si no aplica o si el paciente indicó una sala/cabina.",
          },
          summary: {
            type: "string",
            description: "Resumen breve, en un solo párrafo, de la conversación con el paciente: por qué se contactó, qué se hizo (acciones tomadas) y en qué se quedó (acuerdos/próximos pasos). Si actuó en nombre de otra persona, menciónalo. No repitas datos estructurados de la cita (IDs, fecha/hora, nombres, tratamiento) salvo que sean necesarios para entender el caso. 150–400 caracteres, sin viñetas ni formato.",
          },
          id_paciente: {
            type: ["integer", "null"],
            description: "ID del paciente si ya existe, o null si debe crearse.",
          },
          shouldCreatePatient: {
            type: "boolean",
            description: "Indica si se debe crear un nuevo paciente (true/false).",
          },
          isThirdParty: {
            type: "boolean",
            description: "Indica si la persona que contacta actúa en nombre de otra (true/false).",
          }
        },
        // Requeridos reales: los demás son opcionales
        required: [
          "nombre",
          "apellido",
          "telefono",
          "tratamiento",
          "medico",
          "espacio",
          "fechas",
          "horas",
          "summary",
          "id_pack_bono",
          "id_presupuesto",
          "id_paciente",
          "shouldCreatePatient",
          "isThirdParty",
        ],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "consulta_reprogramar",
      description: "Busca huecos disponibles para reprogramar una cita existente.",
      parameters: {
        type: "object",
        properties: {
          nombre: {
            type: "string",
            description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)",
          },
          apellido: {
            type: "string",
            description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)",
          },
          telefono: {
            type: "string",
            description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)",
          },
          id_paciente: {
            type: "integer",
            description: "ID del paciente dueño de la cita (NO PUEDE ESTAR VACÍO).",
          },
          id_cita: {
            type: "integer",
            description:
              "ID de la cita que se quiere reprogramar (NO PUEDE ESTAR VACÍO)",
          },
          id_tratamiento: {
            type: "integer",
            description:
              "id_tratamiento referente a la id_cita (NO PUEDE ESTAR VACÍO)",
          },
          tratamiento: {
            type: "string",
            description: "Tratamiento de la id_cita (NO PUEDE ESTAR VACÍO)",
          },
          id_medico: {
            type: "integer",
            description:
              "id_medico del médico de la id_cita o de un profesional que indique el paciente (NO PUEDE ESTAR VACÍO)",
          },
          medico: {
            type: "string",
            description:
              "Nombre del médico de la id_cita o de un profesional que indique el paciente (NO PUEDE ESTAR VACÍO)",
          },
          fechas: {
            type: "string",
            description: "Fechas solicitadas por el paciente (NO PUEDE ESTAR VACÍO)",
          },
          horas: {
            type: "string",
            description: "Horas solicitadas por el paciente (NO PUEDE ESTAR VACÍO)",
          },
          id_espacio: {
            type: ["integer", "null"],
            description:
              "id_espacio de la SEDE objetivo de la reprogramación. Por defecto, el id_espacio de la sede original; null si no se restringe por sede",
          },
          espacio: {
            type: ["string", "null"],
            description:
              "SEDE objetivo de la reprogramación. Por defecto, la sede original; null si no se restringe por sede.",
          },
          summary: {
            type: "string",
            description: "Breve resumen (80–150 caracteres) con las fechas/horas solicitadas y/o descartadas por el paciente"
          },
        },
        required: [
          "nombre",
          "apellido",
          "telefono",
          "id_paciente",
          "id_cita",
          "id_tratamiento",
          "tratamiento",
          "id_medico",
          "medico",
          "id_espacio",
          "espacio",
          "fechas",
          "horas",
          "summary",
        ],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "reprogramar_cita",
      description: "Reagenda una cita existente al nuevo horario proporcionado.",
      parameters: {
        type: "object",
        properties: {
          nombre: {
            type: "string",
            description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)",
          },
          apellido: {
            type: "string",
            description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)",
          },
          telefono: {
            type: "string",
            description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)",
          },
          id_paciente: {
            type: "integer",
            description: "ID del paciente dueño de la cita (NO PUEDE ESTAR VACÍO).",
          },
          id_cita: {
            type: "integer",
            description: "ID de la cita a reprogramar (NO PUEDE ESTAR VACÍO)",
          },
          id_tratamiento: {
            type: "integer",
            description:
              "id_tratamiento referente a la id_cita (NO PUEDE ESTAR VACÍO)",
          },
          tratamiento: {
            type: "string",
            description: "Tratamiento de la id_cita (NO PUEDE ESTAR VACÍO)",
          },
          id_medico: {
            type: "integer",
            description:
              "id_medico del médico de la id_cita o de un profesional que indique el paciente (NO PUEDE ESTAR VACÍO)",
          },
          medico: {
            type: "string",
            description:
              "Nombre del médico de la id_cita o de un profesional que indique el paciente (NO PUEDE ESTAR VACÍO)",
          },
          fechas: {
            type: "string",
            description: "Fechas solicitadas por el paciente (NO PUEDE ESTAR VACÍO)",
          },
          horas: {
            type: "string",
            description: "Horas solicitadas por el paciente (NO PUEDE ESTAR VACÍO)",
          },
          espacio: {
            type: ["string", "null"],
            description:
              "SEDE final elegida para la nueva cita. Usar null si no aplica.",
          },
          summary: {
            type: "string",
            description: "Resumen breve, en un solo párrafo, de la conversación con el paciente: por qué se contactó, qué se hizo (acciones tomadas) y en qué se quedó (acuerdos/próximos pasos). Si actuó en nombre de otra persona, menciónalo. No repitas datos estructurados de la cita (IDs, fecha/hora, nombres, tratamiento) salvo que sean necesarios para entender el caso. 150–400 caracteres, sin viñetas ni formato.",
          },
        },
        required: [
          "nombre",
          "apellido",
          "telefono",
          "id_paciente",
          "id_cita",
          "id_tratamiento",
          "tratamiento",
          "id_medico",
          "medico",
          "espacio",
          "fechas",
          "horas",
          "summary",
        ],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "cancelar_cita",
      description: "Cancela una cita programada.",
      parameters: {
        type: "object",
        properties: {
          nombre: {
            type: "string",
            description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)",
          },
          apellido: {
            type: "string",
            description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)",
          },
          telefono: {
            type: "string",
            description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)",
          },
          id_cita: {
            type: "integer",
            description: "ID de la cita a cancelar (NO PUEDE ESTAR VACÍO).",
          },
          summary: {
            type: "string",
            description: "Resumen breve, en un solo párrafo, de la conversación con el paciente: por qué se contactó, qué se hizo (acciones tomadas) y en qué se quedó (acuerdos/próximos pasos). Si actuó en nombre de otra persona, menciónalo. No repitas datos estructurados de la cita (IDs, fecha/hora, nombres, tratamiento) salvo que sean necesarios para entender el caso. 150–400 caracteres, sin viñetas ni formato.",
          },
        },
        required: ["nombre", "apellido", "telefono", "id_cita", "summary"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "confirmar_cita",
      description: "Confirma una cita (actualiza estado a confirmado).",
      parameters: {
        type: "object",
        properties: {
          id_cita: {
            type: "integer",
            description: "ID de la cita a confirmar (NO PUEDE ESTAR VACÍO).",
          },
          summary: {
            type: "string",
            description: "Resumen breve, en un solo párrafo, de la conversación con el paciente: por qué se contactó, qué se hizo (acciones tomadas) y en qué se quedó (acuerdos/próximos pasos). Si actuó en nombre de otra persona, menciónalo. No repitas datos estructurados de la cita (IDs, fecha/hora, nombres, tratamiento) salvo que sean necesarios para entender el caso. 150–400 caracteres, sin viñetas ni formato.",
          },
        },
        required: ["id_cita", "summary"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "paciente_en_camino",
      description:
        "Marca la cita con el estado 'paciente en camino' (id_estados_cita_in=10).",
      parameters: {
        type: "object",
        properties: {
          id_cita: {
            type: "integer",
            description:
              "ID de la cita a marcar como 'paciente en camino' (NO PUEDE ESTAR VACÍO).",
          },
          summary: {
            type: "string",
            description: "Resumen breve, en un solo párrafo, de la conversación con el paciente: por qué se contactó, qué se hizo (acciones tomadas) y en qué se quedó (acuerdos/próximos pasos). Si actuó en nombre de otra persona, menciónalo. No repitas datos estructurados de la cita (IDs, fecha/hora, nombres, tratamiento) salvo que sean necesarios para entender el caso. 150–400 caracteres, sin viñetas ni formato.",
          },
        },
        required: ["id_cita", "summary"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "tarea",
      description: "Crea una tarea administrativa registrando datos y motivo.",
      parameters: {
        type: "object",
        properties: {
          nombre: {
            type: "string",
            description: "Nombre del paciente (NO PUEDE ESTAR VACÍO)",
          },
          apellido: {
            type: "string",
            description: "Apellido del paciente (NO PUEDE ESTAR VACÍO)",
          },
          telefono: {
            type: "string",
            description: "Teléfono del paciente (NO PUEDE ESTAR VACÍO)",
          },
          motivo: {
            type: "string",
            description: "Motivo de la tarea (NO PUEDE ESTAR VACÍO)",
          },
          canal_preferido: {
            type: ["string", "null"],
            enum: ["llamada", "WhatsApp"],
            description:
              "Canal preferido para contacto (opcional, null si no aplica)",
          },
        },
        required: ["nombre", "apellido", "telefono", "motivo", "canal_preferido"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
] as const;

export default openaiTools;
