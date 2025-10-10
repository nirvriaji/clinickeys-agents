// /entities/bot-config/types.ts

/**
 * Tipos y entidad central para configuración de bots
 */

export type BotConfigType = "notificationBot" | "chatBot";

export interface BotConfig {
  botConfigId: string; // UUID generado por backend
  botConfigType: BotConfigType;
  description: string;
  kommoSubdomain: string;
  kommo: {
    subdomain: string;
    longLivedToken: string;
    responsibleUserId: number;
    salesbotId: string;
  };
  openai?: {
    apiKey: string;
  };
  defaultCountry: string;
  timezone: string;
  isEnabled: boolean;
  isReady: boolean; // Solo lectura, calculado backend
  kommoLeadsCustomFields: Record<string, any>;
  fieldsProfile: "default_kommo_profile"; // Siempre este valor, solo lectura
  clinicSource: "legacy"; // Siempre este valor, solo lectura
  clinicId: string | number;
  superClinicId: string | number;
  placeholders?: Record<string, string>; // Solo chatBot, solo lectura en edición
  // webhook: string; // No viene del backend, se calcula en el front
}
