import { KommoService, PatientService } from "@clinickeys-agents/core/application/services";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { PATIENT_FIRST_NAME, PATIENT_LAST_NAME, PATIENT_PHONE } from "@clinickeys-agents/core/utils";
import { z } from "zod";
import type { BotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";
import { DateTime } from "luxon";

const IdentifyPatientSchema = z.object({
  nombre: z.string(),
  apellido: z.string(),
  telefono: z.string(),
});

export interface IdentifyPatientInput {
  botConfig: BotConfigDTO;
  leadId: number;
  params: z.infer<typeof IdentifyPatientSchema>;
  tiempoActualDT: DateTime;
}

export interface IdentifyPatientOutput {
  success: boolean;
  toolOutput: string;
  patientInfo?: any;
}

export class IdentifyPatientUseCase {
  constructor(
    private readonly kommoService: KommoService,
    private readonly patientService: PatientService
  ) { }

  public async execute(input: IdentifyPatientInput): Promise<IdentifyPatientOutput> {
    const { botConfig, leadId, params, tiempoActualDT } = input;
    const { nombre, apellido, telefono } = IdentifyPatientSchema.parse(params);

    Logger.info("[IdentifyPatientUseCase] Inicio", { leadId, nombre, apellido, telefono });

    try {
      // Asegurar existencia del paciente (buscar o crear)
      const pacientes = await this.patientService.getPatientByPhoneOrCreate({
        nombre,
        apellido,
        telefono,
        id_clinica: botConfig.clinicId,
        id_super_clinica: (botConfig as any).id_super_clinica || botConfig.clinicId,
        kommo_lead_id: leadId,
      });

      if (!pacientes || !pacientes.length) {
        Logger.error("[IdentifyPatientUseCase] No se pudo crear o recuperar paciente", { telefono });
        return { success: false, toolOutput: "No fue posible registrar tu información en este momento." };
      }

      const paciente = pacientes[0];
      Logger.info("[IdentifyPatientUseCase] Paciente identificado o creado", { id_paciente: paciente.id_paciente });

      // Guardar los datos básicos en Kommo
      await this.kommoService.updateLeadCustomFields({
        botConfig,
        leadId,
        customFields: {
          [PATIENT_FIRST_NAME]: nombre,
          [PATIENT_LAST_NAME]: apellido,
          [PATIENT_PHONE]: telefono,
        },
      });

      Logger.info("[IdentifyPatientUseCase] CF actualizados en Kommo", { leadId, nombre, apellido, telefono });

      // Obtener toda la información asociada al nuevo número
      const patientInfo = await this.patientService.getPatientInfo(
        tiempoActualDT,
        botConfig.clinicId,
        {
          in_lead_cf: '',
          in_contact_cf: '',
          in_conversation: telefono,
        }
      );

      let toolOutput = `#identificarPaciente
      Buscando por el teléfono proporcionado devolvió esta información: ${JSON.stringify(patientInfo)}
      `;

      return { success: true, toolOutput };
    } catch (error) {
      Logger.error("[IdentifyPatientUseCase] Error durante la ejecución", { error });
      return { success: false, toolOutput: "Ocurrió un error al registrar tu información. Inténtalo nuevamente." };
    }
  }
}
