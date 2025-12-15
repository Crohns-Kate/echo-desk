/**
 * Handoff Service
 * 
 * Handles human handoff via:
 * - Twilio Dial transfer (immediate)
 * - Callback capture + SMS (fallback)
 * - SMS-only notification
 */

import twilio from 'twilio';
import { storage } from '../storage';
import { saySafe } from '../utils/voice-constants';
import { abs } from '../utils/url';
import { sendSMS } from './sms';
import type { Tenant } from '@shared/schema';

export type HandoffMode = 'transfer' | 'callback' | 'sms_only';
export type HandoffStatus = 'pending' | 'transferred' | 'failed' | 'callback_requested' | 'completed';

export interface HandoffConfig {
  mode: HandoffMode;
  handoffPhone?: string;
  afterHoursMode?: HandoffMode;
  smsTemplate?: string;
}

/**
 * Get handoff configuration from tenant settings
 */
export function getHandoffConfig(tenant: Tenant | null): HandoffConfig {
  if (!tenant) {
    // Default config
    return {
      mode: 'callback',
      afterHoursMode: 'callback',
      smsTemplate: 'Hi, you requested a callback from our clinic. We\'ll call you back shortly.'
    };
  }
  
  return {
    mode: (tenant.handoffMode as HandoffMode) || 'callback',
    handoffPhone: tenant.handoffPhone || undefined,
    afterHoursMode: (tenant.afterHoursMode as HandoffMode) || 'callback',
    smsTemplate: tenant.handoffSmsTemplate || 'Hi, you requested a callback from {{clinic_name}}. We\'ll call you back shortly.'
  };
}

/**
 * Check if we should use after-hours mode
 */
export function isAfterHours(tenant: Tenant | null): boolean {
  if (!tenant?.businessHours) return false;
  
  try {
    const businessHours = typeof tenant.businessHours === 'string' 
      ? JSON.parse(tenant.businessHours) 
      : tenant.businessHours;
    
    if (!businessHours || typeof businessHours !== 'object') return false;
    
    const now = new Date();
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    const dayHours = businessHours[dayOfWeek];
    if (!dayHours || !Array.isArray(dayHours) || dayHours.length === 0) {
      return true; // No hours set = after hours
    }
    
    // Check if current time is within any of the time ranges
    for (const range of dayHours) {
      if (Array.isArray(range) && range.length === 2) {
        const [start, end] = range;
        if (currentTime >= start && currentTime <= end) {
          return false; // Within business hours
        }
      }
    }
    
    return true; // Outside all ranges = after hours
  } catch (error) {
    console.error('[Handoff] Error checking business hours:', error);
    return false; // Default to business hours on error
  }
}

/**
 * Create TwiML for transfer (Dial to handoff phone)
 */
export function createTransferTwiML(
  vr: twilio.twiml.VoiceResponse,
  handoffPhone: string,
  callSid: string,
  clinicName: string
): void {
  saySafe(vr, `Transferring you to ${clinicName}. Please hold.`);
  
  // Dial with 20s timeout
  const dial = vr.dial({
    timeout: 20,
    action: abs(`/api/voice/handoff-status?callSid=${callSid}`),
    method: 'POST',
    callerId: handoffPhone // Use handoff phone as caller ID if available
  });
  
  dial.number(handoffPhone);
  
  // Fallback if dial fails (no answer, busy, etc.)
  saySafe(vr, 'I wasn\'t able to connect you right now. Let me take your details and we\'ll call you back shortly.');
  vr.redirect({
    method: 'POST'
  }, abs(`/api/voice/handoff-callback?callSid=${callSid}`));
}

/**
 * Create TwiML for callback capture
 */
export function createCallbackTwiML(
  vr: twilio.twiml.VoiceResponse,
  callSid: string,
  clinicName: string
): void {
  saySafe(vr, `Thanks for calling ${clinicName}. We'll call you back shortly. Is there a best time to reach you?`);
  
  const gather = vr.gather({
    input: ['speech'],
    timeout: 8,
    speechTimeout: 'auto',
    enhanced: true,
    speechModel: 'phone_call',
    action: abs(`/api/voice/handoff-callback-capture?callSid=${callSid}`),
    method: 'POST'
  });
  
  saySafe(gather, 'Please let me know the best time to call you back, or just say anytime.');
  
  // Fallback if no response
  saySafe(vr, 'Got it. We\'ll call you back as soon as possible. Have a great day!');
  vr.hangup();
}

