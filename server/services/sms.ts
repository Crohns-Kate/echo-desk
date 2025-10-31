import twilio from 'twilio';
import { env } from '../utils/env';

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
const fromNumber = env.TWILIO_PHONE_NUMBER;

export async function sendAppointmentConfirmation(params: {
  to: string;
  appointmentDate: string;
  clinicName: string;
}): Promise<void> {
  try {
    const message = `Your appointment at ${params.clinicName} has been confirmed for ${params.appointmentDate}. We look forward to seeing you!`;
    
    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });
    
    console.log('[SMS] Sent confirmation to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send confirmation', e);
  }
}

export async function sendAppointmentRescheduled(params: {
  to: string;
  appointmentDate: string;
  clinicName: string;
}): Promise<void> {
  try {
    const message = `Your appointment at ${params.clinicName} has been rescheduled to ${params.appointmentDate}. See you then!`;
    
    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });
    
    console.log('[SMS] Sent reschedule confirmation to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send reschedule confirmation', e);
  }
}

export async function sendAppointmentCancelled(params: {
  to: string;
  clinicName: string;
}): Promise<void> {
  try {
    const message = `Your appointment at ${params.clinicName} has been cancelled. If this was a mistake, please call us back.`;
    
    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });
    
    console.log('[SMS] Sent cancellation notice to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send cancellation notice', e);
  }
}

export async function sendAppointmentReminder(params: {
  to: string;
  appointmentDate: string;
  clinicName: string;
}): Promise<void> {
  try {
    const message = `Reminder: You have an appointment at ${params.clinicName} on ${params.appointmentDate}. Please call if you need to reschedule.`;
    
    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });
    
    console.log('[SMS] Sent reminder to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send reminder', e);
  }
}
