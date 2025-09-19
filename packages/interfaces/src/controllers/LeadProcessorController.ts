// packages/interfaces/src/controllers/LeadProcessorController.ts

import { SQSEvent, SQSRecord } from "aws-lambda";

import {
  CommunicateWithAssistantUseCase,
  CommunicateInput,
  RecognizeUserIntentUseCase,
  ScheduleAppointmentUseCase,
  CheckAvailabilityUseCase,
  CheckReprogramAvailabilityUseCase,
  RescheduleAppointmentUseCase,
  CancelAppointmentUseCase,
  UnconfirmAppointmentUseCase,
  ConfirmAppointmentUseCase,
  MarkPatientOnTheWayUseCase,
  HandleUrgencyUseCase,
  RegularConversationUseCase,
  FetchPatientInfoUseCase,
  FetchKommoDataUseCase,
  GetBotConfigUseCase,
  UpdatePatientMessageUseCase,
} from "@clinickeys-agents/core/application/usecases";

import {
  KommoService,
  OpenAIService,
  PatientService,
  AvailabilityService,
  AppointmentService,
  PackBonoService
} from "@clinickeys-agents/core/application/services";

import { KommoApiGateway } from "@clinickeys-agents/core/infrastructure/integrations/kommo";
import { OpenAIGateway } from "@clinickeys-agents/core/infrastructure/integrations/openai";

