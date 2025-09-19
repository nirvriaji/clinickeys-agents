// packages/core/src/domain/availability/dtos.ts

import { z } from 'zod';

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
  fecha_cita: string;          // YYYY-MM-DD (compatibilidad con AvailabilityAdjuster)
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

export const ConsultaCitaSchema = z.object({
  filters: z.array(
    z.object({
      tratamientos: z.array(z.string()),
      medicos:     z.array(z.string()),
      espacios:    z.array(z.string()),
      aparatologias: z.array(z.string()),
      especialidades: z.array(z.string()),
      fechas: z.array(
        z.object({
          fecha: z.string().refine(s => /^\d{4}-\d{2}-\d{2}$/.test(s)),
          horas: z.array(z.object({ hora_inicio: z.string(), hora_fin: z.string() }))
        })
      )
    })
  )
});

// =============================
// Schemas
// =============================

const DisponibilidadSchema = z.object({
  hora_inicio_minima: z.string(),
  hora_inicio_maxima: z.string(),
  id_medico: z.number(),
  nombre_medico: z.string(),
  id_espacio: z.number(),
  nombre_espacio: z.string(),
  id_tratamiento: z.number(),
  nombre_tratamiento: z.string(),
  duracion_tratamiento: z.number(),
  especifica: z.boolean(),
  fecha_legible: z.string().nullable().optional(),
  fecha_cita: z.string(),
});

export type Disponibilidad = z.infer<typeof DisponibilidadSchema>;

const FlexibleValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const MetadataSchema = z
  .object({
    tipo_busqueda: z
      .enum(["original", "original_filtrado", "sin_disponibilidad"])
      .nullable()
      .optional(),
    reglas_aplicadas: z.record(FlexibleValue).nullable().optional(),
    warnings: z.array(z.string()).nullable().optional(),
    sugerencias: z.array(z.string()).nullable().optional(),
    conteos: z
      .object({
        total_original: z.number(),
        total_filtrado: z.number(),
        dias_presentados: z.number(),
      })
      .nullable()
      .optional(),
    primer_hueco: z
      .object({
        fecha: z.string(),
        hora: z.string(),
      })
      .nullable()
      .optional(),
    criterios: z.record(FlexibleValue).nullable().optional(),
    extras: z.record(FlexibleValue).nullable().optional(),
  })
  .strict()
  .nullable()
  .optional();

export const PresentacionYDisponibilidadesSchema = z.object({
  presentacion: z.string(),
  disponibilidades: z.array(DisponibilidadSchema),
  disclaimer_fechas: z.string().nullable().optional(),
  dias_mostrados: z.array(z.string()).nullable().optional(),
  criterio_orden: z.string().nullable().optional(),
  metadata: MetadataSchema,
});

export type PresentacionYDisponibilidades = z.infer<
  typeof PresentacionYDisponibilidadesSchema
>;
