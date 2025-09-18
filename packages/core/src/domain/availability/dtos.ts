// packages/core/src/domain/availability/dtos.ts

/**
 * Representa un espacio físico (cabina, sala) en el que se atienden pacientes.
 */
export interface EspacioEntrada {
  id_espacio: number;
  nombre_espacio: string;
}

/**
 * Representa a un médico con sus espacios asociados.
 */
export interface MedicoEntrada {
  id_medico: number;
  nombre_medico: string;
  espacios: EspacioEntrada[];
}

/**
 * Representa un tratamiento disponible en la clínica, con médicos vinculados.
 */
export interface TratamientoEntrada {
  tratamiento: {
    id_tratamiento: number;
    nombre_tratamiento: string;
    duracion_tratamiento: number; // minutos
  };
  medicos: MedicoEntrada[];
}

/**
 * Fila de programación general de un médico (rango de fechas + horarios).
 */
export interface ProgramacionMedicoRow {
  id_medico: number;
  fecha_inicio: string; // YYYY-MM-DD (dateStrings: true)
  fecha_fin: string;    // YYYY-MM-DD (dateStrings: true)
  hora_inicio: string;  // HH:mm:ss
  hora_fin: string;     // HH:mm:ss
}

/**
 * Fila de programación general de un espacio.
 */
export interface ProgramacionEspacioRow {
  id_espacio: number;
  fecha_inicio: string;
  fecha_fin: string;
  hora_inicio: string;
  hora_fin: string;
}

/**
 * Fila de programación específica médico-espacio.
 */
export interface ProgramacionMedicoEspacioRow {
  id_medico: number;
  id_espacio: number;
  fecha_inicio: string;
  fecha_fin: string;
  hora_inicio: string;
  hora_fin: string;
}

/**
 * Representa una cita ya programada que bloquea disponibilidad.
 */
export interface CitaProgramadaRow {
  id_medico: number;
  id_espacio: number;
  fecha_cita: string; // YYYY-MM-DD
  hora_inicio: string;
  hora_fin: string;
}

/**
 * Origen de una ventana de disponibilidad: general o específica.
 */
export type OrigenVentana = "general" | "especifica";

/**
 * Ventana base (antes de transformar a slots).
 */
export interface VentanaBase {
  fecha_cita: string; // YYYY-MM-DD
  id_medico: number;
  nombre_medico: string;
  id_espacio: number;
  nombre_espacio: string;
  id_tratamiento: number;
  nombre_tratamiento: string;
  duracion_tratamiento: number;
}

/**
 * Ventana con rango en minutos y origen.
 */
export interface Ventana extends VentanaBase {
  startMin: number;
  endMin: number;
  origen: OrigenVentana;
}

/**
 * Slot final de disponibilidad que se expone a otras capas.
 */
export interface SlotDisponibilidad {
  fecha_cita: string;          // YYYY-MM-DD (compatibilidad con ajustarDisponibilidad)
  hora_inicio_minima: string;    // HH:mm:ss
  hora_inicio_maxima: string;    // HH:mm:ss
  id_medico: number;
  nombre_medico: string;
  id_espacio: number;
  nombre_espacio: string;
  id_tratamiento: number;
  nombre_tratamiento: string;
  duracion_tratamiento: number;  // minutos
  especifica: boolean;           // true si proviene de ventana específica
  fecha_legible?: string | null;        // p.ej. "Lunes, 16 de septiembre"
}