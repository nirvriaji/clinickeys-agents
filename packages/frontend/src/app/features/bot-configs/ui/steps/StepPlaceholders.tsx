// packages/frontend/src/app/features/bot-configs/ui/steps/StepPlaceholders.tsx
"use client";

import { useEffect, useMemo } from "react";
import { Controller, UseFormReturn } from "react-hook-form";
import { TextArea } from "@/app/shared/ui/TextArea";
import { usePlaceholders } from "@/app/features/bot-configs/model/usePlaceholders";

interface StepPlaceholdersProps {
  methods: UseFormReturn<any>;
  readOnly: boolean;
}

export function StepPlaceholders({ methods, readOnly }: StepPlaceholdersProps) {
  // Hook SIEMPRE arriba y sin returns antes
  const { data: defaultPlaceholdersRaw, isLoading, error, refetch } = usePlaceholders();

  // Asegura que el form tenga el nodo "placeholders" y, si aplica, inicializa desde defaults (una sola vez)
  useEffect(() => {
    methods.register("placeholders");
  }, [methods]);

  // Normaliza defaults (por si el fetch devuelve [] al inicio)
  const defaults: Record<string, string> = useMemo(() => {
    const d = defaultPlaceholdersRaw as any;
    if (d && typeof d === "object" && !Array.isArray(d)) return d as Record<string, string>;
    return {};
  }, [defaultPlaceholdersRaw]);

  // Estado actual del form (watch NO es hook, es un método del RHF)
  const current: Record<string, string> = methods.watch("placeholders") || {};

  // Unir claves: DB/estado actual ∪ defaults — SIEMPRE calculado antes de cualquier return
  const keys = useMemo(() => {
    const a = Object.keys(defaults);
    const b = Object.keys(current);
    return Array.from(new Set([...a, ...b])).sort();
  }, [defaults, current]);

  // Prefill no intrusivo: si no es readOnly, el form aún no tiene placeholders y hay defaults → setearlos
  useEffect(() => {
    if (!readOnly && keys.length > 0 && Object.keys(current).length === 0) {
      methods.setValue("placeholders", { ...defaults }, { shouldDirty: false, shouldValidate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, keys.length]);

  // AHORA sí: renders condicionales. Ya ejecutamos todos los hooks.
  if (isLoading) {
    return <div className="py-8 text-center text-muted">Cargando placeholders...</div>;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-danger">
        Error al cargar placeholders.
        <button
          className="ml-2 underline text-blue-600 hover:text-blue-900"
          type="button"
          onClick={() => refetch()}
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold mb-2">Personaliza los Placeholders</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Puedes dejar campos vacíos o personalizarlos según tus necesidades. Estos valores serán usados por el bot para completar mensajes dinámicos.
      </p>

      {keys.map((key) => (
        <Controller
          key={key}
          name={`placeholders.${key}`}
          control={methods.control}
          render={({ field }) => (
            <TextArea
              label={key}
              value={field.value ?? defaults[key] ?? ""}
              onChange={field.onChange}
              disabled={readOnly}
              error={error ? "Error al cargar placeholders" : undefined}
              rows={4}
            />
          )}
        />
      ))}

      {keys.length === 0 && (
        <div className="text-sm text-gray-500">No hay placeholders para mostrar.</div>
      )}
    </div>
  );
}
