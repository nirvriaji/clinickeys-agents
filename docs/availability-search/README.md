# Búsqueda y Ranking de Disponibilidades — Problema y Objetivo

## Resumen ejecutivo

* **Qué ocurre hoy:** el sistema a veces interpreta mal consultas como “el viernes por la tarde” y genera un **ranking de fechas incorrecto**; además, **no reevalúa** al cambiar a consultas como “algún viernes”, manteniendo resultados **obsoletos**.
* **Qué necesitamos:** un **generador de ranking de fechas robusto y recalculable**, sensible al **tiempo transcurrido** y a la **redacción natural** del usuario, que:
  1. **Recalcule** cuando cambie la intención o pase el tiempo;
  2. Sea **consistente** con las fechas efectivamente consultadas;
  3. Distinga que lo que ve el **asistente principal** (subconjunto presentado) **no es** todo el universo consultado.

## Contexto y términos

* **Ranking de fechas:** orden candidato de días a consultar contra el dominio, derivado de la intención del usuario y del “hoy” de la clínica (TZ local).
* **Fechas consultadas:** conjunto real de días contra los que sí se consultó disponibilidad.
* **Fechas presentadas:** subconjunto que ve el asistente principal/redactor (no es el universo completo).
* **Query context (`query_context`):** objeto que viaja con la respuesta y que declara:
  * `fechas_rankeadas` (ordenadas),
  * `consultas_ejecutadas` (rangos/fechas realmente consultadas),
  * `fechas_entregadas_al_asistente` (las que se enviaron para redacción),
  * `criterios` (reglas/heurísticas aplicadas),
  * `caducidad` (pistas para invalidación temporal).

> Nota: Este README **solo** define el problema y la meta. La implementación y los cambios de contratos de asistentes se abordan en PRs separados.

## Problemas detectados (casos reales)

1. **Ambigüedad de lenguaje y ranking incorrecto**
   * Input usuario: “el viernes por la tarde”.
   * Resultado actual: ranking trata “viernes” como fecha fija o lo mezcla con fechas adyacentes sin priorizar viernes próximos, generando orden pobre.
2. **Cambio de intención sin recalcular**
   * Usuario corrige: “algún viernes”.
   * Resultado actual: el sistema reutiliza el ranking anterior, **asumiendo** que no habrá cambios → no busca más.
3. **Obsolescencia por tiempo transcurrido**
   * Pasa el tiempo (minutos/horas) entre pasos.
   * Resultado actual: se conservan resultados previos; **no se invalida** ni refresca el ranking.
4. **Confusión de cobertura**
   * El asistente principal recibe **un subconjunto** (fechas presentadas) y puede asumir que refleja **todo** lo consultado → decisiones equivocadas.
5. **Expresiones compuestas en español**
   * Ejemplos: “puedo desde tal fecha”, “puedo el Y o el Z”, “este jueves y luego a partir del 25”.
   * Resultado actual: el ranking y la segmentación no siempre representan fielmente alternancias (OR), uniones y sucesiones.

## Objetivo (qué queremos lograr)

* Un **motor de ranking de fechas** que:
  * Interprete correctamente **referencias naturales** (días de semana, “próximo”, “a partir de…”, “entre … y …”, listas “X o Y o Z”, combinaciones).
  * **Genere y ordene** un conjunto de fechas **estable pero recalculable**.
  * Sea **sensible al tiempo**: invalide o refresque resultados ante **cambios de redacción** o **paso del tiempo**.
  * Mantenga **trazabilidad** entre: fechas rankeadas, fechas consultadas y fechas presentadas.
  * Permita que el asistente principal **entienda** que la presentación es un **subconjunto**, no el universo.

## Principios de diseño

* **Recalcular cuando cambie la intención**: si cambia la semántica (p. ej., “el viernes” → “algún viernes”), **descartar ranking previo**.
* **Evitar caché pegajoso**: cualquier ranking se considera **caducable** (p. ej., TTL minutos) y dependiente de la redacción exacta.
* **Separar universos**:
  * `fechas_rankeadas` (plan teórico),
  * `consultas_ejecutadas` (lo que sí fuimos a buscar),
  * `fechas_entregadas_al_asistente` (lo que recibe el redactor).
* **Determinismo con sensibilidad temporal**: orden base por cercanía a “hoy” y a preferencias (mañana/tarde/noche/HH:mm), con desempates estables.
* **Expresividad del español**: soportar listas, rangos combinados y sucesiones (“desde X”, “el Y o el Z”, “a partir del 25”).

