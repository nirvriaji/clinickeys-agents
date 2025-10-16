// packages/core/src/infrastructure/integrations/kommo/KommoApiGateway.ts

import { HttpClient } from "@clinickeys-agents/core/infrastructure/external";
import type {
  KommoContactCustomFieldDefinition,
  KommoLeadCustomFieldDefinition,
  KommoCustomFieldValueBase,
} from "@clinickeys-agents/core/infrastructure/integrations/kommo/models";

// ---------- TIPOS DE RESPUESTA KOMMO ----------

export interface KommoContactLead {
  id: string;
  _embedded?: {
    leads?: Array<{ id: string }>;
  };
}

export interface KommoSearchContactResponse {
  _embedded?: {
    contacts?: KommoContactLead[];
  };
}

export interface KommoGetLeadByIdResponse {
  id: string;
  custom_fields_values: KommoCustomFieldValueBase[]; // Tipado estricto
  _embedded?: {
    contacts?: Array<{ id: string }>;
  };
}

export interface KommoCreateContactResponse {
  _embedded?: {
    contacts?: Array<{ id: string }>;
  };
}

export interface KommoCreateLeadResponse {
  _embedded?: {
    leads?: Array<{ id: string }>;
  };
}

export interface KommoContactResponse {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  responsible_user_id: number;
  group_id: number;
  created_by: number;
  updated_by: number;
  created_at: number;
  updated_at: number;
  closest_task_at: number | null;
  is_deleted: boolean;
  is_unsorted: boolean;
  custom_fields_values: Array<{
    field_id: number;
    field_name: string;
    field_code: string;
    field_type: string;
    values: Array<{
      value: string;
      enum_id?: number;
      enum_code?: string;
    }>;
  }>;
  account_id: number;
  _links: {
    self: {
      href: string;
    };
  };
  _embedded: {
    tags: any[];
    companies: any[];
  };
}

export interface KommoUsersResponse {
  _embedded: {
    users: Array<{
      id: number;
      name: string;
      email: string;
    }>;
  };
}

// ---------- GATEWAY KOMMO PROFESIONAL ----------

export interface KommoApiGatewayOptions {
  longLivedToken: string;
  subdomain: string;
}

export class KommoApiGateway {
  private longLivedToken: string;
  private subdomain: string;
  private baseUrl: string;
  private fieldCache: Record<string, KommoLeadCustomFieldDefinition[] | KommoContactCustomFieldDefinition[]> = {};
  private http: HttpClient;

  constructor({ longLivedToken, subdomain }: KommoApiGatewayOptions) {
    this.longLivedToken = longLivedToken;
    this.subdomain = subdomain;
    this.baseUrl = `https://${subdomain}.kommo.com/api/v4`;
    this.http = new HttpClient();
  }

  async patchLead({ leadId, payload }: { leadId: number; payload: any }) {
    const url = `${this.baseUrl}/leads/${leadId}`;
    const res = await this.http.request<any>(url, {
      method: "PATCH",
      body: payload,
      token: this.longLivedToken,
    });
    return res.data;
  }

  async runSalesbot({ botId, leadId }: { botId: number; leadId: number }) {
    const url = `https://${this.subdomain}.kommo.com/api/v2/salesbot/run`;
    const body = [{ bot_id: botId, entity_id: leadId, entity_type: "2" }];
    const res = await this.http.request<any>(url, {
      method: "POST",
      body,
      token: this.longLivedToken,
    });
    return res.data;
  }

  async createContact({ body }: { body: any }): Promise<KommoCreateContactResponse> {
    const url = `${this.baseUrl}/contacts`;
    const res = await this.http.request<KommoCreateContactResponse>(url, {
      method: "POST",
      body,
      token: this.longLivedToken,
    });
    return res.data;
  }

  async createLead({ body }: { body: any }): Promise<KommoCreateLeadResponse> {
    const url = `${this.baseUrl}/leads`;
    const res = await this.http.request<KommoCreateLeadResponse>(url, {
      method: "POST",
      body,
      token: this.longLivedToken,
    });
    return res.data;
  }

  async searchContactByPhone({ phone }: { phone: string }): Promise<KommoSearchContactResponse | null> {
    const query = encodeURIComponent(phone);
    const url = `${this.baseUrl}/contacts?query=${query}&with=leads,catalog_elements&order[updated_at]=desc`;
    const res = await this.http.request<KommoSearchContactResponse>(url, {
      token: this.longLivedToken,
    });
    if (res.status === 204) return null;
    return res.data;
  }

  async getLeadById({ leadId }: { leadId: number }): Promise<KommoGetLeadByIdResponse | null> {
    const url = `${this.baseUrl}/leads/${leadId}?with=contacts`;
    const res = await this.http.request<KommoGetLeadByIdResponse>(url, {
      token: this.longLivedToken,
    });
    if (res.status === 204) return null;
    return res.data;
  }

  async fetchCustomFields(entityType: 'leads'): Promise<KommoLeadCustomFieldDefinition[]>;
  async fetchCustomFields(entityType: 'contacts'): Promise<KommoContactCustomFieldDefinition[]>;
  async fetchCustomFields(entityType: string): Promise<any[]> {
    if (this.fieldCache[entityType]) return this.fieldCache[entityType];
    const url = `${this.baseUrl}/${entityType}/custom_fields`;
    const res = await this.http.request<any>(url, {
      token: this.longLivedToken,
    });
    if (!res.data || !res.data._embedded?.custom_fields) {
      throw new Error(`Error fetching ${entityType} custom fields: ${res.status}`);
    }
    this.fieldCache[entityType] = res.data._embedded.custom_fields;
    return this.fieldCache[entityType];
  }

  async createTask({ body }: { body: any }) {
    // Log para diagnóstico: estructura del body
    // eslint-disable-next-line no-console
    console.log("Creating task with body:", JSON.stringify(body, null, 2));
    const url = `${this.baseUrl}/tasks`;
    const res = await this.http.request<any>(url, {
      method: "POST",
      body,
      token: this.longLivedToken,
    });
    return res.data;
  }

  async getContactById({ contactId }: { contactId: number }): Promise<KommoContactResponse | null> {
    const url = `${this.baseUrl}/contacts/${contactId}`;
    const res = await this.http.request<KommoContactResponse>(url, {
      token: this.longLivedToken,
    });
    if (res.status === 204) return null;
    return res.data;
  }

  async getUsers(): Promise<KommoUsersResponse | null> {
    const url = `${this.baseUrl}/users`;
    const res = await this.http.request<KommoUsersResponse>(url, {
      token: this.longLivedToken,
    });
    if (res.status === 204) return null;
    return res.data;
  }
}