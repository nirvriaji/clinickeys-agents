# Flujo checkAvailability: de mensaje a horarios (ID-first)

## Visión general
- Kommo dispara un webhook que se recibe como Lambda y se normaliza antes de entrar al dominio.
- El primer tramo solo construye un mensaje FIFO y delega la conversación al procesador asíncrono.
- `LeadProcessorController` reconstruye dependencias (botConfig, repos, servicios) para cada mensaje.
- `PrimaryBotService.converse` decide tool-calls; `consulta_agendar` activa el flujo de disponibilidad.
- `CheckAvailabilityUseCase` opera 100% ID-first: extractor → ranking → steps → dominio → slots legibles.
- Las respuestas se gobiernan por política compilada y se redactan en JSON-first antes de volver a Kommo.

## Mapa de archivos clave (CodeMap)
| Ruta | Rol | Entry points/exports | Por qué importa |
| --- | --- | --- | --- |
| [packages/interfaces/src/handlers/leadWebhookHandler.ts](../packages/interfaces/src/handlers/leadWebhookHandler.ts) | Lambda Kommo webhook | `handler(event)` | Bootstrap mínimo y delega a `LeadWebhookController`. |
| [packages/interfaces/src/handlers/leadProcessorHandler.ts](../packages/interfaces/src/handlers/leadProcessorHandler.ts) | Lambda SQS processor | `handler(event)` | Inicializa pool MySQL y entrega cada record a `LeadProcessorController`. |
| [packages/interfaces/src/controllers/LeadWebhookController.ts](../packages/interfaces/src/controllers/LeadWebhookController.ts) | Controller HTTP → cola | `handle(event)` | Limpia/parsing del payload y publica `LeadQueueMessageDTO`. |
| [packages/interfaces/src/controllers/LeadProcessorController.ts](../packages/interfaces/src/controllers/LeadProcessorController.ts) | Controller SQS → orquestación | `handle`, `processRecord` | Compone repos/servicios, orquesta tool-calls y dispara `CheckAvailabilityUseCase`. |
| [packages/core/src/application/usecases/ProcessLeadWebhookUseCase.ts](../packages/core/src/application/usecases/ProcessLeadWebhookUseCase.ts) | Use case webhook | `execute` | Valida query params, arma mensaje FIFO para SQS. |
| [packages/core/src/application/usecases/OrchestrateConversationUseCase.ts](../packages/core/src/application/usecases/OrchestrateConversationUseCase.ts) | Orquestador de conversación | `execute`, `executeTool` | Coordina tool-calls (`consulta_agendar`) y maneja retries/limpieza de sesión. |
| [packages/core/src/application/usecases/UpdatePatientMessageUseCase.ts](../packages/core/src/application/usecases/UpdatePatientMessageUseCase.ts) | Normaliza mensaje paciente | `execute` | Extrae chunk nuevo desde Kommo y produce `MENSAJE_USUARIO`. |
| [packages/core/src/application/usecases/CheckAvailabilityUseCase.ts](../packages/core/src/application/usecases/CheckAvailabilityUseCase.ts) | Use case disponibilidad | `execute` | Pipeline ID-first completo: extractor → ranking → steps → dominio → redactor. |
| [packages/core/src/application/services/AvailabilityService/AvailabilityDomainService.ts](../packages/core/src/application/services/AvailabilityService/AvailabilityDomainService.ts) | Servicio de dominio | `getAppointmentAvailability` | Consulta SQL por IDs, filtra médicos/espacios, levanta disponibilidad cruda. |
| [packages/core/src/application/services/AgendaConfigCompilerService.ts](../packages/core/src/application/services/AgendaConfigCompilerService.ts) | Compiler de políticas | `AgendaConfigCompilerService` | Convierte texto + contexto en `AgendaPolicyResolved`. |
| [packages/core/src/application/services/AvailabilityRequestExtractorService.ts](../packages/core/src/application/services/AvailabilityRequestExtractorService.ts) | Extractor ID-first | `extract` | Usa OpenAI + catálogos para devolver `{ filters: [...] }` con IDs y `date_ranges`. |
| [packages/core/src/application/services/AvailabilityResponseRedactorService.ts](../packages/core/src/application/services/AvailabilityResponseRedactorService.ts) | Redactor JSON-first | `AvailabilityResponseRedactorService` | Redacta mensaje final cumpliendo `RedactorHorariosSchema`. |
| [packages/core/src/application/services/AvailabilityService/SlotAccumulator.ts](../packages/core/src/application/services/AvailabilityService/SlotAccumulator.ts) | Selección de slots | `SlotAccumulator` | Genera universo y pick de horarios priorizando variedad por día. |
| [packages/core/src/application/services/AvailabilityService/AvailabilityDateRankingService/AvailabilityDateRankingService.ts](../packages/core/src/application/services/AvailabilityService/AvailabilityDateRankingService/AvailabilityDateRankingService.ts) | Ranking de fechas | `AvailabilityDateRankingService.fromExtractorFilters` | Ordena fechas por cercanía, rangos y weekdays. Única implementación usada por CheckAvailability. |
| [packages/core/src/application/services/AvailabilityService/AvailabilityTimeDivisionsService/AvailabilityTimeDivisionsService.ts](../packages/core/src/application/services/AvailabilityService/AvailabilityTimeDivisionsService/AvailabilityTimeDivisionsService.ts) | Divisiones horarias | `AvailabilityTimeDivisionsService.assignDay`, `defaultConfig` | Calcula cobertura por división y guía la selección “días completos”. |
| [packages/core/src/application/services/AvailabilityService/AvailabilitySearchCache/AvailabilitySearchCache.ts](../packages/core/src/application/services/AvailabilityService/AvailabilitySearchCache/AvailabilitySearchCache.ts) | Caché en-memoria | `AvailabilitySearchCache` | TTL 5m, key estable por IDs/fechas, evita repetir consultas al dominio. |
| [packages/core/src/application/services/AvailabilityService/AvailabilityStepStrategy/AvailabilityStepStrategy.ts](../packages/core/src/application/services/AvailabilityService/AvailabilityStepStrategy/AvailabilityStepStrategy.ts) | Planner/runner | `buildAvailabilitySteps`, `executeAvailabilitySteps` | Define pipeline de steps (IDs, horizonte) y ejecuta runner de dominio. |

