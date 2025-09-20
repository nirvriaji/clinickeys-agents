// packages/frontend/src/app/features/bot-configs/ui/CreateBotConfigWizard.tsx

"use client";

import { useState } from "react";
import { Modal } from "@/app/shared/ui/Modal";
import { useBotConfigs } from "@/app/features/bot-configs/model/useBotConfigs";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/app/shared/ui/Button";
import { StepType } from "@/app/features/bot-configs/ui/steps/StepType";
import { StepGeneral } from "@/app/features/bot-configs/ui/steps/StepGeneral";
import { StepPlaceholders } from "@/app/features/bot-configs/ui/steps/StepPlaceholders";
import { StepReview } from "@/app/features/bot-configs/ui/steps/StepReview";
import { createSchema } from "@/app/features/bot-configs/model/formSchemasNew";
import { toCreateDefaults, toCreatePayload } from "@/app/features/bot-configs/model/formAdapters";
import { canEditCreate, Field } from "@/app/features/bot-configs/model/fieldPolicy";
import type { BotConfigType } from "@/app/entities/bot-config/types";
import { useBotConfigDraftStore } from "@/app/features/bot-configs/model/botConfigDraftStore";

const STEP_TYPE = 0;
const STEP_GENERAL = 1;
const STEP_PLACEHOLDERS = 2;
const STEP_REVIEW = 3;

interface CreateBotConfigWizardProps {
  open: boolean;
  onClose: () => void;
}

export function CreateBotConfigWizard({ open, onClose }: CreateBotConfigWizardProps) {
  const { createBotConfigMutation } = useBotConfigs();
  const { clearDraft } = useBotConfigDraftStore();
  const [step, setStep] = useState(STEP_TYPE);
  const [botType, setBotType] = useState<BotConfigType | undefined>(undefined);

  const methods = useForm<any>({
    resolver: zodResolver(createSchema),
    defaultValues: toCreateDefaults(),
    mode: "onChange",
  });

  const isEditable = (field: Field) => {
    const policy = canEditCreate({ botType });
    return policy[field];
  };

  const goNext = () => setStep((s) => s + 1);
  const prevStep = () => setStep((s) => s - 1);

  const handleSubmit = (values: any) => {
    const payload = toCreatePayload(values);
    createBotConfigMutation.mutate(payload, {
      onSuccess: () => {
        toast.success("Bot creado correctamente");
        clearDraft();
        onClose();
      },
      onError: (err: any) => toast.error(err?.message || "Error al crear bot"),
    });
  };

  let content: React.ReactNode;
  if (step === STEP_TYPE) {
    content = (
      <StepType
        value={botType as any}
        onChange={(type) => {
          setBotType(type);
          methods.setValue("botConfigType", type, { shouldValidate: true, shouldDirty: true });
          goNext();
        }}
      />
    );
  } else if (step === STEP_GENERAL) {
    content = <StepGeneral methods={methods} botType={botType as any} isEditable={isEditable} />;
  } else if (step === STEP_PLACEHOLDERS && botType === "chatBot") {
    content = <StepPlaceholders methods={methods} readOnly={false} />;
  } else {
    content = <StepReview methods={methods} botType={botType as any} readOnly />;
  }

  const footer = (
    <div className="flex justify-end gap-2">
      {step > STEP_TYPE && (
        <Button type="button" variant="secondary" onClick={prevStep}>
          Atrás
        </Button>
      )}
      {step === STEP_REVIEW ? (
        <Button
          type="button"
          variant="primary"
          disabled={createBotConfigMutation.isPending}
          onClick={() => methods.handleSubmit(handleSubmit)()}
        >
          Crear
        </Button>
      ) : (
        <Button
          type="button"
          variant="primary"
          onClick={() => methods.trigger().then((ok) => ok && goNext())}
        >
          Siguiente
        </Button>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Crear Bot" width="42rem" footer={footer}>
      <FormProvider {...methods}>{content}</FormProvider>
    </Modal>
  );
}
