// packages/core/src/utils/schemas.ts

import { z } from 'zod';

export const ConsultaCitaSchema = z.object({
  filters: z.array(
    z.object({
      tratamientos: z.array(z.string()),
      medicos:     z.array(z.string()),
      espacios:    z.array(z.string()),
      aparatologias: z.array(z.string()),
      especialidades: z.array(z.string()),
      fechas: z.array(
        z.object({
          fecha: z.string().refine(s => /^\d{4}-\d{2}-\d{2}$/.test(s)),
          horas: z.array(z.object({ hora_inicio: z.string(), hora_fin: z.string() }))
        })
      )
    })
  )
});
