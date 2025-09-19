// packages/frontend/src/app/features/bot-configs/model/usePlaceholders.ts

import { useQuery } from "@tanstack/react-query";

import { placeholdersApi } from "@/app/features/bot-configs/api/placeholdersApi";
import type { Placeholder } from "@/app/features/bot-configs/model/types";
import type { ApiError } from "@/app/shared/types/api";

const PLACEHOLDERS_QUERY_KEY = ["bot-configs", "placeholders"] as const;

export function usePlaceholders() {
  const { data, isLoading, error, refetch } = useQuery<any, ApiError>({
    queryKey: PLACEHOLDERS_QUERY_KEY,
    queryFn: placeholdersApi.getDefaultPlaceholders,
  });

  return {
    data: data ?? [],
    isLoading,
    error,
    refetch,
  } as const;
}
