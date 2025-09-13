// packages/core/src/utils/availability/filterAvailabilityByRestrictions.ts

import { z } from "zod";
import { IOpenAIService } from "@clinickeys-agents/core/domain/openai";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";

// Schema de cada slot de disponibilidad
const DisponibilidadSchema = z.object({
  hora_inicio_minima: z.string(),
  hora_inicio_maxima: z.string(),
  id_medico: z.number(),
  nombre_medico: z.string(),
  id_espacio: z.number(),
  nombre_espacio: z.string(),
  id_tratamiento: z.number(),
  nombre_tratamiento: z.string(),
  duracion_tratamiento: z.number(),
  especifica: z.boolean(),
  fecha_legible: z.string().optional(),
  fecha_cita: z.string(),
});

const DisponibilidadesFiltradasSchema = z.array(DisponibilidadSchema);

export type Disponibilidad = z.infer<typeof DisponibilidadSchema>;

/**
 * Filtra disponibilidades usando reglas definidas en RESTRICCIONES_EN_DISPONIBILIDADES.
 * Si las restricciones están vacías, devuelve las disponibilidades originales.
 */
export async function filterAvailabilityByRestrictions(
  openAIService: IOpenAIService,
  disponibilidades: Disponibilidad[],
  restricciones: string
): Promise<Disponibilidad[]> {
  if (!restricciones || restricciones.trim() === "") {
    Logger.debug("[filterAvailabilityByRestrictions] Sin restricciones, devolviendo disponibilidades originales");
    return disponibilidades;
  }

  const systemPrompt = `Eres un filtro de disponibilidades médicas.
Recibirás un array de disponibilidades y un conjunto de restricciones.
Devuelve únicamente las disponibilidades que cumplan las restricciones.
Responde siempre con un JSON que cumpla el schema proporcionado.`;

  const userPrompt = `RESTRICCIONES_EN_DISPONIBILIDADES:
${restricciones}

DISPONIBILIDADES_ORIGINALES:
${JSON.stringify(disponibilidades, null, 2)}`;

  try {
    const { parsed } = await openAIService.getSchemaStructuredResponse(
      systemPrompt,
      userPrompt,
      DisponibilidadesFiltradasSchema,
      "DisponibilidadesFiltradasSchema"
    );

    if (!parsed) {
      Logger.warn("[filterAvailabilityByRestrictions] No se pudo parsear respuesta de OpenAI, devolviendo originales");
      return disponibilidades;
    }

    return parsed;
  } catch (error) {
    Logger.error("[filterAvailabilityByRestrictions] Error al filtrar con restricciones:", error);
    return disponibilidades;
  }
}