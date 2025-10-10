import React from "react";
import { Controller, type UseFormReturn, type FieldError } from "react-hook-form";
import { TextInput } from "@/app/shared/ui/TextInput";
import { TextArea } from "@/app/shared/ui/TextArea";
import { ClinicSelector } from "@/app/features/bot-configs/ui/ClinicSelector";
import { CountrySelect } from "@/app/shared/ui/CountrySelect";
import { Select } from "@/app/shared/ui/Select";
import { timezoneOptions } from "@/app/shared/lib/timezoneOptions";
import { KommoUserSelector } from "@/app/features/bot-configs/ui/KommoUserSelector";
import type { BotConfigType } from "@/app/entities/bot-config/types";
import type { Field } from "@/app/features/bot-configs/model/fieldPolicy";

interface StepGeneralProps {
  methods: UseFormReturn<any>;
  botType?: BotConfigType;
  isEditable: (field: Field) => boolean;
}

export function StepGeneral({ methods, botType, isEditable }: StepGeneralProps) {
  const {
    control,
    formState: { errors },
    setValue,
    watch,
  } = methods;

  const isChatBot = botType === "chatBot";
  const kommoSubdomain = watch("kommoSubdomain");
  const kommoLongLivedToken = watch("kommoLongLivedToken");
  const isKommoReady = Boolean(kommoSubdomain) && Boolean(kommoLongLivedToken);

  const getErrorMessage = React.useCallback((err: unknown): string | undefined => {
    if (!err) return undefined;
    if (typeof err === "string") return err;
    if (typeof err === "object" && err !== null && "message" in err) {
      return (err as FieldError).message;
    }
    return undefined;
  }, []);

  return (
    <div className="space-y-4">
      <Controller
        name="clinicId"
        control={control}
        render={({ field }) => (
          <ClinicSelector
            name={field.name}
            value={field.value}
            onChange={(val, clinic) => {
              field.onChange(val);
              setValue("superClinicId", clinic?.superClinicId, { shouldValidate: true });
            }}
            label="Clinickeys / Selecciona la clínica que administrará el bot"
            disabled={!isEditable("clinicId")}
            error={getErrorMessage(errors.clinicId)}
          />
        )}
      />

      <Controller
        name="timezone"
        control={control}
        render={({ field }) => (
          <Select
            name={field.name}
            searchable
            label="Clinickeys / Selecciona una zona horaria para la clínica"
            options={timezoneOptions}
            value={field.value}
            onChange={field.onChange}
            error={getErrorMessage(errors.timezone)}
          />
        )}
      />

      <Controller
        name="defaultCountry"
        control={control}
        render={({ field }) => (
          <div>
            <label htmlFor={field.name} className="block mb-1 text-sm font-medium text-gray-700">
              Clinickeys / Código de país por defecto para los telefonos de los pacientes
            </label>
            <CountrySelect value={field.value} onChange={field.onChange} />
            {getErrorMessage(errors.defaultCountry) && (
              <span className="text-xs text-red-500">{getErrorMessage(errors.defaultCountry)}</span>
            )}
          </div>
        )}
      />

      {isChatBot && (
        <Controller
          name="openaiApikey"
          control={control}
          render={({ field }) => (
            <TextInput
              name={field.name}
              label={
                <>
                  OpenAI / Ingresar api key: {' '}
                  (<a
                    className="text-blue-600 underline"
                    href="https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform#h_79e86017fd"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ¿Cómo obtenerla?
                  </a>)
                </>
              }
              value={field.value}
              onChange={field.onChange}
              error={getErrorMessage(errors.openaiApikey)}
              disabled={!isEditable("openaiApikey")}
            />
          )}
        />
      )}

      <Controller
        name="kommoSalesbotId"
        control={control}
        render={({ field }) => (
          <TextInput
            name={field.name}
            label={
              <>
                Kommo / Ingresar salesbot ID de {isChatBot ? <strong>[ BOT100_ChatBot :: Enviar_Respuesta ]</strong> : <strong>[ BOT100_NotificationBot :: Enviar_Recordatorio ]</strong>}{' '}
                (<a
                  className="text-blue-600 underline"
                  href="https://es-developers.kommo.com/reference/lanzar-un-salesbot"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ¿Cómo obtenerlo?
                </a>)
              </>
            }
            value={field.value}
            onChange={field.onChange}
            error={getErrorMessage(errors.kommoSalesbotId)}
            disabled={!isEditable("kommoSalesbotId")}
          />
        )}
      />

      <Controller
        name="kommoLongLivedToken"
        control={control}
        render={({ field }) => (
          <TextInput
            name={field.name}
            label={
              <>
                Kommo / Ingresar token de larga duración{' '}
                (<a
                  className="text-blue-600 underline"
                  href="https://es-developers.kommo.com/docs/token-de-larga-duraci%C3%B3n"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ¿Cómo obtenerlo?
                </a>)
              </>
            }
            value={field.value}
            onChange={field.onChange}
            error={getErrorMessage(errors.kommoLongLivedToken)}
            disabled={!isEditable("kommoLongLivedToken")}
          />
        )}
      />

      <Controller
        name="kommoSubdomain"
        control={control}
        render={({ field }) => (
          <TextInput
            name={field.name}
            label="Kommo / Ingresar subdominio"
            value={field.value}
            onChange={field.onChange}
            error={getErrorMessage(errors.kommoSubdomain)}
            disabled={!isEditable("kommoSubdomain")}
          />
        )}
      />

      <Controller
        name="kommoResponsibleUserId"
        control={control}
        render={({ field }) => (
          <KommoUserSelector
            subdomain={kommoSubdomain}
            token={kommoLongLivedToken}
            value={field.value}
            onChange={(val) => field.onChange(val)}
            label="Kommo / Seleccionar responsable de las tareas"
            disabled={!isKommoReady || !isEditable("kommoResponsibleUserId")}
            error={
              !isKommoReady
                ? "Primero ingresa el subdominio y token de Kommo para seleccionar un usuario."
                : getErrorMessage(errors.kommoResponsibleUserId)
            }
          />
        )}
      />

      <Controller
        name="description"
        control={control}
        render={({ field }) => (
          <TextArea
            name={field.name}
            label="Descripción del bot"
            value={field.value}
            onChange={field.onChange}
            error={getErrorMessage(errors.description)}
            rows={4}
            disabled={!isEditable("description")}
          />
        )}
      />
    </div>
  );
}
