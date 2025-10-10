import { BotConfigDTO, BotConfigEnrichedDTO, BotConfigType } from '@clinickeys-agents/core/domain/botConfig';
import { KommoCustomFieldExistence } from '@clinickeys-agents/core/application/services';
import { profiles, CHAT_BOT_CUSTOM_FIELDS, NOTIFICATION_BOT_CUSTOM_FIELDS } from '@clinickeys-agents/core/utils';

// Props requeridos solo para ChatBot
const CHAT_BOT_REQUIRED_PROPS = [
  'kommo',
  'openai',
  'timezone',
  'clinicId',
  'placeholders',
  'clinicSource',
  'superClinicId',
  'botConfigType',
  'fieldsProfile',
  'defaultCountry',
  'kommoSubdomain',
] as const;

// Props requeridos solo para NotificationBot
const NOTIFICATION_BOT_REQUIRED_PROPS = [
  'kommo',
  'timezone',
  'clinicId',
  'clinicSource',
  'superClinicId',
  'botConfigType',
  'fieldsProfile',
  'defaultCountry',
  'kommoSubdomain',
] as const;

const REQUIRED_KOMMO_PROPS = [
  'subdomain',
  'salesbotId',
  'longLivedToken',
  'responsibleUserId',
] as const;

const REQUIRED_OPENAI_PROPS = ['apiKey'] as const;

export class BotConfigEnricher {
  /**
   * Enriquecedor de config, compara solo contra los campos requeridos por tipo de bot
   * dentro del universo del profile, usando campos reales de Kommo si los recibe.
   */
  public static enrich(
    botConfig: BotConfigDTO,
    kommoCustomFields?: KommoCustomFieldExistence[],
  ): BotConfigEnrichedDTO {
    const missingProps: string[] = [];
    let requiredProps: readonly string[] = [];
    let requiredCustomFields: string[] = [];

    // 1) Props requeridos según tipo de bot
    if (botConfig.botConfigType === BotConfigType.ChatBot) {
      requiredProps = CHAT_BOT_REQUIRED_PROPS;
      requiredCustomFields = [...CHAT_BOT_CUSTOM_FIELDS];
    } else if (botConfig.botConfigType === BotConfigType.NotificationBot) {
      requiredProps = NOTIFICATION_BOT_REQUIRED_PROPS;
      requiredCustomFields = [...NOTIFICATION_BOT_CUSTOM_FIELDS];
    }

    // 2) Validar propiedades raíz obligatorias
    for (const prop of requiredProps) {
      if ((botConfig as any)[prop] === undefined || (botConfig as any)[prop] === null) {
        missingProps.push(prop);
      }
    }

    // 3) Validar kommo (objeto y sus props)
    if (typeof botConfig.kommo !== 'object' || botConfig.kommo === null) {
      missingProps.push('kommo (object)');
    } else {
      for (const kprop of REQUIRED_KOMMO_PROPS) {
        const value = (botConfig.kommo as any)[kprop];
        if (
          value === undefined ||
          value === null ||
          value === ''
        ) {
          missingProps.push(`kommo.${kprop}`);
        }
      }
    }

    // 4) Validar openai (objeto y sus props) SOLO para chatBot
    if (botConfig.botConfigType === BotConfigType.ChatBot) {
      if (typeof botConfig.openai !== 'object' || botConfig.openai === null) {
        missingProps.push('openai (object)');
      } else {
        for (const oprop of REQUIRED_OPENAI_PROPS) {
          const value = (botConfig.openai as any)[oprop];
          if (
            value === undefined ||
            value === null ||
            value === ''
          ) {
            missingProps.push(`openai.${oprop}`);
          }
        }
      }
    }

    // 5) Determinar el universo del profile (para debug o fallback legacy)
    const profile = (profiles as any)[botConfig.fieldsProfile];
    let profileFieldNames: string[] = [];
    if (profile && profile.lead && Array.isArray(profile.lead.custom_field_config)) {
      profileFieldNames = profile.lead.custom_field_config.map((f: any) => f.field_name);
    }

    // 6) Usar los campos reales de Kommo si los recibimos, si no usar el profile como legacy
    let customFieldsActual: KommoCustomFieldExistence[] = [];
    if (kommoCustomFields) {
      customFieldsActual = kommoCustomFields;
    } else if (Array.isArray(profileFieldNames) && profileFieldNames.length > 0) {
      // Fallback: construir presencia en base al perfil (sin existencia real)
      customFieldsActual = profileFieldNames.map((name: string) => ({
        field_name: name,
        field_type: '',
        exists: false,
      }));
    }

    // 7) Solo chequear los requeridos por tipo de bot (subset del universo profile/kommo)
    const existingNames = customFieldsActual.filter((f) => f.exists).map((f) => f.field_name);
    const missingCustomFields = requiredCustomFields.filter((field) => !existingNames.includes(field));

    const isReady = missingProps.length === 0 && missingCustomFields.length === 0;

    return {
      ...botConfig,
      kommoLeadsCustomFields: customFieldsActual,
      isReady,
      // Si necesitas depurar, descomenta:
      // _missingProps: missingProps,
      // _missingCustomFields: missingCustomFields,
    } as BotConfigEnrichedDTO;
  }

  /**
   * EnrichMany con el mismo patrón, acepta arreglo de arrays de campos Kommo
   */
  public static enrichMany(
    configs: BotConfigDTO[],
    kommoCustomFieldsArray?: KommoCustomFieldExistence[][],
  ): BotConfigEnrichedDTO[] {
    if (kommoCustomFieldsArray && kommoCustomFieldsArray.length === configs.length) {
      return configs.map((cfg, i) => this.enrich(cfg, kommoCustomFieldsArray[i]));
    }
    return configs.map((cfg) => this.enrich(cfg));
  }
}

export default BotConfigEnricher;