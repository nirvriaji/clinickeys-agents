// packages/core/src/domain/presupuesto/dtos.ts

export interface PresupuestoDTO {
  id_presupuesto: number;
  fecha: string; // ISO date string (YYYY-MM-DD)
  monto_total: number;
  monto_pagado: number;
  saldo_pendiente: number;
  id_tipo_pago: number;
  nombre_tipo_pago: string;
  nombre_estado: string;
}
