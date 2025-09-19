// packages/frontend/src/app/features/bot-configs/ui/BotConfigFormModal.tsx

"use client";

import { useState, useEffect } from 'react';
import { Modal } from '@/app/shared/ui/Modal';
import { useBotConfigs, BotConfigIdParams } from '@/app/features/bot-configs/model/useBotConfigs';
import { BotConfigFormStepType } from '@/app/features/bot-configs/ui/BotConfigFormStepType';
import { BotConfigFormStepGeneral } from '@/app/features/bot-configs/ui/BotConfigFormStepGeneral';
import { BotConfigFormStepPlaceholders } from '@/app/features/bot-configs/ui/BotConfigFormStepPlaceholders';
import { BotConfigFormStepReview } from '@/app/features/bot-configs/ui/BotConfigFormStepReview';
import type { CreateBotConfigPayload, UpdateBotConfigPayload } from '@/app/features/bot-configs/model/types';
import type { BotConfig, BotConfigType } from '@/app/entities/bot-config/types';
import { useForm, FormProvider } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createBotConfigSchema, updateBotConfigSchema } from '@/app/features/bot-configs/model/formSchemas';
import { toast } from 'sonner';
import { Button } from '@/app/shared/ui/Button';
import { useBotConfigDraftStore } from '@/app/features/bot-configs/model/botConfigDraftStore';

const STEP_TYPE = 0;
const STEP_GENERAL = 1;
const STEP_PLACEHOLDERS = 2;
const STEP_REVIEW = 3;

export interface BotConfigFormModalProps {
  open: boolean;
  onClose: () => void;
  initialData?: BotConfig | null;
}

function getBotConfigIdParams(bot: BotConfig): BotConfigIdParams {
  return {
    botConfigType: bot.botConfigType,
    botConfigId: bot.botConfigId,
    clinicSource: bot.clinicSource,
    clinicId: bot.clinicId,
  };
}

