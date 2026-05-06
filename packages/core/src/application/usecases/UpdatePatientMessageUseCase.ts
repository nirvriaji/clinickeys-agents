// packages/core/src/application/usecases/UpdatePatientMessageUseCase.ts

import { KommoService } from "@clinickeys-agents/core/application/services";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import {
  PATIENT_MESSAGE,
  LAST_PATIENT_MESSAGE,
  PATIENT_MESSAGE_PROCESSED_CHUNK,
} from "@clinickeys-agents/core/utils";
import { KommoCustomFieldValueBase } from "@clinickeys-agents/core/infrastructure/integrations/kommo";
import type { BotConfigDTO } from "@clinickeys-agents/core/domain/botConfig";
import { diffArrays } from "diff";

export interface UpdatePatientMessageInput {
  botConfig: BotConfigDTO;
  leadId: number;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
}

export interface UpdatePatientMessageOutput {
  success: boolean;
  newPatientMessage: string;
}

export class UpdatePatientMessageUseCase {
  constructor(private readonly kommoService: KommoService) {}

  private splitWords(text: string): string[] {
    return (text || "").split(/\s+/).filter(Boolean);
  }

  /**
   * Extrae la parte nueva en newText respecto a oldText usando diff de arrays (palabras).
   * No normaliza ni usa regex; asume que uno está contenido en el otro.
   */
  private extractNewPart(oldText: string, newText: string): string {
    const oldWords = this.splitWords(oldText);
    const newWords = this.splitWords(newText);

    if (oldWords.length === 0) return newText;
    if (newWords.length === 0) return "";

    const changes = diffArrays(oldWords, newWords);
    const added: string[] = [];

    for (const change of changes) {
      if (change.added && Array.isArray(change.value)) {
        added.push(...change.value);
      }
    }

    return added.join(" ").trim();
  }

  private normalizeForComparison(text: string): string {
    return this.splitWords(text).join(" ").trim();
  }

  public async execute(
    input: UpdatePatientMessageInput
  ): Promise<UpdatePatientMessageOutput> {
    const { botConfig, leadId, normalizedLeadCF } = input;

    try {
      Logger.info("[UpdatePatientMessageUseCase] Inicio", { leadId });

      const patientMessage =
        normalizedLeadCF.find((cf) => cf.field_name === PATIENT_MESSAGE)?.value ||
        "";
      const lastPatientMessage =
        normalizedLeadCF.find((cf) => cf.field_name === LAST_PATIENT_MESSAGE)?.value ||
        "";
      const patientMessageProcessedChunk =
        normalizedLeadCF.find(
          (cf) => cf.field_name === PATIENT_MESSAGE_PROCESSED_CHUNK
        )?.value || "";

      Logger.debug("[UpdatePatientMessageUseCase] Valores extraídos", {
        patientMessage,
        lastPatientMessage,
        patientMessageProcessedChunk,
      });

      const normalizedLastPatientMessage = this.normalizeForComparison(String(lastPatientMessage));
      const normalizedProcessedChunk = this.normalizeForComparison(String(patientMessageProcessedChunk));

      // Si el último mensaje ya fue cubierto por el chunk procesado, es un webhook atrasado/reintento.
      if (
        normalizedLastPatientMessage &&
        normalizedProcessedChunk &&
        normalizedLastPatientMessage === normalizedProcessedChunk
      ) {
        Logger.info("[UpdatePatientMessageUseCase] Sin texto nuevo; último mensaje ya procesado", { leadId });
        await this.kommoService.updateLeadCustomFields({
          botConfig,
          leadId,
          customFields: {
            [LAST_PATIENT_MESSAGE]: "",
            [PATIENT_MESSAGE]: "",
          },
        });
        return { success: true, newPatientMessage: "" };
      }

      // Objetivo: extraer SOLO la parte nueva entre el chunk procesado y el último mensaje.
      // En el primer turno, cuando no hay chunk previo, el mensaje completo sí es nuevo.
      const newPatientMessage = normalizedProcessedChunk
        ? this.extractNewPart(String(patientMessageProcessedChunk), String(lastPatientMessage))
        : String(lastPatientMessage || "").trim();

      Logger.debug("[UpdatePatientMessageUseCase] Nuevo patientMessage calculado", {
        newPatientMessage,
      });

      await this.kommoService.updateLeadCustomFields({
        botConfig,
        leadId,
        customFields: {
          [LAST_PATIENT_MESSAGE]: "",
          [PATIENT_MESSAGE]: newPatientMessage,
        },
      });

      Logger.info("[UpdatePatientMessageUseCase] Actualización completada", {
        leadId,
        newPatientMessage,
      });

      return { success: true, newPatientMessage };
    } catch (error) {
      Logger.error("[UpdatePatientMessageUseCase] Error ejecutando caso de uso", {
        leadId: input.leadId,
        error,
      });
      return { success: false, newPatientMessage: "" };
    }
  }
}
