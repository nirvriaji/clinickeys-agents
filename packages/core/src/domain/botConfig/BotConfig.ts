// packages/core/src/domain/botConfig/BotConfig.ts

import { BotConfigDTO, BotConfigEnrichedDTO, BotConfigType } from "./dtos";
import type { KommoCustomFieldExistence } from "@clinickeys-agents/core/application/services";

/**
 * Entidad de dominio BotConfig
 * Representa la configuración de un bot en el sistema.
 */
export class BotConfig {
  readonly pk: string;
  readonly sk: string;
  readonly bucket: number;
  readonly botConfigId: string;
  readonly botConfigType: BotConfigType;
  readonly description?: string;
  readonly clinicSource: string;
  readonly clinicId: number;
  readonly superClinicId: number;
  readonly defaultCountry: string;
  readonly timezone: string;
  readonly isEnabled: boolean;
  readonly fieldsProfile: string;
  readonly placeholders?: Record<string, any>;
  readonly kommoSubdomain: string;
  readonly kommo: {
    subdomain: string;
    longLivedToken: string;
    responsibleUserId: number;
    salesbotId: number;
  };
  readonly openai?: {
    apiKey: string;
  };
  readonly createdAt: number;
  readonly updatedAt: number;

  constructor(dto: BotConfigDTO) {
    this.pk = dto.pk;
    this.sk = dto.sk;
    this.bucket = dto.bucket;
    this.botConfigId = dto.botConfigId;
    this.botConfigType = dto.botConfigType;
    this.description = dto.description;
    this.clinicSource = dto.clinicSource;
    this.clinicId = dto.clinicId;
    this.superClinicId = dto.superClinicId;
    this.defaultCountry = dto.defaultCountry;
    this.timezone = dto.timezone;
    this.isEnabled = dto.isEnabled ?? false;
    this.fieldsProfile = dto.fieldsProfile;
    this.placeholders = dto.placeholders;
    this.kommoSubdomain = dto.kommoSubdomain;
    this.kommo = {
      subdomain: dto.kommo.subdomain,
      longLivedToken: dto.kommo.longLivedToken,
      responsibleUserId: dto.kommo.responsibleUserId,
      salesbotId: dto.kommo.salesbotId,
    };
    if (dto.openai) {
      this.openai = {
        apiKey: dto.openai.apiKey,
      };
    }
    this.createdAt = dto.createdAt;
    this.updatedAt = dto.updatedAt;
  }
}

/**
 * Entidad de dominio BotConfig enriquecida
 * Incluye información adicional para determinar la preparación del bot.
 */
export class BotConfigEnriched extends BotConfig {
  readonly kommoLeadsCustomFields: KommoCustomFieldExistence[];
  readonly isReady: boolean;

  constructor(dto: BotConfigEnrichedDTO) {
    super(dto);
    this.kommoLeadsCustomFields = dto.kommoLeadsCustomFields;
    this.isReady = dto.isReady;
  }
}