export function BotConfigFormModal({ open, onClose, initialData }: BotConfigFormModalProps) {
  const isEditMode = Boolean(initialData);
  const schema = isEditMode ? updateBotConfigSchema : createBotConfigSchema;
  const [step, setStep] = useState(isEditMode ? STEP_GENERAL : STEP_TYPE);
  const [botType, setBotType] = useState<BotConfigType | undefined>(initialData?.botConfigType);
  const [placeholders, setPlaceholders] = useState<Record<string, string>>(initialData?.placeholders ?? {});
  const [discarded, setDiscarded] = useState(false);

  const { draft, setDraft, clearDraft } = useBotConfigDraftStore();
  const { createBotConfigMutation, updateBotConfigMutation, isCreating, isUpdating } = useBotConfigs();

  const defaultCreateValues: CreateBotConfigPayload = {
    botConfigType: 'chatBot',
    description: '',
    kommoSubdomain: '',
    kommoLongLivedToken: '',
    kommoResponsibleUserId: 0,
    kommoSalesbotId: '',
    defaultCountry: 'ES',
    timezone: 'Europe/Madrid',
    isEnabled: true,
    fieldsProfile: 'default_kommo_profile',
    clinicSource: 'legacy',
    clinicId: 0,
    superClinicId: 0,
    openaiApikey: '',
    assistants: {},
  };

  const initialFormValues = isEditMode
    ? ({
        botConfigType: initialData!.botConfigType,
        description: initialData!.description,
        kommoSubdomain: initialData!.kommo.subdomain,
        kommoLongLivedToken: initialData!.kommo.longLivedToken,
        kommoResponsibleUserId: initialData!.kommo.responsibleUserId,
        kommoSalesbotId: initialData!.kommo.salesbotId,
        defaultCountry: initialData!.defaultCountry,
        timezone: initialData!.timezone,
        isEnabled: initialData!.isEnabled,
        clinicSource: 'legacy',
        fieldsProfile: 'default_kommo_profile',
        clinicId: initialData!.clinicId,
        superClinicId: initialData!.superClinicId,
        openaiApikey: initialData!.openai?.apiKey ?? '',
        assistants: initialData!.openai?.assistants ?? {},
      } satisfies UpdateBotConfigPayload)
    : (draft ?? defaultCreateValues);

  const resolver: Resolver<any> = isEditMode
    ? (zodResolver(updateBotConfigSchema) as unknown as Resolver<any>)
    : (zodResolver(createBotConfigSchema) as unknown as Resolver<any>);

  const methods = useForm<any>({
    resolver,
    defaultValues: initialFormValues,
    mode: 'onChange',
  });

  useEffect(() => {
    methods.reset(initialFormValues);
    setBotType(initialFormValues.botConfigType);
    if (initialFormValues.botConfigType) {
      methods.setValue('botConfigType', initialFormValues.botConfigType, { shouldValidate: false });
    }
  }, [initialData, draft]);

  useEffect(() => {
    if (botType) {
      methods.setValue('botConfigType', botType, { shouldValidate: true });
      if (!isEditMode) setDiscarded(false);
    }
  }, [botType]);

  const goNext = () => {
    if (step === STEP_GENERAL && (isEditMode || botType !== 'chatBot')) {
      setStep(STEP_REVIEW);
    } else {
      setStep((s) => s + 1);
    }
  };

  const prevStep = () => {
    if (isEditMode && step === STEP_REVIEW) {
      setStep(STEP_GENERAL);
    } else {
      setStep((s) => s - 1);
    }
  };

  const handleClose = () => {
    if (!isEditMode && !discarded) {
      setDraft({ ...methods.getValues(), placeholders });
    }
    setStep(isEditMode ? STEP_GENERAL : STEP_TYPE);
    setBotType(initialData?.botConfigType);
    setPlaceholders(initialData?.placeholders ?? {});
    methods.reset(initialFormValues);
    if (initialFormValues.botConfigType) {
      methods.setValue('botConfigType', initialFormValues.botConfigType, { shouldValidate: false });
    }
    onClose();
  };

  const handleClearDraftClick = () => {
    clearDraft();
    setDiscarded(true);
    methods.reset(defaultCreateValues);
    setPlaceholders({});
    setStep(STEP_TYPE);
    setBotType(undefined);
  };

  const handleSubmit = (data: any) => {
    if (!data.botConfigType && !isEditMode) {
      toast.error('Debes seleccionar el tipo de bot');
      setStep(STEP_TYPE);
      return;
    }
    const payload: CreateBotConfigPayload | UpdateBotConfigPayload = {
      ...data,
      placeholders: data.botConfigType === 'chatBot' ? placeholders : undefined,
    };
    if (isEditMode && initialData) {
      updateBotConfigMutation.mutate(
        { params: getBotConfigIdParams(initialData), payload: payload as UpdateBotConfigPayload },
        {
          onSuccess: () => {
            toast.success('Bot actualizado correctamente');
            handleClose();
          },
          onError: (err: any) => toast.error(err?.message || 'Error al actualizar bot'),
        }
      );
    } else {
      createBotConfigMutation.mutate(payload as CreateBotConfigPayload, {
        onSuccess: () => {
          toast.success('Bot creado correctamente');
          clearDraft();
          handleClose();
        },
        onError: (err: any) => toast.error(err?.message || 'Error al crear bot'),
      });
    }
  };

  let content: React.ReactNode;
  if (step === STEP_TYPE) {
    content = (
      <BotConfigFormStepType
        value={botType}
        onChange={(type) => {
          setBotType(type);
          methods.setValue('botConfigType', type, { shouldValidate: true, shouldDirty: true });
          goNext();
        }}
      />
    );
  } else if (step === STEP_GENERAL) {
    content = (
      <>
        {!isEditMode && draft && !discarded && (
          <div className="mb-4 flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={handleClearDraftClick}>
              Descartar borrador
            </Button>
          </div>
        )}
        <BotConfigFormStepGeneral
          methods={methods}
          botType={botType}
          isEditMode={isEditMode}
          setPlaceholders={setPlaceholders}
        />
      </>
    );
  } else if (step === STEP_PLACEHOLDERS && botType === 'chatBot' && !isEditMode) {
    content = (
      <BotConfigFormStepPlaceholders
        placeholders={placeholders}
        setPlaceholders={setPlaceholders}
        isEditMode={isEditMode}
      />
    );
  } else {
    content = (
      <BotConfigFormStepReview
        methods={methods}
        botType={botType}
        placeholders={placeholders}
        isEditMode={isEditMode}
      />
    );
  }

  const title = isEditMode
    ? `Editar Configuración: ${botType} - ${initialFormValues.kommoSubdomain}`
    : `Crear Bot`;

  let footer: React.ReactNode = null;
  if (step !== STEP_TYPE) {
    const isLast = step === STEP_REVIEW;
    const rightBtn = isLast ? (
      <Button
        type="button"
        variant="primary"
        disabled={isCreating || isUpdating}
        onClick={() => methods.handleSubmit(handleSubmit)()}
      >
        {isEditMode ? 'Guardar' : 'Crear'}
      </Button>
    ) : (
      <Button
        type="button"
        variant="primary"
        disabled={isCreating || isUpdating}
        onClick={() => {
          methods.trigger().then((valid) => valid && goNext());
        }}
      >
        Siguiente
      </Button>
    );

    footer = (
      <div className="flex justify-end gap-2">
        {((step > STEP_TYPE && !isEditMode) || (step === STEP_REVIEW && isEditMode)) && (
          <Button type="button" variant="secondary" onClick={prevStep} disabled={isCreating || isUpdating}>
            Atrás
          </Button>
        )}
        {rightBtn}
      </div>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title={title} width="42rem" footer={footer}>
      <FormProvider {...methods}>{content}</FormProvider>
      {isEditMode && step === STEP_GENERAL && initialData?.kommoLeadsCustomFields?.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-base font-bold text-gray-700">Campos requeridos en Kommo:</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {initialData!.kommoLeadsCustomFields.map((field: any, idx: any) => (
              <div
                key={`${field.field_name}${idx}`}
                className={`rounded-lg px-3 py-2 border text-sm flex flex-col shadow-sm ${
                  field.exists && field.field_type === 'textarea'
                    ? 'bg-green-50 border-green-400 text-green-900'
                    : 'bg-red-50 border-red-400 text-red-900'
                }`}
              >
                <div className="font-semibold mb-1">{field.field_name}</div>
                <div>
                  {field.exists && field.field_type === 'textarea' && <span>✔️ Campo creado y de tipo texto largo</span>}
                  {!field.exists && <span>❌ Debe crearse el custom field tipo <strong>texto largo</strong></span>}
                  {field.exists && field.field_type !== 'textarea' && (
                    <span>
                      ❌ El tipo debe ser texto largo (actual: {field.field_type || '—'})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
