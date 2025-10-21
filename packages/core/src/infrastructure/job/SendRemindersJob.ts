// packages/core/src/infrastructure/job/SendRemindersJob.ts

import { localTime, safeISODate, parseClinicDate, canSendReminder } from '@clinickeys-agents/core/utils';
import { IBotConfigRepository, BotConfigType } from '@clinickeys-agents/core/domain/botConfig';
import { KommoApiGateway } from '@clinickeys-agents/core/infrastructure/integrations/kommo';
import { INotificationRepository } from '@clinickeys-agents/core/domain/notification';
import { KommoRepository } from '@clinickeys-agents/core/infrastructure/kommo';
import { IPatientRepository } from '@clinickeys-agents/core/domain/patient';
import { KommoService, NotificationOmittedError } from '@clinickeys-agents/core/application/services';
import { Logger } from '@clinickeys-agents/core/infrastructure/external';

import {
  RESP_ID,
  SPACE_NAME,
  CLINIC_NAME,
  BOT_MESSAGE,
  PATIENT_PHONE,
  TREATMENT_NAME,
  PATIENT_MESSAGE,
  NOTIFICATION_ID,
  REMINDER_MESSAGE,
  DOCTOR_FULL_NAME,
  APPOINTMENT_DATE,
  PATIENT_LAST_NAME,
  PATIENT_FIRST_NAME,
  PLEASE_WAIT_MESSAGE,
  LAST_PATIENT_MESSAGE,
  APPOINTMENT_END_TIME,
  TRIGGERED_BY_MACHINE,
  APPOINTMENT_START_TIME,
  APPOINTMENT_WEEKDAY_NAME,
  PATIENT_MESSAGE_PROCESSED_CHUNK,
} from '@clinickeys-agents/core/utils';

export interface SendRemindersJobProps {
  notificationsRepo: INotificationRepository;
  botConfigRepo: IBotConfigRepository;
  patientRepo: IPatientRepository;
  pageSize?: number;
}

export class SendRemindersJob {
  private readonly notificationsRepo: INotificationRepository;
  private readonly botConfigRepo: IBotConfigRepository;
  private readonly patientRepo: IPatientRepository;
  private readonly pageSize: number;

  constructor(props: SendRemindersJobProps) {
    this.notificationsRepo = props.notificationsRepo;
    this.botConfigRepo = props.botConfigRepo;
    this.patientRepo = props.patientRepo;
    this.pageSize = props.pageSize ?? 100;
  }

