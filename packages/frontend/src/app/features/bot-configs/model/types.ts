// /features/bot-configs/model/types.ts

import type { BotConfigType } from "@/app/entities/bot-config/types";

/**
 * Tipos auxiliares y contratos para payloads y placeholders
 */

export interface CreateBotConfigPayload {
  botConfigType: BotConfigType;
  description: string;
  kommoSubdomain: string;
  kommoLongLivedToken: string;
  kommoResponsibleUserId: number;
  kommoSalesbotId: string;
  openaiApikey?: string; // Obligatorio si es chatBot
  defaultCountry: string;
  timezone: string;
  isEnabled: boolean;
  fieldsProfile: "default_kommo_profile";
  clinicSource: "legacy";
  clinicId: string | number;
  superClinicId: string | number;
  placeholders?: Record<string, string>; // Solo para chatBot
  assistants?: any;
}

export interface UpdateBotConfigPayload {
  botConfigType: BotConfigType;
  name?: string;
  description?: string;
  kommoSubdomain?: string;
  kommoLongLivedToken?: string;
  kommoResponsibleUserId?: number;
  kommoSalesbotId?: string;
  openaiApikey?: string; // Solo si chatBot
  defaultCountry?: string;
  timezone?: string;
  isEnabled?: boolean;
  clinicSource: 'legacy',                 // <-- añadir
  fieldsProfile: 'default_kommo_profile'
  clinicId: string | number;
  superClinicId: string | number;
  assistants?: any;
  // No permite editar placeholders ni assistantIds
}

export type Placeholder = Record<string, string>;

// Otras entidades y tipos auxiliares, si fueran necesarios para el feature, deben agregarse aquí y estar tipados estrictamente.
