// packages/core/src/utils/CustomFieldUtils.ts

import {
  KommoCustomFieldDefinitionBase,
  KommoCustomFieldMap,
  KommoCustomFieldValueBase,
} from '@clinickeys-agents/core/infrastructure/integrations/kommo/models';

/**
 * Construye un mapa de campos personalizados indexado por nombre, código **e id**.
 */
export function getCustomFieldMap<T extends KommoCustomFieldDefinitionBase>(
  fields: T[]
): KommoCustomFieldMap<T> {
  const byName: Record<string, T> = {};
  const byCode: Record<string, T> = {};
  const byId: Record<number, T> = {};

  for (const field of fields) {
    if (field == null) continue;
    byId[field.id] = field;
    if (field.name) {
      byName[field.name] = field as T;
    }
    if (field.code) {
      byCode[field.code.toUpperCase()] = field as T;
    }
  }

  return { byName, byCode, byId };
}

/**
 * Normaliza los campos personalizados de una entidad para que siempre contengan todos los campos del catálogo.
 * Si no hay valor presente, se coloca `null`.
 */
export function normalizeEntityCustomFields(
  catalog: KommoCustomFieldDefinitionBase[],
  values: KommoCustomFieldValueBase[] = []
): Array<KommoCustomFieldValueBase & { value: any }> {
  const valueMap = new Map<number, KommoCustomFieldValueBase>(
    values.map((v) => [v.field_id, v])
  );
  return catalog.map((def) => {
    const existing = valueMap.get(def.id);
    return {
      field_id: def.id,
      field_name: def.name,
      field_type: def.type,
      field_code: def.code,
      values: existing?.values || [],
      value: existing?.values?.[0]?.value ?? null,
    };
  });
}

/**
 * Construye un arreglo de `custom_fields_values` para PATCH en Kommo.
 * @param customFields Objeto con nombre o código como clave y el valor como valor.
 */
export function buildCustomFieldsValuesFromMap(
  fieldMap: KommoCustomFieldMap,
  customFields: Record<string, any>
): Array<{ field_id: number; values: Array<{ value: any; enum_id?: number; enum_code?: string }> }> {
  const result: Array<{ field_id: number; values: Array<{ value: any; enum_id?: number; enum_code?: string }> }> = [];

  for (const key of Object.keys(customFields)) {
    const value = customFields[key];
    if (value === undefined) continue;
    const def = fieldMap.byName[key] || fieldMap.byCode[key.toUpperCase?.() ?? ''];
    if (!def) continue;

    const payloadValue: { value: any } = { value };
    result.push({
      field_id: def.id,
      values: [payloadValue],
    });
  }

  return result;
}