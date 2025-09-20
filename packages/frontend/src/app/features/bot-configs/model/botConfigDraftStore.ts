// packages/frontend/src/app/features/bot-configs/model/botConfigDraftStore.ts

import { create } from 'zustand';
import type { CreateBotConfigPayload } from '@/app/features/bot-configs/model/types';

interface BotConfigDraftState {
  draft: CreateBotConfigPayload | null;
  setDraft: (data: CreateBotConfigPayload) => void;
  clearDraft: () => void;
}

export const useBotConfigDraftStore = create<BotConfigDraftState>((set) => ({
  draft: null,
  setDraft: (data) => set({ draft: data }),
  clearDraft: () => set({ draft: null }),
}));
