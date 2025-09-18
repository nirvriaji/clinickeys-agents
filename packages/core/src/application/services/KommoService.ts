// packages/core/src/application/services/KommoService.ts

import { Logger } from '@clinickeys-agents/core/infrastructure/external';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  KommoGetLeadByIdResponse,
  KommoContactResponse,
  KommoUsersResponse,
  KommoCustomFieldValueBase,
} from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import {
  getCustomFieldMap,
  buildCustomFieldsValuesFromMap,
  RANDOM_STAMP,
} from '@clinickeys-agents/core/utils';
import type {
  KommoCustomFieldMap,
  KommoCustomFieldDefinitionBase,
} from '@clinickeys-agents/core/infrastructure/integrations/kommo/models';
import type { IPatientRepository } from '@clinickeys-agents/core/domain/patient';
import type { IKommoRepository } from '@clinickeys-agents/core/domain/kommo';
import type { BotConfigDTO } from '@clinickeys-agents/core/domain/botConfig';
import type { CountryCode } from 'libphonenumber-js';
import {
  getCustomFieldValue,
  shouldLambdaContinue,
  PLEASE_WAIT_MESSAGE,
  BOT_MESSAGE,
  PATIENT_FIRST_NAME,
  PATIENT_LAST_NAME,
  PATIENT_PHONE,
  NOTIFICATION_ID,
  CHAT_BOT_CUSTOM_FIELDS,
} from '@clinickeys-agents/core/utils';

export class NotificationOmittedError extends Error {
  constructor(message: string = 'Notificación omitida por teléfono inválido') {
    super(message);
    this.name = 'NotificationOmittedError';
  }
}

export class KommoService {
  private kommoRepository: IKommoRepository;
  private patientRepository: IPatientRepository;
  private customFieldMappingsCache: {
    leadMap: KommoCustomFieldMap;
    contactMap: KommoCustomFieldMap;
  } | null = null;

  constructor(kommoRepository: IKommoRepository, patientRepository: IPatientRepository) {
    this.kommoRepository = kommoRepository;
    this.patientRepository = patientRepository;
  }

  async getContactById(contactId: number): Promise<KommoContactResponse | null> {
    return this.kommoRepository.getContactById({ contactId });
  }

  async getLeadById(leadId: number): Promise<KommoGetLeadByIdResponse | null> {
    return this.kommoRepository.getLeadById({ leadId });
  }

  private async loadCustomFieldMappings() {
    if (this.customFieldMappingsCache) return this.customFieldMappingsCache;
    const [leadFields, contactFields] = await Promise.all([
      this.kommoRepository.fetchCustomFields('leads'),
      this.kommoRepository.fetchCustomFields('contacts'),
    ]);
    const leadMap = getCustomFieldMap(leadFields as KommoCustomFieldDefinitionBase[]);
    const contactMap = getCustomFieldMap(contactFields as KommoCustomFieldDefinitionBase[]);
    this.customFieldMappingsCache = { leadMap, contactMap };
    Logger.info('[KommoService.loadCustomFieldMappings] Cache construida', {
      leadCount: Object.keys(leadMap.byName).length,
      contactCount: Object.keys(contactMap.byName).length,
    });
    return this.customFieldMappingsCache;
  }

  /**
   * Método público para obtener los mapeos de custom fields (con cache interno).
   * Útil para casos de uso que necesitan acceder a los catálogos completos.
   */
  public async getCustomFieldMappings(): Promise<{
    leadMap: KommoCustomFieldMap;
    contactMap: KommoCustomFieldMap;
  }> {
    return this.loadCustomFieldMappings();
  }