import { KommoRepository } from "@clinickeys-agents/core/infrastructure/kommo";
import { MedicoRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/medico";
import { TratamientoRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/tratamiento";
import { PackBonoRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/packBono";
import { EspacioRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/espacio";

import { PatientRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/patient";
import { AppointmentRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/appointment";
import { PresupuestoRepositoryMySQL } from "@clinickeys-agents/core/infrastructure/presupuesto";
import { EstructuredAvailabilityRequest } from "@clinickeys-agents/core/infrastructure/availability";
import { Logger } from "@clinickeys-agents/core/infrastructure/external";
import { THREAD_ID, REMINDER_MESSAGE } from "@clinickeys-agents/core/utils";

import { LeadQueueMessageDTO } from "@clinickeys-agents/core/domain/kommo";
import { BotConfigType } from "@clinickeys-agents/core/domain/botConfig";

export class LeadProcessorController {
  constructor(
    private readonly getBotConfigUC: GetBotConfigUseCase,
    private readonly logger: typeof Logger = Logger,
  ) {}

  async handle(event: SQSEvent): Promise<void> {
    for (const rec of event.Records) {
      await this.processRecord(rec);
    }
  }

  private async processRecord(record: SQSRecord): Promise<void> {
    let msg: LeadQueueMessageDTO;
    try {
      msg = JSON.parse(record.body);
      this.logger.debug("Parsed message successfully", { msg });
    } catch (err) {
      this.logger.error("Invalid JSON", err as Error);
      throw err;
    }

    const { botConfigType, botConfigId, clinicSource, clinicId } = msg.pathParameters;
    if (!botConfigType || !botConfigId || !clinicSource || !clinicId) {
      this.logger.error("Missing path params", { pathParameters: msg.pathParameters });
      throw new Error("Missing path params");
    }

    this.logger.debug("Fetching bot configuration", { botConfigId, botConfigType });
    const botConfig = await this.getBotConfigUC.execute(botConfigType as BotConfigType, botConfigId, clinicSource, Number(clinicId));
    this.logger.debug("Bot configuration fetch result", { found: !!botConfig });
    if (!botConfig) throw new Error("BotConfig not found");

    this.logger.debug("Initializing repositories and services");
    const appointmentRepo = new AppointmentRepositoryMySQL();
    const tratamientoRepo = new TratamientoRepositoryMySQL();
    const packBonoRepo = new PackBonoRepositoryMySQL();
    const patientRepo = new PatientRepositoryMySQL();
    const medicoRepo = new MedicoRepositoryMySQL();
    const espacioRepo = new EspacioRepositoryMySQL();

    const kommoGateway = new KommoApiGateway({
      longLivedToken: (botConfig as any).kommo.longLivedToken,
      subdomain: (botConfig as any).kommo.subdomain,
    });
    const kommoRepository = new KommoRepository(kommoGateway);
    const kommoService = new KommoService(kommoRepository, patientRepo);
    const updatePatientMessageUC = new UpdatePatientMessageUseCase(kommoService);

    const openAIGateway = new OpenAIGateway({ apiKey: (botConfig as any).openai.apiKey });
    const openAIService = new OpenAIService(openAIGateway, this.logger);

    const patientService = new PatientService({
      patientRepo,
      appointmentRepo,
      presupuestoRepo: new PresupuestoRepositoryMySQL(),
      packBonoRepo,
    });

    const estructuredAvailabilityRequest = new EstructuredAvailabilityRequest(openAIService);

    const availabilityService = new AvailabilityService(
      tratamientoRepo,
      medicoRepo,
      espacioRepo,
      estructuredAvailabilityRequest
    );
    const appointmentService = new AppointmentService(appointmentRepo);
    const packBonoService = new PackBonoService(packBonoRepo);

    this.logger.debug("Setting up use cases");
    const fetchKommoDataUC = new FetchKommoDataUseCase(this.getBotConfigUC, kommoService);
    const fetchPatientInfoUC = new FetchPatientInfoUseCase(fetchKommoDataUC, patientService);
    const recognizeIntentUC = new RecognizeUserIntentUseCase(fetchPatientInfoUC);

    const scheduleAppointmentUC = new ScheduleAppointmentUseCase(
      kommoService,
      appointmentService,
      availabilityService,
      patientService,
      openAIService,
      packBonoService,
    );
    const checkAvailabilityUC = new CheckAvailabilityUseCase(kommoService, availabilityService);
    const checkReprogramAvailabilityUC = new CheckReprogramAvailabilityUseCase(kommoService, availabilityService, openAIService);
    const rescheduleAppointmentUC = new RescheduleAppointmentUseCase(
      kommoService,
      appointmentService,
      availabilityService,
      openAIService,
    );
    const cancelAppointmentUC = new CancelAppointmentUseCase(
      kommoService,
      appointmentService,
      packBonoService,
    );
    const confirmAppointmentUC = new ConfirmAppointmentUseCase(appointmentService);
    const unconfirmAppointmentUC = new UnconfirmAppointmentUseCase(appointmentService);
    const markPatientOnTheWayUC = new MarkPatientOnTheWayUseCase(appointmentService);
    const handleUrgencyUC = new HandleUrgencyUseCase(kommoService);
    const regularConversationUC = new RegularConversationUseCase();

    const communicateUC = new CommunicateWithAssistantUseCase({
      kommoService,
      openAIService,
      recognizeIntentUC,
      scheduleAppointmentUC,
      checkAvailabilityUC,
      checkReprogramAvailabilityUC,
      rescheduleAppointmentUC,
      cancelAppointmentUC,
      unconfirmAppointmentUC,
      confirmAppointmentUC,
      markPatientOnTheWayUC,
      handleUrgencyUC,
      regularConversationUC,
    });

    this.logger.debug("Fetching Kommo data for lead");
    const kommoData = await fetchKommoDataUC.execute({
      botConfigType: botConfigType as BotConfigType,
      botConfigId,
      clinicSource,
      clinicId: Number(clinicId),
      leadId: Number(msg.kommo.leads.add?.[0]?.id ?? 0)
    });

    const normalizedLeadCF = kommoData.normalizedLeadCF || [];
    const updateResult = await updatePatientMessageUC.execute({
      botConfig: botConfig as any,
      leadId: Number(msg.kommo.leads.add?.[0]?.id ?? 0),
      normalizedLeadCF,
    });

    const userMessage = updateResult.newPatientMessage;
    const reminderMessage = normalizedLeadCF.find((cf) => cf.field_name === REMINDER_MESSAGE)?.value || undefined;

    const threadId = normalizedLeadCF.find((cf) => cf.field_name === THREAD_ID)?.value || undefined;

    const communicateInput: CommunicateInput = {
      leadId: Number(msg.kommo.leads.add?.[0]?.id ?? 0),
      botConfig: botConfig as any,
      normalizedLeadCF,
      reminderMessage,
      userMessage,
      threadId
    };

    await communicateUC.execute(communicateInput);
    this.logger.info("Processed", { leadId: communicateInput.leadId });
  }
}
