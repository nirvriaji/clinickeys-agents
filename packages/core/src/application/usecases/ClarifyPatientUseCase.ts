// packages/core/src/application/usecases/ClarifyPatientUseCase.ts

import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { z } from 'zod';

const ClarifyPatientSchema = z.object({
  id_clinica: z.number(),
});

export interface ClarifyPatientInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  params: z.infer<typeof ClarifyPatientSchema> & {
    candidatos: Array<{ id_paciente: number; nombre: string; apellido: string; telefono: string }>;
  };
}

export interface ClarifyPatientOutput {
  success: boolean;
  toolOutput: string;
}

export class ClarifyPatientUseCase {
  public async execute(input: ClarifyPatientInput): Promise<ClarifyPatientOutput> {
    const { params } = input;
    const { id_clinica, candidatos } = ClarifyPatientSchema.extend({
      candidatos: z.array(
        z.object({
          id_paciente: z.number(),
          nombre: z.string(),
          apellido: z.string(),
          telefono: z.string(),
        })
      ),
    }).parse(params);

    Logger.info('[ClarifyPatientUseCase] Inicio', { id_clinica, totalCandidatos: candidatos.length });

    if (!candidatos.length) {
      Logger.warn('[ClarifyPatientUseCase] No se recibieron candidatos para clarificar', { id_clinica });
      return {
        success: true,
        toolOutput:
          '#clarificarPaciente\nNo se encontraron pacientes registrados. ¿Quieres crear un nuevo paciente con tus datos?',
      };
    }

    // Detectar duplicados por nombre+apellido
    const nombreApellidoMap = new Map<string, number>();
    const duplicados = new Set<string>();
    for (const c of candidatos) {
      const key = `${c.nombre.toLowerCase()}-${c.apellido.toLowerCase()}`;
      if (nombreApellidoMap.has(key)) {
        duplicados.add(key);
      } else {
        nombreApellidoMap.set(key, 1);
      }
    }

    const opciones = candidatos
      .map((p) => {
        const key = `${p.nombre.toLowerCase()}-${p.apellido.toLowerCase()}`;
        if (duplicados.has(key) && p.telefono) {
          return `- ${p.nombre} ${p.apellido} (Tel: ${p.telefono}, ID: ${p.id_paciente})`;
        }
        return `- ${p.nombre} ${p.apellido} (ID: ${p.id_paciente})`;
      })
      .join('\n');

    const mensaje = `#clarificarPaciente\nSe encontraron múltiples pacientes asociados. Por favor indica cuál es el correcto:\n${opciones}`;

    Logger.info('[ClarifyPatientUseCase] Mensaje generado para clarificación', { mensaje });

    return {
      success: true,
      toolOutput: mensaje,
    };
  }
}