import { KommoCustomFieldDefinitionBase, KommoContactResponse, KommoCustomFieldValueBase } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import { normalizeEntityCustomFields } from '@clinickeys-agents/core/utils';
import { KommoService } from '@clinickeys-agents/core/application/services';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { AvailabilityEventCatalog } from '@clinickeys-agents/core/domain/availability/events';
import { AvailabilityEventLogger } from '@clinickeys-agents/core/infrastructure/logging';

export interface FetchKommoDataInput {
  botConfig: BotConfigDTO;
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
    private readonly kommoService: KommoService
  ) {}

  async execute(input: FetchKommoDataInput): Promise<FetchKommoDataOutput | undefined> {
    const { botConfig, leadId } = input;

    if (!botConfig) {
      const event = AvailabilityEventCatalog.ERROR_INTERNO_SERVIDOR();
      AvailabilityEventLogger.log(event);
      return undefined;
    }

    Logger.debug('[FetchKommoData] Obteniendo lead por ID', { leadId });
    const leadData = await this.kommoService.getLeadById(leadId);

    if (!leadData) {
      const event = AvailabilityEventCatalog.ERROR_DESCONOCIDO({ message: `Lead no encontrado: ${leadId}` });
      AvailabilityEventLogger.log(event);
      return undefined;
    }

    const contacts = leadData?._embedded?.contacts || [];

    if (!contacts.length) {
      const event = AvailabilityEventCatalog.ERROR_DESCONOCIDO({ message: `Lead sin contactos: ${leadId}` });
      AvailabilityEventLogger.log(event);
      return undefined;
    }

    const contactId = Number(contacts[0].id);
    Logger.debug('[FetchKommoData] Obteniendo contacto por ID', { contactId });

    const contactData = await this.kommoService.getContactById(contactId);
    if (!contactData) {
      const event = AvailabilityEventCatalog.ERROR_DESCONOCIDO({ message: `Contacto sin datos: ${contactId}` });
      AvailabilityEventLogger.log(event);
      return undefined;
    }

    const { leadMap, contactMap } = await this.kommoService.getCustomFieldMappings();

    const leadDefs = Object.values(leadMap.byName) as KommoCustomFieldDefinitionBase[];
    const contactDefs = Object.values(contactMap.byName) as KommoCustomFieldDefinitionBase[];

    const normalizedLeadCF = normalizeEntityCustomFields(
      leadDefs,
      leadData?.custom_fields_values || []
    );

    const normalizedContactCF = normalizeEntityCustomFields(
      contactDefs,
      contactData?.custom_fields_values || []
    );

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