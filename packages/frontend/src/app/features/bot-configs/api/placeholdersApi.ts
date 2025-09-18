// /features/bot-configs/api/placeholdersApi.ts

import fetchJson from "@/app/shared/lib/fetchJson";
import type { Placeholder } from "@/app/features/bot-configs/model/types";

export const placeholdersApi = {
  /**
   * Devuelve la lista de placeholders por defecto que el backend expone
   * para la creación de `chatBot`.
   */
  async getDefaultPlaceholders(): Promise<any> {
    return fetchJson<any>("/bot-configs/default-placeholders");
  },
};