  public async execute(): Promise<void> {
    Logger.info('[SendRemindersJob] Inicio de ejecución');
    const startedAt = Date.now();
    try {
      let cursor: string | undefined;
      let page = 0;

      do {
        Logger.debug('[SendRemindersJob] Pidiendo página de configs', { page: page + 1, pageSize: this.pageSize, cursor });
        const { items: configs, nextCursor } = await this.botConfigRepo.listByBotConfigType(
          BotConfigType.NotificationBot,
          this.pageSize,
          cursor
        );
        cursor = nextCursor;
        page++;

        Logger.info('[SendRemindersJob] Página obtenida', { page, configsCount: configs.length, hasNext: !!cursor });
        if (!configs.length) continue;
        Logger.info(`[JOB] Página ${page}: procesando ${configs.length} configuraciones`);

        for (const cfg of configs) {
          Logger.debug('[SendRemindersJob] Evaluando configuración', { botConfigId: cfg.botConfigId, clinicId: cfg.clinicId, enabled: cfg.isEnabled });
          if (cfg.isEnabled === false) {
            Logger.info('[JOB] Config deshabilitada, se omite', { id: cfg.botConfigId, clinicId: cfg.clinicId });
            continue;
          }

          const {
            botConfigType,
            clinicId,
            clinicSource,
            kommo: { subdomain, longLivedToken, salesbotId },
            timezone,
          } = cfg;

          if (!botConfigType || !clinicId || !clinicSource || !subdomain || !salesbotId || !longLivedToken) {
            Logger.error('[JOB] Config incompleta', {
              botConfigType,
              clinicId,
              clinicSource,
              subdomain,
              salesbotId,
              longLivedToken,
            });
            continue;
          }

          const fechaEnvio = safeISODate(localTime(timezone));
          Logger.debug('[SendRemindersJob] Buscando notificaciones pendientes', { clinicId, fechaEnvio });
          const notifications = await this.notificationsRepo.findPendingByClinic(clinicId, fechaEnvio);
          Logger.info('[SendRemindersJob] Notificaciones pendientes encontradas', { clinicId, count: notifications.length, fechaEnvio });
          if (!notifications.length) continue;

          Logger.info(
            `[JOB] Clínica ${clinicId} (${clinicSource}) – ${notifications.length} recordatorios para ${fechaEnvio}`
          );

          const kommoGateway = new KommoApiGateway({ longLivedToken, subdomain });
          const kommoRepo = new KommoRepository(kommoGateway);
          const kommoService = new KommoService(kommoRepo, this.patientRepo);

          const now = localTime(timezone);
          const MIN_HOUR = 10;
          const hourNow = now.hour;

          for (const n of notifications) {
            try {
              Logger.debug('[SendRemindersJob] Procesando notificación', { id_notificacion: n.id_notificacion });
              const patient = await this.patientRepo.findById(n.id_entidad_destino as number);
              if (!patient) throw new Error('No patient found');

              const progDate = parseClinicDate(n.hora_envio_programada, timezone).toISODate();
              Logger.info('[JOB] Analizando notificación', {
                id: n.id_notificacion,
                telefono: patient.telefono,
                progDate,
                hourNow,
              });

              if (!canSendReminder(now, MIN_HOUR)) {
                Logger.info('[JOB] Hora local < MIN_HOUR, pendiente', {
                  hourNow,
                  MIN_HOUR,
                  id: n.id_notificacion,
                });
                continue;
              }

              // 1. Asegurar lead con nueva firma de KommoService.ensureLead
              Logger.debug('[SendRemindersJob] Asegurando lead en Kommo');
              const leadId = await kommoService.ensureLead({
                botConfig: cfg,
                patientId: patient.id_paciente,
                patientFirstName: n.payload?.patient_firstname || '',
                patientLastName: n.payload?.patient_lastname || '',
                patientPhone: patient.telefono || '',
                notificationId: n.id_notificacion,
              });
              Logger.info('[SendRemindersJob] Lead asegurado', { leadId });

              // 2. Actualizar campos de recordatorio
              const customFields: Record<string, string> = {
                [REMINDER_MESSAGE]: n.mensaje || '',
                [NOTIFICATION_ID]: String(n.id_notificacion),
                [TRIGGERED_BY_MACHINE]: 'true',
                [PATIENT_FIRST_NAME]: n.payload?.patient_firstname || '',
                [PATIENT_LAST_NAME]: n.payload?.patient_lastname || '',
                [PATIENT_PHONE]: patient.telefono || '',
                [CLINIC_NAME]: n.payload?.clinic_name || '',
                [APPOINTMENT_DATE]: n.payload?.visit_date || '',
                [APPOINTMENT_START_TIME]: n.payload?.visit_init_time || '',
                [APPOINTMENT_END_TIME]: n.payload?.visit_end_time || '',
                [APPOINTMENT_WEEKDAY_NAME]: n.payload?.visit_week_day_name || '',
                [DOCTOR_FULL_NAME]: n.payload?.medic_full_name || '',
                [TREATMENT_NAME]: n.payload?.treatment_name || '',
                [SPACE_NAME]: n.payload?.visit_space_name || '',
                [PATIENT_MESSAGE_PROCESSED_CHUNK]: '',
                [LAST_PATIENT_MESSAGE]: '',
                [PLEASE_WAIT_MESSAGE]: '',
                [PATIENT_MESSAGE]: '',
                [BOT_MESSAGE]: '',
                [RESP_ID]: '',
              };
              Logger.debug('[SendRemindersJob] Actualizando campos personalizados en el lead', { leadId });
              await kommoService.updateLeadCustomFields({ botConfig: cfg, leadId, customFields });
              Logger.debug('[SendRemindersJob] Campos personalizados actualizados', { leadId });

              // 3. Ejecutar salesbot
              Logger.debug('[SendRemindersJob] Ejecutando salesbot', { salesbotId, leadId });
              await kommoRepo.runSalesbot({ botId: salesbotId, leadId });
              Logger.info('[JOB] Salesbot ejecutado', { salesbotId, leadId });

              // 4. Marcar como enviado
              Logger.debug('[SendRemindersJob] Marcando notificación como enviada', { id_notificacion: n.id_notificacion });
              await this.notificationsRepo.updateState(n.id_notificacion, 'enviado');
              Logger.info('[SendRemindersJob] Notificación marcada como enviada', { id_notificacion: n.id_notificacion });
            } catch (err) {
              try {
                if (err instanceof NotificationOmittedError) {
                  await this.notificationsRepo.updateState(n.id_notificacion, 'omitido');
                } else {
                  await this.notificationsRepo.updateState(n.id_notificacion, 'fallido');
                }
              } catch (updateErr) {
                Logger.error('[JOB] Error marcando notificación como fallida/omitida', { notificationId: n.id_notificacion, updateErr });
              }
              Logger.error('[JOB] Error enviando recordatorio', {
                notificationId: n.id_notificacion,
                clinicId,
                error: err,
              });
            }
          }
        }
      } while (cursor);
    } catch (error) {
      Logger.error('SendRemindersJob > Error ejecutando job', JSON.stringify(error, null, 2));
      throw error;
    } finally {
      const elapsedMs = Date.now() - startedAt;
      Logger.info('[SendRemindersJob] Finalizó ejecución', { elapsedMs });
    }
  }
}
