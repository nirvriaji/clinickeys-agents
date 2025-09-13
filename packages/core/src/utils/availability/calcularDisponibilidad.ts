// packages/core/src/utils/availability/calcularDisponibilidad.ts

/**
 * Refactor: disponibilidad unificada
 * Construye ventanas (general + específica) → combina → resta citas/bloqueos una sola vez → genera slots.
 * Mantiene la firma pública original para retrocompatibilidad.
 */

import {
  calcularDisponibilidadUnificada,
  TratamientoEntrada,
  ProgramacionMedicoRow,
  ProgramacionEspacioRow,
  ProgramacionMedicoEspacioRow,
  CitaProgramadaRow,
  SlotDisponibilidad,
} from './availabilityUnified';

export function calcularDisponibilidad(entrada: {
  tratamientos: any[];
  citas_programadas: any[];
  prog_medicos: any[];
  prog_espacios: any[];
  prog_medico_espacio: any[];
}): any[] {
  const tratamientos = (entrada.tratamientos || []) as TratamientoEntrada[];
  const citas_programadas = (entrada.citas_programadas || []) as CitaProgramadaRow[];
  const prog_medicos = (entrada.prog_medicos || []) as ProgramacionMedicoRow[];
  const prog_espacios = (entrada.prog_espacios || []) as ProgramacionEspacioRow[];
  const prog_medico_espacio = (entrada.prog_medico_espacio || []) as ProgramacionMedicoEspacioRow[];

  const slots: SlotDisponibilidad[] = calcularDisponibilidadUnificada({
    tratamientos,
    citas_programadas,
    prog_medicos,
    prog_espacios,
    prog_medico_espacio,
  });

  // Se devuelve como any[] para mantener compatibilidad con el llamador actual
  return slots as any[];
}

export default calcularDisponibilidad;