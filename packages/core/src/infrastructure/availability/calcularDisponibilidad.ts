import { calcularDisponibilidadUnificada } from "./availabilityUnified";

import {
  SlotDisponibilidad,
  TratamientoEntrada,
  ProgramacionMedicoRow,
  ProgramacionEspacioRow,
  ProgramacionMedicoEspacioRow,
  CitaProgramadaRow,
} from "@clinickeys-agents/core/domain/availability";

export interface CalcularDisponibilidadInput {
  tratamientos: TratamientoEntrada[];
  citas_programadas: CitaProgramadaRow[];
  prog_medicos: ProgramacionMedicoRow[];
  prog_espacios: ProgramacionEspacioRow[];
  prog_medico_espacio: ProgramacionMedicoEspacioRow[];
}

export function calcularDisponibilidad(
  entrada: CalcularDisponibilidadInput
): SlotDisponibilidad[] {
  const tratamientos = entrada.tratamientos ?? [];
  const citas_programadas = entrada.citas_programadas ?? [];
  const prog_medicos = entrada.prog_medicos ?? [];
  const prog_espacios = entrada.prog_espacios ?? [];
  const prog_medico_espacio = entrada.prog_medico_espacio ?? [];

  const slots: SlotDisponibilidad[] = calcularDisponibilidadUnificada({
    tratamientos,
    citas_programadas,
    prog_medicos,
    prog_espacios,
    prog_medico_espacio,
  });

  return slots;
}

export default calcularDisponibilidad;
