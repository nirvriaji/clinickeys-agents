// packages/interfaces/src/controllers/LeadProcessorController.ts

import { SQSEvent, SQSRecord } from "aws-lambda";

import {
  OrchestrateConversationUseCase,
  ScheduleAppointmentUseCase,
  CheckAvailabilityUseCase,
  RegularConversationUseCase,
  FetchPatientInfoUseCase,
  FetchKommoDataUseCase,
  UpdatePatientMessageUseCase,
  IdentifyPatientUseCase,
  ManageAppointmentStateUseCase,
  CreateTaskUseCase,
  ClarifyPatientUseCase,
  GetBotConfigUseCase,
  SessionResetUseCase,
} from "@clinickeys-agents/core/application/usecases";

import {
  KommoService,
  OpenAIService,
  PatientService,
  AvailabilityDomainService,
  AppointmentService,
  PackBonoService,
  AvailabilityRequestExtractorService,
  PrimaryBotService,
  ConversationContextService,
} from "@clinickeys-agents/core/application/services";

import { KommoApiGateway } from "@clinickeys-agents/core/infrastructure/integrations/kommo";
import { OpenAIResponseGateway } from "@clinickeys-agents/core/infrastructure/integrations/openai";

import { KommoRepository } from "@clinickeys-agents/core/infrastructure/kommo";
import { OpenAIResponseRepository } from "@clinickeys-agents/core/infrastructure/openai";
import { MedicoRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/medico";
import { TratamientoRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/tratamiento";
import { PackBonoRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/packBono";
import { EspacioRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/espacio";
import { PatientRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/patient";
import { AppointmentRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/appointment";
import { PresupuestoRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/presupuesto";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";

import { LeadQueueMessageDTO } from "@clinickeys-agents/core/domain/kommo";
import { BotConfigType } from "@clinickeys-agents/core/domain/botConfig";
import { THREAD_ID, REMINDER_MESSAGE } from "@clinickeys-agents/core/utils";

export class LeadProcessorController {
  constructor(
    private readonly getBotConfigUC: GetBotConfigUseCase,
    private readonly logger: typeof Logger = Logger,
  ) { }

  async handle(event: SQSEvent): Promise<void> {
    for (const rec of event.Records) {
      await this.processRecord(rec);
    }
  }

  private async processRecord(record: SQSRecord): Promise<void> {
    let msg: LeadQueueMessageDTO;
    try {
      msg = JSON.parse(record.body);
      this.logger.debug("[LeadProcessorController] Parsed message", { msg });
    } catch (err) {
      this.logger.error("[LeadProcessorController] Invalid JSON", err as Error);
      throw err;
    }

    const { botConfigType, botConfigId, clinicSource, clinicId } = msg.pathParameters;
    if (!botConfigType || !botConfigId || !clinicSource || !clinicId) {
      this.logger.error("[LeadProcessorController] Missing path params", { pathParameters: msg.pathParameters });
      throw new Error("Missing path params");
    }

    // ===============================
    // 1) Cargar BotConfig
    // ===============================
    this.logger.debug("[LeadProcessorController] Fetching bot configuration", { botConfigId, botConfigType });
    const botConfig = await this.getBotConfigUC.execute(
      botConfigType as BotConfigType,
      botConfigId,
      clinicSource,
      Number(clinicId)
    );
    if (!botConfig) throw new Error("BotConfig not found");

    // ===============================
    // 2) Gateways/Repos/Services comunes
    // ===============================
    // Kommo
    const kommoGateway = new KommoApiGateway({
      longLivedToken: botConfig.kommo.longLivedToken,
      subdomain: botConfig.kommo.subdomain,
    });
    const kommoRepository = new KommoRepository(kommoGateway);
    const kommoService = new KommoService(kommoRepository, new PatientRepositoryMySQL());

    // OpenAI (Responses v5)
    const openAIResponseGateway = new OpenAIResponseGateway({ apiKey: (botConfig as any).openai.apiKey });
    const openAIResponseRepository = new OpenAIResponseRepository(openAIResponseGateway);
    const openAIService = new OpenAIService(openAIResponseRepository);

    // Repos de dominio
    const appointmentRepo = new AppointmentRepositoryMySQL();
    const tratamientoRepo = new TratamientoRepositoryMySQL();
    const packBonoRepo = new PackBonoRepositoryMySQL();
    const patientRepo = new PatientRepositoryMySQL();
    const medicoRepo = new MedicoRepositoryMySQL();
    const espacioRepo = new EspacioRepositoryMySQL();

    // Servicios de dominio
    const patientService = new PatientService({
      patientRepo,
      appointmentRepo,
      presupuestoRepo: new PresupuestoRepositoryMySQL(),
      packBonoRepo,
    });

    const getEstructuredAvailabilityRequestSvc = new AvailabilityRequestExtractorService(openAIService);

    const availabilityService = new AvailabilityDomainService(
      tratamientoRepo,
      medicoRepo,
      espacioRepo,
    );

    const appointmentService = new AppointmentService(appointmentRepo);
    const packBonoService = new PackBonoService(packBonoRepo);

    // ===============================
    // 3) Use Cases (dependencias concretas)
    // ===============================
    const fetchKommoDataUC = new FetchKommoDataUseCase(kommoService);
    const fetchPatientInfoUC = new FetchPatientInfoUseCase(fetchKommoDataUC, patientService);

    const updatePatientMessageUC = new UpdatePatientMessageUseCase(kommoService);

    const scheduleAppointmentUC = new ScheduleAppointmentUseCase(
      kommoService,
      appointmentService,
      availabilityService,
      patientService,
      openAIService,
      packBonoService,
    );

    const checkAvailabilityUC = new CheckAvailabilityUseCase(
      kommoService,
      availabilityService,
      getEstructuredAvailabilityRequestSvc,
      tratamientoRepo,
      medicoRepo,
      espacioRepo,
    );

    const manageAppointmentStateUC = new ManageAppointmentStateUseCase(appointmentService);
    const createTaskUC = new CreateTaskUseCase(kommoService);
    const regularConversationUC = new RegularConversationUseCase();
    const identifyPatientUC = new IdentifyPatientUseCase(patientService);
    const clarifyPatientUC = new ClarifyPatientUseCase();
    const sessionResetUC = new SessionResetUseCase(kommoService);

    // Servicios de orquestación (nuevo stack Responses v5)
    const contextService = new ConversationContextService({ fetchPatientInfoUC, logger: Logger });
    const primaryBot = new PrimaryBotService(openAIService, contextService, Logger);

    const orchestrateUC = new OrchestrateConversationUseCase({
      kommoService,
      primaryBot,
      scheduleAppointmentUC,
      checkAvailabilityUC,
      manageAppointmentStateUC,
      createTaskUC,
      identifyPatientUC,
      clarifyPatientUC,
      regularConversationUC,
      sessionResetUC
    });

    // ===============================
    // 4) Preparar mensaje del usuario y ejecutar
    // ===============================
    this.logger.debug("[LeadProcessorController] Fetching Kommo data for lead");
    const kommoData = await fetchKommoDataUC.execute({
      botConfig,
      leadId: Number(msg.kommo.leads.add?.[0]?.id ?? 0),
    });

    if (!kommoData) {
      this.logger.warn("[LeadProcessorController] No se pudo obtener datos de Kommo", {
        leadId: Number(msg.kommo.leads.add?.[0]?.id ?? 0),
      });
      return;
    }

    const normalizedLeadCF = kommoData.normalizedLeadCF || [];
    const updateResult = await updatePatientMessageUC.execute({
      botConfig,
      leadId: Number(msg.kommo.leads.add?.[0]?.id ?? 0),
      normalizedLeadCF,
    });

    const userMessage = updateResult.newPatientMessage;
    const reminderMessage = normalizedLeadCF.find((cf) => cf.field_name === REMINDER_MESSAGE)?.value || undefined;
    const previousResponseId = normalizedLeadCF.find((cf) => cf.field_name === THREAD_ID)?.value || undefined; // mantenido por compatibilidad; Responses v5 usa previousResponseId

    this.logger.debug("[LeadProcessorController] Orchestrating conversation", {
      lead: Number(msg.kommo.leads.add?.[0]?.id ?? 0),
      reminderMessage,
      previousResponseId,
    });

    const result = await orchestrateUC.execute({
      botConfig: botConfig,
      leadId: Number(msg.kommo.leads.add?.[0]?.id ?? 0),
      normalizedLeadCF,
      userMessage,
      reminderMessage: reminderMessage || "",
      previousResponseId,
    });

    this.logger.info("[LeadProcessorController] Processed", {
      leadId: Number(msg.kommo.leads.add?.[0]?.id ?? 0),
      success: result.success,
    });
  }
}