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

export async function sendEmailCollectionLink(params: {
  to: string;
  callSid: string;
  clinicName: string;
}): Promise<void> {
  try {
    const publicUrl = env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const link = `${publicUrl}/email-collect?callSid=${encodeURIComponent(params.callSid)}`;
    const message = `Hi from ${params.clinicName}! Please click this link to enter your email address: ${link}`;

    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });

    console.log('[SMS] Sent email collection link to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send email collection link', e);
  }
}

export async function sendNameVerificationLink(params: {
  to: string;
  callSid: string;
  clinicName: string;
}): Promise<void> {
  try {
    const publicUrl = env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const link = `${publicUrl}/name-verify?callSid=${encodeURIComponent(params.callSid)}`;
    const message = `Hi from ${params.clinicName}! Please click this link to verify your name spelling: ${link}`;

    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });

    console.log('[SMS] Sent name verification link to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send name verification link', e);
  }
}

export async function sendPostCallDataCollection(params: {
  to: string;
  callSid: string;
  clinicName: string;
  appointmentDetails?: string;
  missingFields?: string[];
}): Promise<void> {
  try {
    const publicUrl = env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const link = `${publicUrl}/verify-details?callSid=${encodeURIComponent(params.callSid)}`;

    let message = `Thanks for calling ${params.clinicName}!`;

    if (params.appointmentDetails) {
      message += ` ${params.appointmentDetails}`;
    }

    if (params.missingFields && params.missingFields.length > 0) {
      message += `\n\nPlease verify your details here: ${link}`;
    } else {
      message += `\n\nVerify or update your details: ${link}`;
    }

    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });

    console.log('[SMS] Sent post-call data collection to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send post-call data collection', e);
  }
}

export async function sendNewPatientForm(params: {
  to: string;
  token: string;
  clinicName: string;
}): Promise<void> {
  try {
    const publicUrl = env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const link = `${publicUrl}/intake/${params.token}`;
    const message = `Thanks for calling ${params.clinicName}! Please complete your details here (takes 30 seconds): ${link}`;

    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });

    console.log('[SMS] Sent new patient form link to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send new patient form link', e);
  }
}

export async function sendEmailUpdateConfirmation(params: {
  to: string;
  email: string;
  clinicName: string;
}): Promise<void> {
  try {
    const message = `Thanks! Your email has been updated to ${params.email} in our records at ${params.clinicName}.`;

    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });

    console.log('[SMS] Sent email update confirmation to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send email update confirmation', e);
  }
}

export async function sendEmailUpdateError(params: {
  to: string;
  clinicName: string;
  reason: string;
}): Promise<void> {
  try {
    const message = `Sorry, we couldn't update your email at ${params.clinicName}. ${params.reason}. Please call us if you need help.`;

    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });

    console.log('[SMS] Sent email update error to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send email update error', e);
  }
}

/**
 * Send an info link with FAQ details
 * Used when caller asks questions and we want to provide written info
 */
export async function sendInfoLink(params: {
  to: string;
  clinicName: string;
  topic: 'general' | 'prices' | 'location' | 'hours' | 'first_visit' | 'services';
  customMessage?: string;
}): Promise<void> {
  try {
    const publicUrl = env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const link = `${publicUrl}/info/${params.topic}`;

    let message = params.customMessage || `Here's more info from ${params.clinicName}: ${link}`;

    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });

    console.log('[SMS] Sent info link to', params.to, 'topic:', params.topic);
  } catch (e) {
    console.error('[SMS] Failed to send info link', e);
  }
}

/**
 * Send a message capture link for reception follow-up
 * Used when we can't answer a question and need reception to follow up
 */
export async function sendMessageCaptureLink(params: {
  to: string;
  clinicName: string;
  callSid: string;
}): Promise<void> {
  try {
    const publicUrl = env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const link = `${publicUrl}/leave-message?callSid=${encodeURIComponent(params.callSid)}`;

    const message = `Thanks for calling ${params.clinicName}! Click here to leave your question and we'll get back to you: ${link}`;

    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });

    console.log('[SMS] Sent message capture link to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send message capture link', e);
  }
}

/**
 * Send a map/directions link to the clinic
 * Used when caller asks for directions
 */
export async function sendMapLink(params: {
  to: string;
  clinicName: string;
  clinicAddress?: string;
}): Promise<void> {
  try {
    // Default clinic address - can be overridden via params
    const address = params.clinicAddress || 'Spinalogic Chiropractic Brisbane';
    const encodedAddress = encodeURIComponent(address);
    const mapLink = `https://maps.google.com/maps?q=${encodedAddress}`;

    const message = `Here's a map link with directions to ${params.clinicName}: ${mapLink}`;

    await client.messages.create({
      body: message,
      from: fromNumber,
      to: params.to
    });

    console.log('[SMS] Sent map link to', params.to);
  } catch (e) {
    console.error('[SMS] Failed to send map link', e);
  }
}