  public async ensureLead(input: {
    botConfig: BotConfigDTO;
    patientId: number;
    patientFirstName: string;
    patientLastName: string;
    patientPhone: string;
    notificationId?: number;
  }): Promise<number> {
    const { botConfig, patientId, patientFirstName, patientLastName, patientPhone, notificationId } = input;
    const defaultCountry = botConfig.defaultCountry as CountryCode;
    const normalizedPhone = parsePhoneNumberFromString(patientPhone, defaultCountry)?.number || patientPhone;
    Logger.info('[KommoService.ensureLead] Normalized phone', { normalizedPhone, patientId });

    // validación de negocio
    if (!normalizedPhone || normalizedPhone.trim() === '') {
      throw new NotificationOmittedError(
        `Normalized phone vacío para patientId=${patientId}, notificationId=${notificationId}`
      );
    }

    let existingLeadId: string | undefined;
    try {
      existingLeadId = await this.patientRepository.getKommoLeadId(patientId);
    } catch (e: any) {
      Logger.error('[KommoService.ensureLead] Error obteniendo leadId desde BD', e);
    }

    if (existingLeadId) {
      const leadExists = await this.kommoRepository.getLeadById({ leadId: Number(existingLeadId) });
      if (leadExists) {
        Logger.info('[KommoService.ensureLead] Lead existente reutilizado', { existingLeadId });
        return Number(existingLeadId);
      }
      Logger.warn('[KommoService.ensureLead] LeadId guardado no existe en Kommo, se creará uno nuevo', { existingLeadId });
    }

    let contactId: number | undefined;
    let leadId: number | undefined;
    const found = await this.kommoRepository.searchContactByPhone({ phone: normalizedPhone });
    if (found?._embedded?.contacts?.length) {
      contactId = Number(found._embedded.contacts[0].id);
      leadId = Number(found._embedded.contacts[0]._embedded?.leads?.[0]?.id);
      Logger.info('[KommoService.ensureLead] Contacto encontrado por teléfono', { contactId, leadId });
    }

    const { leadMap, contactMap } = await this.loadCustomFieldMappings();

    if (!contactId) {
      const contactFields: Record<string, string> = {
        PHONE: normalizedPhone
      };
      const contactPayload = [{
        name: `${patientFirstName} ${patientLastName}`,
        custom_fields_values: buildCustomFieldsValuesFromMap(contactMap, contactFields),
      }];
      Logger.info('[KommoService.ensureLead] Creando contacto', {
        name: `${patientFirstName} ${patientLastName}`,
        cfCount: contactPayload[0].custom_fields_values?.length || 0,
        cfSample: (contactPayload[0].custom_fields_values || []).slice(0, 3),
      });
      const res = await this.kommoRepository.createContact({ body: contactPayload });
      contactId = Number(res._embedded?.contacts?.[0]?.id!);
      Logger.info('[KommoService.ensureLead] Contacto creado', { contactId });
    }

    if (!leadId) {
      const leadFields: Record<string, string> = {
        [PATIENT_FIRST_NAME]: patientFirstName,
        [PATIENT_LAST_NAME]: patientLastName,
        [PATIENT_PHONE]: patientPhone,
      };
      if (notificationId != null) leadFields[NOTIFICATION_ID] = String(notificationId);

      const leadPayload = [{
        name: `${patientFirstName} ${patientLastName}`,
        _embedded: { contacts: [{ id: contactId!, is_main: true }] },
        custom_fields_values: buildCustomFieldsValuesFromMap(leadMap, leadFields),
      }];
      Logger.info('[KommoService.ensureLead] Creando lead', {
        name: `${patientFirstName} ${patientLastName}`,
        contactId,
        cfCount: leadPayload[0].custom_fields_values?.length || 0,
        cfSample: (leadPayload[0].custom_fields_values || []).slice(0, 3),
      });
      const res = await this.kommoRepository.createLead({ body: leadPayload });
      leadId = Number(res._embedded?.leads?.[0]?.id!);
      Logger.info('[KommoService.ensureLead] Lead creado', { leadId });
      try {
        await this.patientRepository.updateKommoLeadId(patientId, leadId);
        Logger.info('[KommoService.ensureLead] LeadId actualizado en BD', { patientId, leadId });
      } catch (e: any) {
        Logger.error('[KommoService.ensureLead] Error actualizando leadId en BD', e);
      }
    }

    return leadId!;
  }

  public async updateLeadCustomFields(input: {
    botConfig: BotConfigDTO;
    leadId: number;
    customFields: Record<string, string>;
  }): Promise<void> {
    const { leadMap } = await this.loadCustomFieldMappings();
    const values = buildCustomFieldsValuesFromMap(leadMap, input.customFields);
    if (!values.length) {
      Logger.warn('[KommoService.updateLeadCustomFields] custom_fields_values vacío. No se enviará PATCH.', { leadId: input.leadId });
      return;
    }
    await this.kommoRepository.patchLead({ leadId: input.leadId, payload: { custom_fields_values: values } });
  }

