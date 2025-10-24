import { z } from "zod";
import { DateTime } from "luxon";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import type { BotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";
import { KommoCustomFieldValueBase } from "@clinickeys-agents/core/infrastructure/integrations/kommo";
import { PatientService } from "@clinickeys-agents/core/application/services";
import { PATIENT_PHONE } from "@clinickeys-agents/core/utils";

// =============================
// Zod Schema
// =============================
const LoadPatientsByPhoneSchema = z.object({
  telefono_consulta: z.string().min(3, "Teléfono muy corto"),
});

// =============================
// Tipos públicos del caso de uso
// =============================
export interface LoadPatientsByPhoneInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  params: z.infer<typeof LoadPatientsByPhoneSchema>;
  tiempoActualDT: DateTime;
}

export interface LoadPatientsByPhoneOutput {
  success: boolean;
  /**
   * Mensaje serializado que el orquestador rebota al asistente.
   * Debe iniciar con el tag de tool para facilitar parsing aguas arriba.
   */
  toolOutput: string;
  /** Campos opcionales a sugerir como actualización de CF en Kommo */
  customFields?: Record<string, string>;
}

// =============================
// Caso de uso: solo LECTURA
//  - No crea pacientes.
//  - Devuelve el bundle de info de todos los pacientes asociados al teléfono consultado.
// =============================
export class LoadPatientsByPhoneUseCase {
  constructor(private readonly patientService: PatientService) {}

  public async execute(input: LoadPatientsByPhoneInput): Promise<LoadPatientsByPhoneOutput> {
    const { botConfig, leadId, params, tiempoActualDT } = input;
    const { telefono_consulta } = LoadPatientsByPhoneSchema.parse(params);

    Logger.info("[LoadPatientsByPhoneUseCase] Inicio", { leadId, telefono_consulta });

    try {
      // Cargar información completa (pacientes, citas, presupuestos, packs/bonos) asociada al teléfono consultado.
      const info = await this.patientService.getPatientInfo(
        tiempoActualDT,
        botConfig.clinicId,
        {
          in_conversation: telefono_consulta,
          in_lead_cf: "",
          in_contact_cf: "",
        }
      );

      // Redactar salida estándar
      const payload = {
        success: info.success,
        message: info.message,
        totalPatients: info.patients?.length || 0,
        patients: (info.patients || []).map((p) => ({
          paciente: {
            id_paciente: p.paciente.id_paciente,
            nombre: p.paciente.nombre,
            apellido: p.paciente.apellido,
            telefono: p.paciente.telefono,
          },
          // Reducimos algo de ruido pero mantenemos lo esencial
          citas: p.citas,
          presupuestos: p.presupuestos,
          packsBonos: p.packsBonos,
        })),
      };

      const toolOutput = `#cargarPacientesPorTelefono\n${JSON.stringify(payload)}`;

      const customFields: Record<string, string> = {
        [PATIENT_PHONE]: telefono_consulta,
      };

      Logger.info("[LoadPatientsByPhoneUseCase] Fin OK", {
        found: payload.totalPatients,
      });

      return {
        success: true,
        toolOutput,
        customFields,
      };
    } catch (error: any) {
      Logger.error("[LoadPatientsByPhoneUseCase] Error", { error: error?.message || error });
      return {
        success: false,
        toolOutput: `#cargarPacientesPorTelefono\n{"success":false,"message":"No fue posible obtener la información de pacientes en este momento."}`,
      };
    }
  }
}

export default LoadPatientsByPhoneUseCase;
