// infra/database.ts

import { SUFFIX } from "./config";

/**
 * BotConfig table
 *
 *  Cada registro representa la configuración de UN BOT específico para una clínica.
 *
 *  PK → "CLINIC#<clinicSource>#<clinicId>"
 *  SK → "BOT_CONFIG#<botConfigType>#<botConfigId>"
 *
 *  Ejemplo de valores:
 *    pk: "CLINIC#v2#c123"
 *    sk: "BOT_CONFIG#notificationBot#abc123"
 *
 *  GSIs disponibles:
 *   • byKommoSubdomain → listado/lookup por CRM + subdominio
 *   • byBucketCreated → feed global shard‑bucket → creado más reciente
 *   • byClinicSource → feed por fuente
 */

export const botConfigDynamo = new sst.aws.Dynamo(`BotConfigDynamo${SUFFIX}`, {
  fields: {
    // =======================
    // Claves primarias
    // =======================

    /**
     * Clave de partición (hash)
     * Formato: "CLINIC#<clinicSource>#<clinicId>"
     */
    pk: "string",

    /**
     * Clave de ordenamiento (range)
     * Formato: "BOT_CONFIG#<botConfigType>#<botConfigId>"
     */
    sk: "string",

    // =======================
    // Identidad y tipo de bot
    // =======================

    /**
     * Tipo de bot al que corresponde esta configuración.
     * Ejemplo: "notificationBot", "chatBot", "ventasBot", etc.
     */
    botConfigType: "string",

    // =======================
    // Estado y control
    // =======================

    /**
     * Permite activar o desactivar manualmente el bot (ON/OFF).
    //  */
    // isEnabled: "binary",

    /**
     * Indica si el bot ya está listo para operar (servicios conectados, configuración OK, etc).
     */
    // isReady: "binary",

    // =======================
    // Clínica multi‑fuente (desnormalizado)
    // =======================

    /**
     * Fuente de la clínica: Ej. "legacy", "v2", etc.
     */
    clinicSource: "string",

    // =======================
    // Shard bucket para feeds globales
    // =======================

    /**
     * Shard para distribuir la carga en feeds globales.
     * Calculado: hash(botConfigId) % N (por ejemplo, N = 10)
     */
    bucket: "number",

    // =======================
    // Kommo (agrupado)
    // =======================

    /**
     * Subdominio Kommo (campo duplicado a nivel raíz, útil para indexar por GSI)
     */
    kommoSubdomain: "string",

    /**
     * Datos relacionados al CRM Kommo.
     * - subdomain: Subdominio Kommo (ejemplo: "clinicA.kommo.com").
     * - longLivedToken: Token persistente para API Kommo.
     * - salesbotId: Identificador del Salesbot Kommo (si aplica).
     * - [agrega aquí futuras props de integración Kommo]
     */
    // kommo: "map", // { subdomain: string, longLivedToken: string, salesbotId: string, ... }

    // =======================
    // OpenAI (agrupado)
    // =======================

    /**
     * Datos relacionados a OpenAI.
     * - apiKey: API key para acceso a OpenAI.
     *    Ejemplo: { "spanishQA": "...", "medicalBot": "..." }
     */
    // openai: "map", // { apiKey: string }

    // =======================
    // Fechas y metadatos
    // =======================

    /**
     * Fecha de creación (epoch millis)
     */
    createdAt: "number",

    /**
     * Fecha de última actualización (epoch millis)
     */
    // updatedAt: "number", // ← Puedes omitirlo hasta que lo necesites, pero ya queda documentado

    // ...otros campos futuros
  },

  primaryIndex: {
    hashKey: "pk",
    rangeKey: "sk",
  },

  globalIndexes: {
    /** Lookup y listado por Bot Config Type */
    byBotConfigType: {
      hashKey: "botConfigType",
      rangeKey: "createdAt",
      projection: "all",
    },

    /** Lookup y listado por CRM + subdominio */
    byKommoSubdomain: {
      hashKey: "kommoSubdomain",
      rangeKey: "createdAt",
      projection: "all",
    },

    /** Feed global shard‑bucket → creado más reciente */
    byBucketCreated: {
      hashKey: "bucket",
      rangeKey: "createdAt",
      projection: "all",
    },

    /** Feed por fuente */
    byClinicSourceCreated: {
      hashKey: "clinicSource",
      rangeKey: "createdAt",
      projection: "all",
    },
  },
});
