export interface QueryContext {
  /** Fechas ordenadas por el ranking teórico (YYYY-MM-DD). */
  fechas_rankeadas: string[];
  /** Rangos o fechas efectivamente consultadas contra dominio. */
  consultas_ejecutadas: Array<{ start: string; end: string }>;
  /** Fechas que se entregaron al asistente redactor/presentador. */
  fechas_entregadas_al_asistente: string[];
  /** Criterios aplicados para el ranking/orden. */
  criterios: {
    base?: string;
    preferencias_horarias?: string | string[];
    interpretacion_maximo?: "ultimo_inicio" | "fin_dentro_del_rango";
  };
  /** Política de caducidad e info temporal. */
  caducidad: {
    ttl_ms: number;
    generated_at_iso: string;
    timezone: string;
  };
  /** Métricas de cobertura. */
  coverage: {
    dates_consulted_count: number;
    dates_with_results_count: number;
    selected_days_count: number;
  };
  /** Anclas útiles (opcional). */
  anchors?: {
    today_iso?: string;
  };
}
