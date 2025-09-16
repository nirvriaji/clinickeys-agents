// @clinickeys-agents/core/utils/constants.ts

// --- Custom Field Constants --- //
export const PATIENT_FIRST_NAME = "patientFirstName";
export const PATIENT_LAST_NAME = "patientLastName";
export const PATIENT_PHONE = "patientPhone";

export const CLINIC_NAME = "clinicName";

export const APPOINTMENT_WEEKDAY_NAME = "appointmentWeekdayName";
export const APPOINTMENT_START_TIME = "appointmentStartTime";
export const APPOINTMENT_END_TIME = "appointmentEndTime";
export const APPOINTMENT_DATE = "appointmentDate";

export const DOCTOR_FULL_NAME = "doctorFullName";

export const TREATMENT_NAME = "treatmentName";

export const SPACE_NAME = "spaceName";

export const REMINDER_MESSAGE = "reminderMessage";

export const PATIENT_MESSAGE_PROCESSED_CHUNK = "patientMessageProcessedChunk";
export const LAST_PATIENT_MESSAGE = "lastPatientMessage";
export const TRIGGERED_BY_MACHINE = "triggeredByMachine";
export const PLEASE_WAIT_MESSAGE = "pleaseWaitMessage";
export const NOTIFICATION_ID = "notificationId";
export const PATIENT_MESSAGE = "patientMessage";
export const CONTROL_MODE = "controlMode";
export const RANDOM_STAMP = "randomStamp";
export const SALESBOT_LOG = "salesbotLog";
export const BOT_MESSAGE = "botMessage";
export const THREAD_ID = "threadId";

// --- Profiles --- //
export const profiles = {
  default_kommo_profile: {
    adding_contact: {
      custom_fields_config: [
        {
          field_code: "PHONE",
          enum_code: "WORK"
        }
      ]
    },
    lead: {
      custom_field_config: [
        { field_name: APPOINTMENT_WEEKDAY_NAME },
        { field_name: APPOINTMENT_START_TIME },
        { field_name: APPOINTMENT_END_TIME },
        { field_name: APPOINTMENT_DATE },

        { field_name: REMINDER_MESSAGE },

        { field_name: PATIENT_FIRST_NAME },
        { field_name: PATIENT_LAST_NAME },
        { field_name: PATIENT_PHONE },

        { field_name: DOCTOR_FULL_NAME },
        { field_name: SPACE_NAME },

        { field_name: PATIENT_MESSAGE_PROCESSED_CHUNK },
        { field_name: LAST_PATIENT_MESSAGE },
        { field_name: TRIGGERED_BY_MACHINE },
        { field_name: PLEASE_WAIT_MESSAGE },
        { field_name: NOTIFICATION_ID },
        { field_name: PATIENT_MESSAGE },
        { field_name: TREATMENT_NAME },
        { field_name: RANDOM_STAMP },
        { field_name: SALESBOT_LOG },
        { field_name: CONTROL_MODE },
        { field_name: BOT_MESSAGE },
        { field_name: CLINIC_NAME },
        { field_name: THREAD_ID },
      ]
    }
  },
  default_minimal_profile: {
    adding_contact: { custom_fields_config: [] },
    lead: { custom_field_config: [] }
  }
};

// --- Agrupaciones por tipo de Bot --- //
export const CHAT_BOT_CUSTOM_FIELDS = [
  THREAD_ID,
  BOT_MESSAGE,
  RANDOM_STAMP, 
  CONTROL_MODE,
  SALESBOT_LOG,
  PATIENT_PHONE,
  PATIENT_MESSAGE,
  REMINDER_MESSAGE,
  PATIENT_LAST_NAME,
  PATIENT_FIRST_NAME,
  PLEASE_WAIT_MESSAGE,
  TRIGGERED_BY_MACHINE,
  LAST_PATIENT_MESSAGE,
  PATIENT_MESSAGE_PROCESSED_CHUNK,
];

export const NOTIFICATION_BOT_CUSTOM_FIELDS = [
  SPACE_NAME,
  CLINIC_NAME,
  SALESBOT_LOG,
  PATIENT_PHONE,
  TREATMENT_NAME,
  NOTIFICATION_ID,
  DOCTOR_FULL_NAME,
  PATIENT_LAST_NAME,
  REMINDER_MESSAGE,
  APPOINTMENT_DATE,
  PATIENT_FIRST_NAME,
  APPOINTMENT_END_TIME,
  TRIGGERED_BY_MACHINE,
  APPOINTMENT_START_TIME,
  APPOINTMENT_WEEKDAY_NAME,
];