## Flujo end-to-end
- `leadWebhookHandler` recibe el webhook, instancia `LeadWebhookController.handle` que mapea a `KommoLeadEventDTO` y delega a [`ProcessLeadWebhookUseCase.execute`](../packages/core/src/application/usecases/ProcessLeadWebhookUseCase.ts) para construir el mensaje FIFO.
- El mensaje se publica en la cola; `leadProcessorHandler` extrae cada record y llama a [`LeadProcessorController.processRecord`](../packages/interfaces/src/controllers/LeadProcessorController.ts).
- `LeadProcessorController` carga `botConfig` vía `GetBotConfigUseCase`, instancia repos/servicios (Kommo, OpenAI, disponibilidad, pacientes) y prepara los use cases inyectados en [`OrchestrateConversationUseCase`](../packages/core/src/application/usecases/OrchestrateConversationUseCase.ts).
- [`OrchestrateConversationUseCase.execute`](../packages/core/src/application/usecases/OrchestrateConversationUseCase.ts) invoca `PrimaryBotService.converse`, que puede emitir la tool `consulta_agendar`; cada tool call es despachado a `CheckAvailabilityUseCase`.
- [`CheckAvailabilityUseCase.execute`](../packages/core/src/application/usecases/CheckAvailabilityUseCase.ts) maneja el pipeline ID-first y genera el `toolOutput` para Kommo.

```
Kommo Webhook → leadWebhook.ts → LeadWebhookController → ProcessLeadWebhookUseCase
              → SQS → leadProcessor.ts → LeadProcessorController
              → GetBotConfig → OrchestrateConversationUseCase
              → tool: consulta_agendar → CheckAvailabilityUseCase
              → Extractor(ID-first) → Ranking fechas → Steps→Dominio
              → SlotAccumulator + TimeDivisions → AgendaPolicyResolved
              → Redactor → toolOutput #consultaAgendar → Kommo reply
```

## Entrada del sistema
- **MENSAJE_USUARIO**: derivado en [`UpdatePatientMessageUseCase.execute`](../packages/core/src/application/usecases/UpdatePatientMessageUseCase.ts), que compara `PATIENT_MESSAGE_PROCESSED_CHUNK` vs `LAST_PATIENT_MESSAGE` para extraer solo lo nuevo.
- **TIMEZONE**: proviene de `botConfig.timezone` en [`LeadProcessorController.processRecord`](../packages/interfaces/src/controllers/LeadProcessorController.ts) y se replica hacia `OrchestrateConversation` y `CheckAvailability`.
- **Teléfonos y pacientes**: la carga inicial ocurre en `FetchKommoDataUseCase` y el `patientService` creado dentro de `LeadProcessorController`; la caché por turno se maneja en `OrchestrateConversationUseCase.executeTool`.
- **Configs**: `botConfig.placeholders.ASISTENTE_AGENDA_CONFIG` y overrides viajan hasta `AgendaConfigCompilerService` dentro del use case.

## Extractor (ID-first)
- Servicio: [`AvailabilityRequestExtractorService.extract`](../packages/core/src/application/services/AvailabilityRequestExtractorService.ts).
- Recibe `parametrosSolicitudCita` (mensaje normalizado), catálogos completos (`tratamientosDisponibles`, `medicosDisponibles`, `espaciosDisponibles`) y `DEFAULT_FORWARD_DAYS` desde el header (actualmente 45).
- Devuelve `filters` con arrays de IDs (`*_ids`) y `date_ranges` `{ start_date, end_date }`, además de preferencias horarias/textuales.
- Reglas de weekdays (“algún viernes”) se traducen a `weekdaysPreferred` al detonar el ranking.

