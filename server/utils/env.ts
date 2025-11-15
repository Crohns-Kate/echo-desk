// Determine Cliniko base URL from region
const CLINIKO_REGION = process.env.CLINIKO_REGION || 'au4';
const CLINIKO_BASE_URL = `https://api.${CLINIKO_REGION}.cliniko.com/v1`;

// WORKAROUND: Force PUBLIC_BASE_URL if it's corrupted by Replit Secret
const PUBLIC_BASE_URL_OVERRIDE = 'https://echo-desk-mbjltd70.replit.app';
const rawPublicBaseUrl = process.env.PUBLIC_BASE_URL;
const isPublicBaseUrlCorrupted = rawPublicBaseUrl && !rawPublicBaseUrl.startsWith('http');

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PUBLIC_BASE_URL: (isPublicBaseUrlCorrupted ? PUBLIC_BASE_URL_OVERRIDE : rawPublicBaseUrl)!,
  TZ: process.env.TZ || 'Australia/Brisbane',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID!,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN!,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER!,
  DATABASE_URL: process.env.DATABASE_URL!,
  CLINIKO_API_KEY: process.env.CLINIKO_API_KEY!,
  CLINIKO_REGION,
  CLINIKO_BASE_URL,
  CLINIKO_BUSINESS_ID: process.env.CLINIKO_BUSINESS_ID!,
  CLINIKO_PRACTITIONER_ID: process.env.CLINIKO_PRACTITIONER_ID!,
  CLINIKO_APPT_TYPE_ID: process.env.CLINIKO_APPT_TYPE_ID!,
  CLINIKO_NEW_PATIENT_APPT_TYPE_ID: process.env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID || process.env.CLINIKO_APPT_TYPE_ID!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '',
  IDENTITY_CAPTURE: (process.env.IDENTITY_CAPTURE ?? 'true') !== 'false',
  INTENT_ENGINE: (process.env.INTENT_ENGINE ?? 'true') !== 'false',
  FORCE_TWILIO_SAY: process.env.FORCE_TWILIO_SAY === 'true',
  PRIMARY_VOICE: process.env.PRIMARY_VOICE || 'Polly.Olivia-Neural',
  CALL_RECORDING_ENABLED: (process.env.CALL_RECORDING_ENABLED ?? 'true') === 'true',
  TRANSCRIPTION_ENABLED: (process.env.TRANSCRIPTION_ENABLED ?? 'true') === 'true',
  // Clinic-specific new patient information (optional)
  ECHO_NEW_PATIENT_INFO: process.env.ECHO_NEW_PATIENT_INFO,
  ECHO_NEW_PATIENT_FEES: process.env.ECHO_NEW_PATIENT_FEES,
};

const required = [
  'PUBLIC_BASE_URL','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER',
  'DATABASE_URL','CLINIKO_API_KEY','CLINIKO_BUSINESS_ID','CLINIKO_PRACTITIONER_ID','CLINIKO_APPT_TYPE_ID'
] as const;

for (const k of required) {
  if (!env[k as keyof typeof env]) { 
    throw new Error(`Missing required env: ${k}`); 
  }
}
