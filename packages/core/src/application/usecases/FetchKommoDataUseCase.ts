import { KommoCustomFieldDefinitionBase, KommoContactResponse, KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { BotConfigType, BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { GetBotConfigUseCase } from '@clinickeys-agents/core/application/usecases';
import { normalizeEntityCustomFields } from '@clinickeys-agents/core/utils';
import { KommoService } from '@clinickeys-agents/core/application/services';
import { AvailabilityError } from "@clinickeys-agents/core/domain/errors";
import { Logger } from '@clinickeys-agents/core/infrastructure/external';

export interface FetchKommoDataInput {
  botConfigType: BotConfigType;
  botConfigId: string;
  clinicSource: string;
  clinicId: number;
  leadId: number;
}

export interface FetchKommoDataOutput {
  botConfig: BotConfigDTO;
  leadData: any;
  contactId: number;
  contactData: KommoContactResponse;
  normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
  normalizedContactCF: (KommoCustomFieldValueBase & { value: any })[];
}

export class FetchKommoDataUseCase {
  constructor(
    private readonly getBotConfigUseCase: GetBotConfigUseCase,
    private readonly kommoService: KommoService
  ) {}

  async execute(input: FetchKommoDataInput): Promise<FetchKommoDataOutput> {
    const { botConfigType, botConfigId, clinicSource, clinicId, leadId } = input;

    // 1) Obtener configuración del bot
    Logger.debug('[FetchKommoData] Obteniendo configuración del bot');
    const botConfig = await this.getBotConfigUseCase.execute(
      botConfigType,
      botConfigId,
      clinicSource,
      clinicId
    );

    if (!botConfig) {
      Logger.error('[FetchKommoData] BotConfig no encontrado', { botConfigId, clinicSource, clinicId });
      throw new AvailabilityError({
        code: 'ERR_BOTCONFIG_NOT_FOUND',
        humanMessage: `Bot config not found for botConfigId: ${botConfigId}, clinicSource: ${clinicSource}, clinicId: ${clinicId}`,
        context: { botConfigId, clinicSource, clinicId },
      });
    }
    Logger.debug('[FetchKommoData] BotConfig obtenido correctamente');

    // 2) Traer datos del lead desde Kommo
    Logger.debug('[FetchKommoData] Obteniendo lead por ID', { leadId });
    const leadData = await this.kommoService.getLeadById(leadId);
    if (!leadData) {
      Logger.error('[FetchKommoData] Lead no encontrado', { leadId });
      throw new AvailabilityError({
        code: 'ERR_LEAD_NOT_FOUND',
        humanMessage: `Lead not found for ID: ${leadId}`,
        context: { leadId },
      });
    }
    Logger.debug('[FetchKommoData] Lead obtenido correctamente');

    const contacts = leadData?._embedded?.contacts || [];
    Logger.debug('[FetchKommoData] Contactos asociados al lead', { totalContacts: contacts.length });
    if (!contacts.length) {
      Logger.error('[FetchKommoData] Lead no tiene contactos', { leadId });
      throw new AvailabilityError({
        code: 'ERR_LEAD_NO_CONTACTS',
        humanMessage: 'Lead has no contacts',
        context: { leadId, leadData },
      });
    }

    const contactId = Number(contacts[0].id);
    Logger.debug('[FetchKommoData] Obteniendo contacto por ID', { contactId });
    const contactData = await this.kommoService.getContactById(contactId);
    if (!contactData) {
      Logger.error('[FetchKommoData] Contacto sin datos', { contactId });
      throw new AvailabilityError({
        code: 'ERR_NO_CONTACT_DATA',
        humanMessage: 'Contact has no data',
        context: { contactId },
      });
    }
    Logger.debug('[FetchKommoData] Contacto obtenido correctamente');

    // 3) Obtener SOLO los campos personalizados de LEAD
    Logger.debug('[FetchKommoData] Obteniendo definiciones de campos personalizados');
    const { leadMap, contactMap } = await this.kommoService.getCustomFieldMappings();

    const leadDefs = Object.values(leadMap.byName) as KommoCustomFieldDefinitionBase[];
    const contactDefs = Object.values(contactMap.byName) as KommoCustomFieldDefinitionBase[];

    Logger.debug('[FetchKommoData] Normalizando campos personalizados del lead');
    const normalizedLeadCF = normalizeEntityCustomFields(leadDefs, leadData?.custom_fields_values || []);

    Logger.debug('[FetchKommoData] Normalizando campos personalizados del contacto');
    const normalizedContactCF = normalizeEntityCustomFields(contactDefs, contactData?.custom_fields_values || []);

    return {
      botConfig,
      leadData,
      contactId,
      contactData,
      normalizedLeadCF,
      normalizedContactCF,
    };
  }
}