/**
 * Create TwiML for SMS-only handoff
 */
export function createSMSOnlyTwiML(
  vr: twilio.twiml.VoiceResponse,
  clinicName: string
): void {
  saySafe(vr, `Thanks for calling ${clinicName}. We've received your request and will send you a text message shortly. Have a great day!`);
  vr.hangup();
}

/**
 * Process handoff based on mode and configuration
 */
export async function processHandoff(
  vr: twilio.twiml.VoiceResponse,
  callSid: string,
  fromNumber: string,
  tenant: Tenant | null,
  trigger: string,
  reason: string
): Promise<void> {
  const config = getHandoffConfig(tenant);
  const afterHours = isAfterHours(tenant);
  const mode = afterHours ? (config.afterHoursMode || config.mode) : config.mode;
  
  console.log('[Handoff] Processing handoff:', {
    callSid,
    mode,
    afterHours,
    trigger,
    reason
  });
  
  // Get call record for tenant info
  const call = await storage.getCallByCallSid(callSid);
  
  // Update call log with handoff info
  await storage.updateCall(callSid, {
    handoffTriggered: true,
    handoffReason: reason,
    handoffMode: mode,
    handoffStatus: 'pending' as HandoffStatus,
    handoffTarget: mode === 'transfer' ? config.handoffPhone : fromNumber
  });
  
  // Create alert for handoff
  if (call) {
    await storage.createAlert({
      tenantId: call.tenantId || undefined,
      conversationId: call.conversationId || undefined,
      reason: mode === 'callback' ? 'callback_requested' : 'human_request',
      payload: {
        callSid,
        fromNumber,
        trigger,
        reason,
        mode,
        afterHours
      },
      status: 'open'
    });
  }
  
  // Route based on mode
  switch (mode) {
    case 'transfer':
      if (config.handoffPhone) {
        createTransferTwiML(vr, config.handoffPhone, callSid, tenant?.clinicName || 'our clinic');
      } else {
        // No handoff phone configured, fall back to callback
        console.warn('[Handoff] Transfer mode but no handoff phone configured, falling back to callback');
        createCallbackTwiML(vr, callSid, tenant?.clinicName || 'our clinic');
      }
      break;
      
    case 'callback':
      createCallbackTwiML(vr, callSid, tenant?.clinicName || 'our clinic');
      break;
      
    case 'sms_only':
      // Send SMS notification
      if (tenant && config.smsTemplate && fromNumber) {
        const smsText = config.smsTemplate.replace('{{clinic_name}}', tenant.clinicName || 'our clinic');
        try {
          await sendSMS(fromNumber, smsText, tenant.id);
          console.log('[Handoff] SMS sent to:', fromNumber);
        } catch (error) {
          console.error('[Handoff] Failed to send SMS:', error);
        }
      }
      createSMSOnlyTwiML(vr, tenant?.clinicName || 'our clinic');
      break;
      
    default:
      // Default to callback
      createCallbackTwiML(vr, callSid, tenant?.clinicName || 'our clinic');
  }
}

/**
 * Handle transfer status callback (from Twilio Dial)
 */
export async function handleTransferStatus(
  callSid: string,
  dialCallStatus: string
): Promise<void> {
  let status: HandoffStatus = 'failed';
  let notes = '';
  
  switch (dialCallStatus) {
    case 'completed':
      status = 'transferred';
      notes = 'Successfully transferred to human';
      break;
    case 'busy':
      status = 'failed';
      notes = 'Handoff phone was busy';
      break;
    case 'no-answer':
      status = 'failed';
      notes = 'Handoff phone did not answer';
      break;
    case 'failed':
      status = 'failed';
      notes = 'Transfer failed';
      break;
    case 'canceled':
      status = 'failed';
      notes = 'Transfer was canceled';
      break;
    default:
      status = 'failed';
      notes = `Unknown status: ${dialCallStatus}`;
  }
  
  await storage.updateCall(callSid, {
    handoffStatus: status,
    handoffNotes: notes
  });
  
  console.log('[Handoff] Transfer status updated:', { callSid, status, notes });
}