## Requisitos funcionales

1. **Interpretación de lenguaje natural (fechas)**
   * Días de semana (“el viernes”, “algún viernes”), “próximo”, “este”.
   * Rango absoluto (“entre 2025-11-03 y 2025-11-15”) y relativo (“la próxima semana”).
   * Uniones/alternancias: “el 12 o el 15”, “jueves o viernes por la tarde”.
   * Secuencias: “este jueves y luego a partir del 25”.
2. **Generación de ranking**
   * Construir una lista **ordenada** de fechas candidatas según intención + “hoy”.
   * Posibilidad de **extender** el horizonte si no se encuentran resultados iniciales.
3. **Invalidación temporal**
   * Definir reglas (p. ej., **TTL** en minutos) y claves de **cache-busting** por firma de intención.
4. **Telemetría/observabilidad mínima**
   * Registrar firma de intención, horizonte, tamaño del ranking, fechas efectivamente consultadas, tiempo de respuesta, y razones de invalidación.
5. **Trazabilidad para asistentes**
   * Entregar un **`query_context`** que haga explícito:
     * `fechas_rankeadas` (orden),
     * `consultas_ejecutadas` (rangos/fechas),
     * `fechas_entregadas_al_asistente`,
     * `criterios` (p. ej., “prioridad viernes próximos, luego resto ascendente”),
     * `caducidad` (TTL/epoch).

## Requisitos no funcionales

* **Determinismo** con inputs idénticos (misma TZ).
* **Performance**: ranking en < 10 ms sobre entradas típicas; construcción de rangos lineal.
* **Compatibilidad con TZ** de la clínica (no asumir UTC).
* **Auditable**: todo ranking debe poder explicarse por reglas/criterios.

## Criterios de aceptación (BDD abreviado)

* **Dado** “el viernes por la tarde” **cuando** se genera ranking **entonces** las primeras fechas deben ser los **viernes más próximos** dentro de la ventana y marcadas como “tarde”.
* **Dado** que el usuario corrige a “algún viernes” **cuando** se vuelve a evaluar **entonces** el ranking debe **recalcularse** y no reutilizar el previo.
* **Dado** que han pasado N minutos desde el último ranking **cuando** se intenta reutilizar **entonces** debe **invalidarse** y reconstruirse.
* **Dado** un conjunto de `fechas_entregadas_al_asistente` **cuando** el redactor muestra horarios **entonces** nadie debe asumir que representa **todas** las fechas consultadas.
* **Dado** una combinación “este jueves y luego a partir del 25” **cuando** se construye ranking **entonces** debe **contener** el jueves más próximo y a continuación las fechas ≥ 25 ordenadas.

## Casos de prueba (tabla rápida)

| Caso | Input natural                         | Esperado (en resumen)                                                |
| ---- | ------------------------------------- | -------------------------------------------------------------------- |
| 1    | “el viernes por la tarde”             | Ranking: viernes cercanos primero; “tarde” como preferencia de hora. |
| 2    | “algún viernes” tras caso 1           | Recalcular; no reusar ranking previo.                                |
| 3    | “entre 10 y 14 de nov, mañana”        | Rango 2025-11-10..14 priorizando mañana.                             |
| 4    | “el 12 o el 15”                       | Ranking con 12 y 15 como anclas, luego cercanos.                     |
| 5    | “este jueves y luego a partir del 25” | Jueves próximo → luego ≥25 ascendente.                               |
| 6    | Pasan 20 min sin reservar             | Invalidate + rebuild al siguiente intento.                           |

## Métricas y telemetría sugeridas

* `ranking.ttl_ms`, `ranking.reused:boolean`, `ranking.reason:string`
* `ranking.size`, `ranking.horizon_days`
* `consulted.days_count`, `assistant.delivered_days_count`
* `latency.ms` por bloque/step

## Riesgos conocidos y mitigaciones

* **Ambigüedad extrema** (“cualquier día”): generar ranking amplio + límites; pedir precisión si topes se exceden.
* **Saltos de TZ**: siempre usar TZ de clínica para “hoy”, “mañana”, “próximo viernes”.
* **Caché incorrecta**: clave de cache incluye **firma semántica** de intención y **epoch**.

## Siguientes pasos (no implementes aquí)

* Definir contrato de `query_context` definitivo y puntos de integración.
* Añadir unit tests del parser de intención y del generador de ranking.
* Incorporar invalidación por **epoch** y **TTL** a la capa de caché.

