// packages/frontend/src/app/features/bot-configs/ui/BotConfigFormStepPlaceholders.tsx

import { useEffect } from 'react';
import { TextArea } from '@/app/shared/ui/TextArea';
import { usePlaceholders } from '@/app/features/bot-configs/model/usePlaceholders';

interface BotConfigFormStepPlaceholdersProps {
  placeholders: Record<string, string>;
  setPlaceholders: (val: Record<string, string>) => void;
  isEditMode: boolean;
}

export function BotConfigFormStepPlaceholders({
  placeholders,
  setPlaceholders,
  isEditMode,
}: BotConfigFormStepPlaceholdersProps) {
  const { data: defaultPlaceholders, isLoading, error, refetch } = usePlaceholders();

  // Sincronizar placeholders locales con los default al montar (solo en creación)
  useEffect(() => {
    if (!isEditMode && Object.keys(defaultPlaceholders).length > 0) {
      const initial: Record<string, string> = {};
      Object.keys(defaultPlaceholders).forEach((key, index) => {
        initial[key] = defaultPlaceholders[key] || '';
      });
      setPlaceholders(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPlaceholders, isEditMode]);

  // Handler de cambio
  const handleChange = (key: string, value: string) => {
    setPlaceholders({ ...placeholders, [key]: value });
  };

  if (isLoading) {
    return <div className="py-8 text-center text-muted">Cargando placeholders...</div>;
  }
  if (error) {
    return (
      <div className="py-8 text-center text-danger">
        Error al cargar placeholders.
        <button className="ml-2 underline text-blue-600 hover:text-blue-900" type="button" onClick={() => refetch()}>Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold mb-2">Personaliza los Placeholders</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Puedes dejar campos vacíos o personalizarlos según tus necesidades. Estos valores serán usados por el bot para completar mensajes dinámicos.
      </p>
      {Object.keys(defaultPlaceholders).map((key, index) => (
        <TextArea
          key={index}
          label={key}
          value={placeholders[key] || defaultPlaceholders[key] || ''}
          onChange={(val) => handleChange(key, val)}
          disabled={isEditMode}
          error={error ? 'Error al cargar placeholders' : undefined}
          rows={4}
        />
      ))}
    </div>
  );
}