  public async replyToLead(input: {
    leadId: number;
    customFields: Record<string, string>;
    normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
    salesbotId: number;
  }): Promise<{ success: boolean; aborted?: boolean }> {
    // --- Logs de diagnóstico previos ---
    const customFieldKeys = Object.keys(input.customFields || {});
    Logger.info('[KommoService.replyToLead] Inicio', {
      leadId: input.leadId,
      salesbotId: input.salesbotId,
      customFieldsCount: customFieldKeys.length,
      mergedCFCount: input.normalizedLeadCF?.length || 0,
      mergedCFSample: input.normalizedLeadCF?.filter(cf => CHAT_BOT_CUSTOM_FIELDS.includes(cf.field_name)).map(cf => ({ id: cf.field_id, name: cf.field_name })) || [],
    });

    const latest = await this.kommoRepository.getLeadById({ leadId: input.leadId });
    const initialCounter = getCustomFieldValue(input.normalizedLeadCF || [], RANDOM_STAMP);
    const ok = await shouldLambdaContinue({
      latestLead: latest!,
      initialValue: initialCounter,
    });
    if (!ok) {
      Logger.warn('[KommoService.replyToLead] Abortado por shouldLambdaContinue=false', { leadId: input.leadId });
      return { success: false, aborted: true };
    } else {
      Logger.debug("[KommoService.replyToLead] La lambda continua")
    }

    // Intersección de claves (para detectar descalces de nombre)
    const mergedNames = new Set((input.normalizedLeadCF || []).map(cf => cf.field_name));
    const matches = customFieldKeys.filter(k => mergedNames.has(k));
    Logger.info('[KommoService.replyToLead] Matching keys', {
      matchesCount: matches.length,
      matchesSample: matches.slice(0, 10),
      nonMatchedSample: customFieldKeys.filter(k => !mergedNames.has(k)).slice(0, 10),
    });

    const values = (input.normalizedLeadCF || [])
      .map(cf => (cf.field_name in input.customFields)
        ? { field_id: cf.field_id, values: [{ value: input.customFields[cf.field_name] }] }
        : null)
      .filter(Boolean as any);

    Logger.info('[KommoService.replyToLead] Payload resultante', {
      items: values.length,
      payload: values.map(v => ({ field_id: (v as any).field_id, value: (v as any).values?.[0]?.value })),
    });

    if (!values.length) {
      Logger.warn('[KommoService.replyToLead] custom_fields_values vacío. No se enviará PATCH.', {
        leadId: input.leadId,
      });
    }

    try {
      await this.kommoRepository.patchLead({ leadId: input.leadId, payload: { custom_fields_values: values } });
      Logger.info('[KommoService.replyToLead] PATCH enviado con éxito', { leadId: input.leadId, count: values.length });
    } catch (e: any) {
      Logger.error('[KommoService.replyToLead] Error en PATCH lead', { leadId: input.leadId, error: e });
      throw e;
    }

    try {
      await this.kommoRepository.runSalesbot({ leadId: input.leadId, botId: input.salesbotId });
      Logger.info('[KommoService.replyToLead] Salesbot ejecutado', { leadId: input.leadId, salesbotId: input.salesbotId });
    } catch (e: any) {
      Logger.error('[KommoService.replyToLead] Error ejecutando Salesbot', { leadId: input.leadId, salesbotId: input.salesbotId, error: e });
      throw e;
    }

    return { success: true };
  }

  public async sendBotInitialMessage(input: {
    salesbotId: number;
    leadId: number;
    normalizedLeadCF: (KommoCustomFieldValueBase & { value: any })[];
    message: string;
  }): Promise<void> {
    const extra: Record<string, string> = {};
    for (const cf of input.normalizedLeadCF) if (cf.value != null) extra[cf.field_name] = String(cf.value);
    if (extra[PLEASE_WAIT_MESSAGE] === 'true') return;
    const customFields = { ...extra, [BOT_MESSAGE]: input.message, [PLEASE_WAIT_MESSAGE]: 'true' };
    Logger.info('[KommoService.sendBotInitialMessage] Preparando replyToLead', {
      leadId: input.leadId,
      salesbotId: input.salesbotId,
      keys: Object.keys(customFields),
    });
    await this.replyToLead({ salesbotId: input.salesbotId, leadId: input.leadId, customFields, normalizedLeadCF: input.normalizedLeadCF });
  }

  public async createTask(params: {
    leadId: number;
    message: string;
    minutesSinceNow?: number;
    responsibleUserId: number | string;
  }): Promise<{ success: boolean }> {
    return this.kommoRepository.createTask(params);
  }

  public async getUsers(): Promise<KommoUsersResponse | null> {
    return this.kommoRepository.getUsers();
  }
}
