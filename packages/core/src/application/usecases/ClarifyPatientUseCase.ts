// packages/core/src/application/usecases/ClarifyPatientUseCase.ts

import { KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { z } from 'zod';

const ClarifyPatientSchema = z.object({
  telefono: z.string(),
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
    const { telefono, id_clinica, candidatos } = ClarifyPatientSchema.extend({
      candidatos: z.array(
        z.object({
          id_paciente: z.number(),
          nombre: z.string(),
          apellido: z.string(),
          telefono: z.string(),
        })
      ),
    }).parse(params);

    Logger.info('[ClarifyPatientUseCase] Inicio', { telefono, id_clinica, totalCandidatos: candidatos.length });

    if (!candidatos.length) {
      Logger.warn('[ClarifyPatientUseCase] No se recibieron candidatos para clarificar', { telefono, id_clinica });
      return {
        success: true,
        toolOutput: `#clarificarPaciente\nNo se encontraron pacientes registrados con el número ${telefono}. ¿Quieres crear un nuevo paciente con tus datos?`,
      };
    }

    const opciones = candidatos
      .map(p => `- ${p.nombre} ${p.apellido} (Tel: ${p.telefono}, ID: ${p.id_paciente})`)
      .join('\n');

    const mensaje = `#clarificarPaciente\nSe encontraron múltiples pacientes asociados al número ${telefono}. Por favor indica cuál es el correcto:\n${opciones}`;

    Logger.info('[ClarifyPatientUseCase] Mensaje generado para clarificación', { mensaje });

    return {
      success: true,
      toolOutput: mensaje,
    };
  }
}