// packages/core/src/domain/bono/dtos.ts

export interface BonoDTO {
  id_bono_paciente: number;
  id_clinica: number;
  nombre: string;
  descripcion: string;
  precio: number;
}

export interface BonoConUsoDTO extends BonoDTO {
  total_sesiones: number;
  total_sesiones_utilizadas: number;
  tratamientos: {
    id_tratamiento: number;
    item_bono_paciente: number;
    total_sesiones: number;
    sesiones_usadas: number;
  }[];
}

export interface BonoSesionDetalleDTO {
  id_bono_paciente: number;
  id_paciente: number;
  nombre_bono: string;
  sesiones_total: number;
  sesiones_usado: number;
  sesiones_pendiente: number;
  monto_total: number;
  monto_pagado: number;
  saldo_pendiente: number;
  id_detalle_bono_paciente: number;
  id_tratamiento: number | null;
  item: number;
  descripcion: string | null;
  cantidad: number;
  precio: number;
  total_item: number;
}
