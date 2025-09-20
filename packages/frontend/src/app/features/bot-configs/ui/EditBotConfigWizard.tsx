"use client";

import { useState, useEffect, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Modal } from "@/app/shared/ui/Modal";
import { Button } from "@/app/shared/ui/Button";
import { useBotConfigs, BotConfigIdParams } from "@/app/features/bot-configs/model/useBotConfigs";
import { editSchema } from "@/app/features/bot-configs/model/formSchemasNew";
import { toEditDefaults, toEditPayload } from "@/app/features/bot-configs/model/formAdapters";
import { canEditEdit } from "@/app/features/bot-configs/model/fieldPolicy";

import { StepGeneral } from "./steps/StepGeneral";
import { StepPlaceholders } from "./steps/StepPlaceholders";
import { StepReview } from "./steps/StepReview";

import type { BotConfig, BotConfigType } from "@/app/entities/bot-config/types";

const STEP_GENERAL = 0;
const STEP_PLACEHOLDERS = 1;
const STEP_REVIEW = 2;

export interface EditBotConfigWizardProps {
  open: boolean;
  onClose: () => void;
  initialData: BotConfig;
}

function getBotConfigIdParams(bot: BotConfig): BotConfigIdParams {
  return {
    botConfigType: bot.botConfigType,
    botConfigId: bot.botConfigId,
    clinicSource: bot.clinicSource,
    clinicId: bot.clinicId,
  };
}

export function EditBotConfigWizard({ open, onClose, initialData }: EditBotConfigWizardProps) {
  const [step, setStep] = useState(STEP_GENERAL);
  const [botType, setBotType] = useState<BotConfigType | undefined>(initialData?.botConfigType);

  const { updateBotConfigMutation, isUpdating } = useBotConfigs();

  const initialFormValues = useMemo(() => toEditDefaults(initialData), [initialData]);

  const methods = useForm<any>({
    resolver: zodResolver(editSchema),
    defaultValues: initialFormValues,
    mode: "onChange",
  });

  useEffect(() => {
    // Asegura que placeholders se cargan desde DB y queden presentes en el form state
    methods.reset({
      ...initialFormValues,
      placeholders: initialFormValues.placeholders || {},
    });
    setBotType(initialFormValues.botConfigType);
  }, [initialData, initialFormValues, methods]);

  const handleClose = () => {
    setStep(STEP_GENERAL);
    setBotType(initialData?.botConfigType);
    methods.reset(initialFormValues);
    onClose();
  };

  const handleSubmit = (data: any) => {
    const payload = toEditPayload(data, initialData);
    updateBotConfigMutation.mutate(
      { params: getBotConfigIdParams(initialData), payload },
      {
        onSuccess: () => {
          toast.success("Bot actualizado correctamente");
          handleClose();
        },
        onError: (err: any) => toast.error(err?.message || "Error al actualizar bot"),
      }
    );
  };

  let content: React.ReactNode;
  if (step === STEP_GENERAL) {
    content = (
      <StepGeneral
        methods={methods}
        botType={botType}
        isEditable={(field) => canEditEdit({ botType })[field]}
      />
    );
  } else if (step === STEP_PLACEHOLDERS && botType === "chatBot") {
    content = <StepPlaceholders methods={methods} readOnly={false} />;
  } else {
    content = <StepReview methods={methods} botType={botType} readOnly={true} />;
  }

  const title = `Editar Configuración: ${botType} - ${initialFormValues.kommoSubdomain}`;

  let footer: React.ReactNode = null;
  if (step >= STEP_GENERAL) {
    const isLast = step === STEP_REVIEW;
    const rightBtn = isLast ? (
      <Button
        type="button"
        variant="primary"
        disabled={isUpdating}
        onClick={() => methods.handleSubmit(handleSubmit)()}
      >
        Guardar
      </Button>
    ) : (
      <Button
        type="button"
        variant="primary"
        disabled={isUpdating}
        onClick={() => {
          methods.trigger().then((valid) => valid && setStep((s) => s + 1));
        }}
      >
        Siguiente
      </Button>
    );

    footer = (
      <div className="flex justify-end gap-2">
        {step > STEP_GENERAL && (
          <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={isUpdating}>
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
      {step === STEP_GENERAL && initialData?.kommoLeadsCustomFields?.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-base font-bold text-gray-700">Campos requeridos en Kommo:</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {initialData.kommoLeadsCustomFields.map((field: any, idx: any) => (
              <div
                key={`${field.field_name}${idx}`}
                className={`rounded-lg px-3 py-2 border text-sm flex flex-col shadow-sm ${
                  field.exists && field.field_type === "textarea"
                    ? "bg-green-50 border-green-400 text-green-900"
                    : "bg-red-50 border-red-400 text-red-900"
                }`}
              >
                <div className="font-semibold mb-1">{field.field_name}</div>
                <div>
                  {field.exists && field.field_type === "textarea" && <span>✔️ Campo creado y de tipo texto largo</span>}
                  {!field.exists && <span>❌ Debe crearse el custom field tipo <strong>texto largo</strong></span>}
                  {field.exists && field.field_type !== "textarea" && (
                    <span>
                      ❌ El tipo debe ser texto largo (actual: {field.field_type || "—"})
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