## Ranking de fechas
- Implementado en [`AvailabilityDateRankingService.fromExtractorFilters`](../packages/core/src/application/services/AvailabilityService/AvailabilityDateRankingService/AvailabilityDateRankingService.ts); no hay otra variante conectada al use case.
- Prioridad: fechas explícitas → primera fecha de cada rango → coincidencias de weekdays → resto de rangos → relleno cercano.
- Horizonte: `forwardExtensionDays` parte del default (45) más `params.rango_dias_extra`. Si el usuario fija un tope, se expande a “máximo mencionado + forward”.
- **Punto de extensión**: ajustar buckets o agregar nuevos criterios dentro de `buildRankedDates`. Se puede alimentar `weekdaysPreferred` desde filtros para casos tipo “próximos viernes”.

## Steps + caché
- `buildAvailabilitySteps` produce un único step “principal” con IDs resueltos y horizonte `forwardExtensionDays`.
- `executeAvailabilitySteps` recorre los steps y ejecuta un runner que agrupa fechas contiguas (`groupContiguousDates`) y genera requests al dominio.
- Caché: [`AvailabilitySearchCache`](../packages/core/src/application/services/AvailabilityService/AvailabilitySearchCache/AvailabilitySearchCache.ts) usa key estable (clinicId + IDs + fechas) y TTL 5 minutos; evita hits redundantes en `AvailabilityDomainService.getAppointmentAvailability`.
- La agrupación en bloques compacta los hits en rangos contiguos antes de llamar al dominio.

## Selección de días
- El universo de slots proviene de `SlotAccumulator`, que respeta `AgendaPolicyResolved` (minutos permitidos, variedad horaria, etc.).
- `CheckAvailabilityUseCase` agrupa por fecha y aplica `AvailabilityTimeDivisionsService.assignDay`; se priorizan días con cobertura completa de divisiones (mañana, mediodía, tarde, noche, etc.) antes de agregar días parciales hasta cubrir máximo tres.
- `AvailabilityTimeDivisionsService.logCoverage` deja trazas de cuántas divisiones se cubrieron por día.
- Tras definir los días, el UC arma `selectedSlotsFull` uniendo **todos** los slots de `analisisTotal` para esas fechas (garantía de consistencia con `days_selected`).

## Redactor
- Política: `AgendaConfigCompilerService` recompila reglas dinámicas (`mostrar_medicos`, límites, overrides) usando el mismo cliente OpenAI ya instanciado.
- Redacción final: [`AvailabilityResponseRedactorService`](../packages/core/src/application/services/AvailabilityResponseRedactorService.ts) recibe `query_context` (rangos consultados, días seleccionados, métrica de cobertura) y `dias_mostrados`; devuelve `{ mensaje, metadata }` cumpliendo `RedactorHorariosSchema`, respetando límites (2–3 horarios por día, máximo 3 días).
- `toolOutput` final expone `QUERY_CONTEXT`, `HORARIOS_DISPONIBLES` (con `selectedSlotsFull`), `HORARIOS_TEXTO` y `MENSAJE_USUARIO`. El fallback de [`ScheduleAppointmentUseCase`](../packages/core/src/application/usecases/ScheduleAppointmentUseCase.ts) usa el mismo contrato.

## Cómo probar rápido
```json
{
  "name": "consulta_agendar",
  "arguments": {
    "tratamiento": "Ortodoncia",
    "medico": null,
    "espacio": null,
    "fechas": "Próximo viernes o sábado a la tarde",
    "horas": "después de las 15:00",
    "rango_dias_extra": 7,
    "summary": "Paciente pide turno fin de semana"
  }
}
```
1. Preparar `LeadQueueMessageDTO` mínimo con los IDs válidos de botConfig y colocar el payload anterior en `normalizedLeadCF` → `PATIENT_MESSAGE`.
2. Ejecutar `CheckAvailabilityUseCase.execute` en una prueba de integración inyectando mocks de repos y del extractor para forzar filtros.

## Checklist de personalización
- **Weekdays / “algún viernes”**: ajustar `weekdaysPreferred` antes de llamar al ranking o extender `buildRankedDates` en [`AvailabilityDateRankingService`](../packages/core/src/application/services/AvailabilityService/AvailabilityDateRankingService/AvailabilityDateRankingService.ts).
- **Proximidad / forward extension**: manipular `baseForwardDays` y `params.rango_dias_extra` en [`CheckAvailabilityUseCase`](../packages/core/src/application/usecases/CheckAvailabilityUseCase.ts) o agregar lógica en `AvailabilityDateRankingService.buildRankedDates`.
- **Cobertura de divisiones**: modificar `AvailabilityTimeDivisionsService.defaultConfig` o la heurística de selección dentro del bucle de `CheckAvailabilityUseCase` que decide “días completos primero”.
- **Límites de presentación**: tocar overrides en la invocación a `AgendaConfigCompilerService` o normalizar `limites` dentro de la política antes de llamar al redactor.

## Preguntas abiertas
- ¿Debe exponerse un hook para personalizar divisiones horarias por clínica (p.ej., horarios extendidos) en `AvailabilityTimeDivisionsService`?
