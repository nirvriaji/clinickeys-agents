// packages/core/src/application/services/AvailabilityService/AvailabilityStepStrategy/AvailabilityStepStrategy.ts

import { ExtractorFilter } from "@clinickeys-agents/core/application/services/types/Availability";

// =============================
// Tipos públicos (ID-first)
// =============================
export interface BuildStepsInput {
  filter0: ExtractorFilter; // Debe traer *_ids ya resueltos por el extractor
  params: {
    tratamiento: string;
    medico?: string | null;
    espacio?: string | null;
    fechas: string; // texto libre; los rangos vienen en filter0.date_ranges
    horas?: string; // preferencia textual
    rango_dias_extra?: number;
  };
  baseForwardDays: number; // p.ej. 45
}

export interface AvailabilityStep {
  index: number;
  label: string;
  /** IDs de médicos a priorizar en este paso; [] => cualquiera */
  medico_ids: number[];
  /** IDs de espacios a priorizar en este paso; [] => cualquiera */
  espacio_ids: number[];
  /** Horizonte máximo (días hacia delante) que cubre este step */
  forwardExtensionDays: number;
}

export interface ExecuteStepsResult {
  analisis_agenda: any[];
  telemetry: Array<{
    stepIndex: number;
    label: string;
    fechas_consultadas: number;
    resultados: number;
  }>;
}

export type ExecuteStepRunner = (args: {
  step: AvailabilityStep;
  fechasISO: string[]; // YYYY-MM-DD
}) => Promise<{ analisis_agenda: any[] }>; // ventanas/slots crudos del dominio

// =============================
// buildAvailabilitySteps (ID-first, determinista)
// - Un único paso "principal" que usa los IDs ya resueltos por el extractor.
// - El recorte de fechas por forwardExtensionDays lo aplica el runner.
// =============================
export function buildAvailabilitySteps(input: BuildStepsInput): AvailabilityStep[] {
  const { filter0, params, baseForwardDays } = input;

  const extra = Math.max(0, Number(params.rango_dias_extra ?? 0));
  const horizon = Math.max(1, baseForwardDays + extra);

  const medicoIds = Array.isArray((filter0 as any).medico_ids)
    ? ((filter0 as any).medico_ids as number[]).filter((n) => Number.isInteger(n))
    : [];

  const espacioIds = Array.isArray((filter0 as any).espacio_ids)
    ? ((filter0 as any).espacio_ids as number[]).filter((n) => Number.isInteger(n))
    : [];

  const steps: AvailabilityStep[] = [
    {
      index: 0,
      label: "principal",
      medico_ids: medicoIds,
      espacio_ids: espacioIds,
      forwardExtensionDays: horizon,
    },
  ];

  return steps;
}

// =============================
// executeAvailabilitySteps
// - Ejecuta secuencialmente los steps y acumula resultados + telemetría.
// - El runner puede agrupar fechas en bloques y aplicar caché.
// =============================
export async function executeAvailabilitySteps(
  rankedDatesAll: string[],
  steps: AvailabilityStep[],
  runner: ExecuteStepRunner,
): Promise<ExecuteStepsResult> {
  const telemetry: ExecuteStepsResult["telemetry"] = [];
  const allResults: any[] = [];

  for (const step of steps) {
    const fechasISO = Array.isArray(rankedDatesAll) ? rankedDatesAll.slice(0) : [];
    const out = await runner({ step, fechasISO });
    const count = Array.isArray(out?.analisis_agenda) ? out.analisis_agenda.length : 0;
    telemetry.push({
      stepIndex: step.index,
      label: step.label,
      fechas_consultadas: fechasISO.length,
      resultados: count,
    });
    if (count) allResults.push(...out.analisis_agenda);
  }

  return { analisis_agenda: allResults, telemetry };
}