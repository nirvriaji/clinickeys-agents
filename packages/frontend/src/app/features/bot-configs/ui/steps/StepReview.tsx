"use client";

import { TextInput } from "@/app/shared/ui/TextInput";
import type { UseFormReturn } from "react-hook-form";
import type { BotConfigType } from "@/app/entities/bot-config/types";

interface StepReviewProps {
  methods: UseFormReturn<any>;
  botType?: BotConfigType;
  readOnly?: boolean;
}

export function StepReview({ methods, botType, readOnly = true }: StepReviewProps) {
  const values = methods.watch();
  const placeholders: Record<string, string> = methods.watch("placeholders") || {};

  const safe = (val: unknown): string =>
    val !== null && val !== undefined ? String(val) : "";

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold mb-2">Revisa tu configuración</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextInput label="Descripción" value={safe(values.description)} disabled />
        <TextInput label="Subdominio Kommo" value={safe(values.kommoSubdomain)} disabled />
        <TextInput
          label="Token de larga duración de Kommo"
          value={safe(values.kommoLongLivedToken)}
          disabled
        />
        <TextInput
          label="Kommo Responsible User ID"
          value={safe(values.kommoResponsibleUserId)}
          disabled
        />
        <TextInput label="Kommo Salesbot ID" value={safe(values.kommoSalesbotId)} disabled />
        <TextInput label="Clínica ID" value={safe(values.clinicId)} disabled />
        <TextInput label="Super Clínica ID" value={safe(values.superClinicId)} disabled />
        <TextInput label="País por defecto" value={safe(values.defaultCountry)} disabled />
        <TextInput label="Zona horaria" value={safe(values.timezone)} disabled />
        <TextInput label="fieldsProfile" value="default_kommo_profile" disabled />
        <TextInput label="clinicSource" value="legacy" disabled />
        {botType === "chatBot" && (
          <TextInput label="OpenAI Apikey" value={safe(values.openaiApikey)} disabled />
        )}
      </div>

      {botType === "chatBot" && Object.keys(placeholders).length > 0 && (
        <div>
          <h3 className="text-md font-semibold mt-4 mb-2">Placeholders</h3>
          <div className="grid grid-cols-1 gap-2">
            {Object.entries(placeholders).map(([key, value]) => (
              <TextInput key={key} label={key} value={safe(value)} disabled={readOnly} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
