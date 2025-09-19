// packages/frontend/src/app/features/bot-configs/ui/BotConfigFormStepReview.tsx

import { TextInput } from '@/app/shared/ui/TextInput';
import { AssistantsList } from '@/app/shared/ui/AssistantsList';
import type { UseFormReturn } from 'react-hook-form';
import type { BotConfigType } from '@/app/entities/bot-config/types';

interface BotConfigFormStepReviewProps {
  methods: UseFormReturn<any>;
  botType?: BotConfigType;
  placeholders: Record<string, string>;
  isEditMode: boolean;
}

export function BotConfigFormStepReview({
  methods,
  botType,
  placeholders,
  isEditMode,
}: BotConfigFormStepReviewProps) {
  const { getValues } = methods;
  const values = getValues();
  const assistants = values.assistants as Record<string, string>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold mb-2">Revisa tu configuración</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextInput label="Descripción" value={values.description} disabled />
        <TextInput label="Subdominio Kommo" value={values.kommoSubdomain} disabled />
        <TextInput label="Token de larga duración de Kommo" value={values.kommoLongLivedToken} disabled />
        <TextInput label="Kommo Responsible User ID" value={values.kommoResponsibleUserId} disabled />
        <TextInput label="Kommo Salesbot ID" value={values.kommoSalesbotId} disabled />
        <TextInput label="Clínica ID" value={values.clinicId} disabled />
        <TextInput label="Super Clínica ID" value={values.superClinicId} disabled />
        <TextInput label="País por defecto" value={values.defaultCountry} disabled />
        <TextInput label="Zona horaria" value={values.timezone} disabled />
        <TextInput label="fieldsProfile" value="default_kommo_profile" disabled />
        <TextInput label="clinicSource" value="legacy" disabled />
        {botType === 'chatBot' && (
          <TextInput label="OpenAI Apikey" value={values.openaiApikey} disabled />
        )}
      </div>

      {botType === 'chatBot' && (
        <div>
          <h3 className="text-md font-semibold mt-4 mb-2">Placeholders</h3>
          <div className="grid grid-cols-1 gap-2">
            {Object.entries(placeholders).map(([key, value]) => (
              <TextInput key={key} label={key} value={value} disabled />
            ))}
          </div>
        </div>
      )}

      {isEditMode && botType === 'chatBot' && assistants && Object.keys(assistants).length > 0 && (
        <div>
          <h3 className="text-md font-semibold mt-4 mb-2">Asistentes</h3>
          <AssistantsList assistants={assistants} />
        </div>
      )}
    </div>
  );
}
