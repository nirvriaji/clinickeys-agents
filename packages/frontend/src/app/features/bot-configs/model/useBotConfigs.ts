// packages/frontend/src/app/features/bot-configs/model/useBotConfigs.ts

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { botConfigsApi } from "@/app/features/bot-configs/api/botConfigsApi";
import type { BotConfig } from "@/app/entities/bot-config/types";
import type {
  CreateBotConfigPayload,
  UpdateBotConfigPayload,
} from "@/app/features/bot-configs/model/types";
import type { ApiError, Paginated } from "@/app/shared/types/api";
import type { BotIdParams } from "@/app/features/bot-configs/api/botConfigsApi";

/** Alias local para mantener compatibilidad con imports existentes */
export type BotConfigIdParams = BotIdParams;

const BOT_CONFIGS_QUERY_KEY = ["bot-configs"] as const;
const DEFAULT_LIMIT = 30;

interface UseBotConfigsOptions {
  /** Máximo de registros por página (default: 30) */
  limit?: number;
}

export function useBotConfigs({ limit = DEFAULT_LIMIT }: UseBotConfigsOptions = {}) {
  const queryClient = useQueryClient();

  /* ------------------------------------------------------------------
   * Listado cursor‑based — solo una llamada inicial y luego caché infinito
   * ------------------------------------------------------------------ */
  const {
    data: queryData,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<Paginated<BotConfig>, ApiError>({
    queryKey: [...BOT_CONFIGS_QUERY_KEY, { limit }],
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      botConfigsApi.listBotConfigs({ limit, cursor: pageParam as string | null }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // ⚙️ Evita refetch automáticos; sólo se actualiza tras invalidación
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  /** Flatten pages en un solo array para la UI */
  const items = useMemo<BotConfig[]>(
    () => queryData?.pages.flatMap((p) => p.items) ?? [],
    [queryData],
  );

  /* ------------------------------------------------------------------
   * Mutaciones CRUD + TOGGLE — invalidan query para forzar 1 refresh
   * ------------------------------------------------------------------ */
  const createBotConfigMutation = useMutation<
    BotConfig,
    ApiError,
    CreateBotConfigPayload
  >({
    mutationFn: botConfigsApi.createBotConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOT_CONFIGS_QUERY_KEY });
    },
  });

  const createBotConfig = useCallback(
    (
      payload: CreateBotConfigPayload,
      options?: Parameters<typeof createBotConfigMutation.mutate>[1],
    ) => createBotConfigMutation.mutate(payload, options),
    [createBotConfigMutation],
  );

  const updateBotConfigMutation = useMutation<
    BotConfig,
    ApiError,
    { params: BotConfigIdParams; payload: UpdateBotConfigPayload }
  >({
    mutationFn: ({ params, payload }) =>
      botConfigsApi.updateBotConfig(params, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOT_CONFIGS_QUERY_KEY });
    },
  });

  const updateBotConfig = useCallback(
    (
      params: BotConfigIdParams,
      payload: UpdateBotConfigPayload,
      options?: Parameters<typeof updateBotConfigMutation.mutate>[1],
    ) => updateBotConfigMutation.mutate({ params, payload }, options),
    [updateBotConfigMutation],
  );

  const deleteBotConfigMutation = useMutation<
    void,
    ApiError,
    BotConfigIdParams
  >({
    mutationFn: botConfigsApi.deleteBotConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOT_CONFIGS_QUERY_KEY });
    },
  });

  const deleteBotConfig = useCallback(
    (
      params: BotConfigIdParams,
      options?: Parameters<typeof deleteBotConfigMutation.mutate>[1],
    ) => deleteBotConfigMutation.mutate(params, options),
    [deleteBotConfigMutation],
  );

  const toggleIsEnabledMutation = useMutation<
    BotConfig,
    ApiError,
    { params: BotConfigIdParams; isEnabled: boolean }
  >({
    mutationFn: ({ params, isEnabled }) =>
      botConfigsApi.toggleIsEnabled(params, isEnabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOT_CONFIGS_QUERY_KEY });
    },
  });

  const toggleIsEnabled = useCallback(
    (
      params: BotConfigIdParams,
      isEnabled: boolean,
      options?: Parameters<typeof toggleIsEnabledMutation.mutate>[1],
    ) => toggleIsEnabledMutation.mutate({ params, isEnabled }, options),
    [toggleIsEnabledMutation],
  );

  return {
    /* List data */
    items,
    pages: queryData?.pages ?? [],
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,

    /* Create */
    createBotConfig,
    isCreating: createBotConfigMutation.isPending,
    createError: createBotConfigMutation.error,
    resetCreate: createBotConfigMutation.reset,
    createBotConfigMutation,

    /* Update */
    updateBotConfig,
    isUpdating: updateBotConfigMutation.isPending,
    updateError: updateBotConfigMutation.error,
    resetUpdate: updateBotConfigMutation.reset,
    updateBotConfigMutation,

    /* Delete */
    deleteBotConfig,
    isDeleting: deleteBotConfigMutation.isPending,
    deleteError: deleteBotConfigMutation.error,
    resetDelete: deleteBotConfigMutation.reset,
    deleteBotConfigMutation,

    /* Toggle */
    toggleIsEnabled,
    isToggling: toggleIsEnabledMutation.isPending,
    toggleError: toggleIsEnabledMutation.error,
    resetToggle: toggleIsEnabledMutation.reset,
    toggleIsEnabledMutation,
  } as const;
}
