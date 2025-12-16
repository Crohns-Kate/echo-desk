/**
 * OpenAI Call Handler - New conversational AI call flow
 *
 * This handler replaces the FSM-based approach with an OpenAI-powered
 * natural conversation system that:
 * - Understands goals from first utterance
 * - Extracts multi-intent state
 * - Generates human-like responses
 * - Integrates with Cliniko for slot booking
 */

import twilio from 'twilio';
import { storage } from '../storage';
import {
  callReceptionistBrain,
  initializeConversation,
  addTurnToHistory,
  updateConversationState,
  expandCompactState,
  // Loop prevention helpers
  shouldAskQuestion,
  incrementQuestionCount,
  getQuestionCount,
  advanceBookingStage,
  isPastStage,
  resolveSharedPhone,
  resolveIdentity,
  BookingStage,
  type ConversationContext,
  type CompactCallState,
  type ParsedCallState,
  type QuestionKey
} from '../ai/receptionistBrain';
import { findPatientByPhoneRobust, getAvailability, createAppointmentForPatient, getNextUpcomingAppointment, rescheduleAppointment, cancelAppointment, getMultiPractitionerAvailability, type EnrichedSlot } from './cliniko';
import { getTenantContext } from './tenantResolver';
import { sendAppointmentConfirmation, sendNewPatientForm, sendMapLink, sendSMS } from './sms';
import { saySafe, saySafeSSML, ttsGreeting, ttsThinking, ttsBookingConfirmed, ttsDirections, ttsGoodbye } from '../utils/voice-constants';
import { abs } from '../utils/url';
import { env } from '../utils/env';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { detectHandoffTrigger } from '../utils/handoff-detector';
import { processHandoff } from './handoff';
import type { Tenant } from '@shared/schema';

dayjs.extend(utc);
dayjs.extend(timezone);

// ═══════════════════════════════════════════════
// Conversation State Storage
// ═══════════════════════════════════════════════

/**
 * Save conversation context to database
 */
export async function saveConversationContext(
  callSid: string,
  context: ConversationContext
): Promise<void> {
  try {
    const call = await storage.getCallByCallSid(callSid);
    if (!call?.conversationId) {
      console.warn('[OpenAICallHandler] No conversation ID for call:', callSid);
      return;
    }

    await storage.updateConversation(call.conversationId, {
      context: context as any // JSONB field stores the entire context
    });

    console.log('[OpenAICallHandler] Saved conversation context for call:', callSid);
  } catch (error) {
    console.error('[OpenAICallHandler] Error saving conversation context:', error);
  }
}

/**
 * Load conversation context from database
 */
async function loadConversationContext(
  callSid: string,
  callerPhone: string,
  clinicName?: string
): Promise<ConversationContext | null> {
  try {
    const call = await storage.getCallByCallSid(callSid);
    if (!call?.conversationId) {
      console.log('[OpenAICallHandler] No existing conversation for call:', callSid);
      return null;
    }

    const conversation = await storage.getConversation(call.conversationId);
    if (!conversation?.context) {
      console.log('[OpenAICallHandler] No context stored for conversation:', call.conversationId);
      return null;
    }

    // Return stored context with validation
    const loadedContext = conversation.context as any as ConversationContext;

    // CRITICAL: Ensure history is a proper array (might be undefined/null from DB)
    if (!Array.isArray(loadedContext.history)) {
      console.warn('[OpenAICallHandler] Invalid history in stored context, initializing as empty array');
      loadedContext.history = [];
    }

    // CRITICAL: Ensure currentState is an object (might be undefined/null from DB)
    if (!loadedContext.currentState || typeof loadedContext.currentState !== 'object') {
      console.warn('[OpenAICallHandler] Invalid currentState in stored context, initializing as empty object');
      loadedContext.currentState = {};
    }

    return loadedContext;
  } catch (error) {
    console.error('[OpenAICallHandler] Error loading conversation context:', error);
    return null;
  }
}

/**
 * Get or create conversation context for this call
 */
export async function getOrCreateContext(
  callSid: string,
  callerPhone: string,
  tenantId?: number,
  clinicName?: string
): Promise<ConversationContext> {
  // Try to load existing context
  const existingContext = await loadConversationContext(callSid, callerPhone, clinicName);
  if (existingContext) {
    return existingContext;
  }

  // Create new context
  console.log('[OpenAICallHandler] Creating new conversation context for call:', callSid);

  // Check if caller phone matches existing patient - but DO NOT assume identity
  // Store as possiblePatientId and ask user to confirm
  let possiblePatientId: string | undefined;
  let possiblePatientName: string | undefined;
  if (tenantId) {
    try {
      const patient = await findPatientByPhoneRobust(callerPhone);
      if (patient) {
        const fullName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim();
        possiblePatientId = patient.id.toString();
        possiblePatientName = fullName || 'Unknown';
        console.log('[OpenAICallHandler] Found possible patient by phone (NOT assuming identity):', possiblePatientName);
        console.log('[OpenAICallHandler]   - Will ask user to confirm if booking for themselves or someone else');
      }
    } catch (error) {
      console.warn('[OpenAICallHandler] Error looking up patient:', error);
    }
  }

  const context = initializeConversation(callSid, callerPhone, clinicName);
  if (possiblePatientId) {
    context.possiblePatientId = possiblePatientId;
    context.possiblePatientName = possiblePatientName;
  }
  return context;
}

// ═══════════════════════════════════════════════
// Time Preference Parsing and Slot Fetching
// ═══════════════════════════════════════════════

/**
 * Parse natural language time preference into date range
 * Examples: "today afternoon", "tomorrow morning", "this afternoon at 4pm", "today at 4:00 p.m."
 */
function parseTimePreference(
  timePreferenceRaw: string | null,
  timezone: string = 'Australia/Brisbane'
): { start: Date; end: Date } | null {
  if (!timePreferenceRaw) return null;

  const now = dayjs().tz(timezone);
  const lower = timePreferenceRaw.toLowerCase();

  let start: dayjs.Dayjs;
  let end: dayjs.Dayjs;

  // Extract specific time if mentioned (e.g., "4pm", "4:00 p.m.", "10:30am")
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(?:a\.?m\.?|p\.?m\.?)/);
  let specificHour: number | null = null;
  let specificMinute = 0;

  if (timeMatch) {
    specificHour = parseInt(timeMatch[1], 10);
    specificMinute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;

    // Convert to 24-hour format
    if (lower.includes('p.m.') || lower.includes('pm')) {
      if (specificHour !== 12) specificHour += 12;
    } else if (lower.includes('a.m.') || lower.includes('am')) {
      if (specificHour === 12) specificHour = 0;
    }

    console.log('[parseTimePreference] Extracted specific time:', specificHour, ':', specificMinute);
  }

  // Determine base day
  let baseDay = now;
  if (lower.includes('today')) {
    baseDay = now; // Explicitly handle "today"
  } else if (lower.includes('tomorrow')) {
    baseDay = now.add(1, 'day');
  } else if (lower.includes('next week')) {
    baseDay = now.add(7, 'days');
  } else {
    // Check for day names (monday, tuesday, etc.)
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < dayNames.length; i++) {
      if (lower.includes(dayNames[i])) {
        // Find the next occurrence of this day
        const targetDay = i; // 0 = Sunday, 1 = Monday, etc.
        const currentDay = now.day();
        let daysToAdd = targetDay - currentDay;

        // If the day is today or in the past, move to next week
        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }

        baseDay = now.add(daysToAdd, 'day');
        console.log('[parseTimePreference] Found day name:', dayNames[i], '→', baseDay.format('YYYY-MM-DD'));
        break;
      }
    }
  }

  // If we have a specific time, narrow the range around it
  if (specificHour !== null) {
    start = baseDay.hour(specificHour).minute(specificMinute).second(0);
    // Search from 1 hour before to 2 hours after the requested time
    start = start.subtract(1, 'hour');
    end = baseDay.hour(specificHour).minute(specificMinute).add(2, 'hour');

    console.log('[parseTimePreference] Specific time range:', start.format('HH:mm'), 'to', end.format('HH:mm'));
  }
  // Otherwise use time-of-day ranges
  else if (lower.includes('morning')) {
    start = baseDay.hour(8).minute(0);
    end = baseDay.hour(12).minute(0);
  } else if (lower.includes('afternoon')) {
    start = baseDay.hour(12).minute(0);
    end = baseDay.hour(17).minute(0);
  } else if (lower.includes('evening')) {
    start = baseDay.hour(17).minute(0);
    end = baseDay.hour(20).minute(0);
  } else {
    // Default: business hours
    start = baseDay.hour(8).minute(0);
    end = baseDay.hour(18).minute(0);
  }

  // If start time is in the past, move to now
  if (start.isBefore(now)) {
    start = now;
  }

  console.log('[parseTimePreference] Final range:', start.format('YYYY-MM-DD HH:mm'), 'to', end.format('YYYY-MM-DD HH:mm'));

  return {
    start: start.toDate(),
    end: end.toDate()
  };
}

/**
 * Fetch available appointment slots from Cliniko
 * Uses compact state format (tp = time_preference, np = is_new_patient)
 *
 * MULTI-PRACTITIONER: Queries DB for active practitioners and fetches
 * availability across all of them, returning enriched slots with practitioner info.
 */
async function fetchAvailableSlots(
  state: Partial<CompactCallState>,
  tenantId?: number,
  timezone: string = 'Australia/Brisbane'
): Promise<EnrichedSlot[]> {
  if (!state.tp) {  // tp = time preference
    console.log('[OpenAICallHandler] No time preference, cannot fetch slots');
    return [];
  }

  const timeRange = parseTimePreference(state.tp, timezone);
  if (!timeRange) {
    console.warn('[OpenAICallHandler] Could not parse time preference:', state.tp);
    return [];
  }

  console.log('[OpenAICallHandler] Fetching slots from', timeRange.start, 'to', timeRange.end);

  try {
    const isNewPatient = state.np === true;  // np = is_new_patient

    // Get tenant context for Cliniko credentials
    let tenantCtx = undefined;
    let practitioners: Array<{ name: string; clinikoPractitionerId: string | null }> = [];

    if (tenantId) {
      // Fetch active practitioners from DB
      const dbPractitioners = await storage.getActivePractitioners(tenantId);
      practitioners = dbPractitioners.map(p => ({
        name: p.name,
        clinikoPractitionerId: p.clinikoPractitionerId
      }));

      // Get full tenant for Cliniko context
      const tenant = await storage.getTenantById(tenantId);
      if (tenant) {
        tenantCtx = getTenantContext(tenant);
      }

      console.log(`[OpenAICallHandler] Found ${practitioners.length} active practitioners for tenant ${tenantId}`);
    }

    // Use multi-practitioner availability if we have practitioners in DB
    if (practitioners.length > 0 && practitioners.some(p => p.clinikoPractitionerId)) {
      console.log('[OpenAICallHandler] Using multi-practitioner availability');

      const { slots } = await getMultiPractitionerAvailability(
        practitioners,
        {
          fromISO: timeRange.start.toISOString(),
          toISO: timeRange.end.toISOString(),
          timezone,
          tenantCtx,
          isNewPatient
        },
        3,  // maxSlots
        3   // concurrencyLimit
      );

      if (slots.length > 0) {
        // Ensure all slots have spokenTime (add if missing from multi-practitioner fetch)
        const { formatSpokenTime } = await import('../utils/time-formatter');
        for (const slot of slots) {
          if (!slot.spokenTime) {
            slot.spokenTime = formatSpokenTime(slot.startISO, timezone);
          }
        }
        console.log('[OpenAICallHandler] Found', slots.length, 'slots across practitioners:',
          slots.map(s => s.speakableWithPractitioner).join(', '));
        return slots;
      }

      console.log('[OpenAICallHandler] No slots found via multi-practitioner, falling back');
    }

    // Fallback: use single-practitioner getAvailability (env-based or default)
    console.log('[OpenAICallHandler] Using single-practitioner fallback');
    const availability = await getAvailability({
      fromISO: timeRange.start.toISOString(),
      toISO: timeRange.end.toISOString(),
      timezone,
      tenantCtx
    });

    if (!availability || !availability.slots || availability.slots.length === 0) {
      console.log('[OpenAICallHandler] No available slots found');
      return [];
    }

    // Get current time in the clinic's timezone
    const now = dayjs().tz(timezone);
    console.log('[OpenAICallHandler] Current time in', timezone, ':', now.format('h:mm A'));

    // Convert time range to dayjs for filtering
    const rangeStart = dayjs(timeRange.start).tz(timezone);
    const rangeEnd = dayjs(timeRange.end).tz(timezone);
    console.log('[OpenAICallHandler] Filtering slots within range:', rangeStart.format('h:mm A'), 'to', rangeEnd.format('h:mm A'));

    // Filter slots to:
    // 1. Be within the requested time range (e.g., afternoon 3pm-6pm)
    // 2. Be in the future (15 min buffer)
    const filteredSlots = availability.slots.filter((slot: { startISO: string }) => {
      const slotTime = dayjs(slot.startISO).tz(timezone);

      // Check if slot is within requested time range
      // Use >= and < comparison (slotTime >= rangeStart AND slotTime < rangeEnd)
      const withinRange = (slotTime.isAfter(rangeStart) || slotTime.isSame(rangeStart)) && slotTime.isBefore(rangeEnd);

      // Check if slot is in the future (15 min buffer)
      const isFuture = slotTime.isAfter(now.add(15, 'minute'));

      return withinRange && isFuture;
    });

    console.log('[OpenAICallHandler] Slots after time range filter:', filteredSlots.length);

    if (filteredSlots.length === 0) {
      console.log('[OpenAICallHandler] No slots available in requested time range');
      // Fallback: try to find ANY future slots if user's requested time has none
      const anyFutureSlots = availability.slots.filter((slot: { startISO: string }) => {
        const slotTime = dayjs(slot.startISO).tz(timezone);
        return slotTime.isAfter(now.add(15, 'minute'));
      });

      if (anyFutureSlots.length > 0) {
        console.log('[OpenAICallHandler] Falling back to', anyFutureSlots.length, 'future slots outside requested range');
        // Continue with these slots - AI can explain no afternoon slots available
      } else {
        console.log('[OpenAICallHandler] No future slots available at all');
        return [];
      }
    }

    const slotsToUse = filteredSlots.length > 0 ? filteredSlots : availability.slots.filter((slot: { startISO: string }) => {
      const slotTime = dayjs(slot.startISO).tz(timezone);
      return slotTime.isAfter(now.add(15, 'minute'));
    });

    // Convert to EnrichedSlot format (fallback uses env practitioner)
    const fallbackPractitionerName = env.CLINIKO_PRACTITIONER_NAME || 'the practitioner';
    const fallbackPractitionerId = env.CLINIKO_PRACTITIONER_ID || '';
    const fallbackApptTypeId = isNewPatient
      ? (env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID || '')
      : (env.CLINIKO_APPT_TYPE_ID || '');

    // Import time formatting utilities
    const { formatSlotTime, formatSpokenTime } = await import('../utils/time-formatter');
    
    const slots: EnrichedSlot[] = slotsToUse.slice(0, 3).map((slot: { startISO: string }) => {
      // Round to nearest 5 minutes and format naturally
      const speakable = formatSlotTime(slot.startISO, timezone); // e.g., "2:15 PM" (rounded)
      const spokenTime = formatSpokenTime(slot.startISO, timezone); // e.g., "two fifteen p m" for natural speech

      return {
        startISO: slot.startISO,
        speakable, // Rounded time for display: "9:45 AM"
        speakableWithPractitioner: `${speakable} with ${fallbackPractitionerName}`,
        spokenTime, // Natural spoken format: "nine forty-five a m" (for AI to use in responses)
        clinikoPractitionerId: fallbackPractitionerId,
        practitionerDisplayName: fallbackPractitionerName,
        appointmentTypeId: fallbackApptTypeId
      };
    });

    console.log('[OpenAICallHandler] Found', slots.length, 'future slots:', slots.map(s => s.speakable).join(', '));
    return slots;

  } catch (error) {
    console.error('[OpenAICallHandler] Error fetching availability:', error);
    return [];
  }
}

// ═══════════════════════════════════════════════
// Main Handler: Process User Utterance
// ═══════════════════════════════════════════════

export interface OpenAICallHandlerOptions {
  callSid: string;
  callerPhone: string;
  userUtterance: string;
  confidence?: number;  // Twilio speech recognition confidence (0.0-1.0)
  tenantId?: number;
  clinicName?: string;
  timezone?: string;
  googleMapsUrl?: string;  // Tenant's Google Maps URL for directions
  practitionerName?: string;  // Practitioner name for "who will I see" question (deprecated - now uses tenantInfo)
  clinicAddress?: string;  // Clinic address for fallback map link
}

/**
 * Main handler function for OpenAI-powered conversation
 * Returns TwiML VoiceResponse
 */
export async function handleOpenAIConversation(
  options: OpenAICallHandlerOptions
): Promise<twilio.twiml.VoiceResponse> {
  const { callSid, callerPhone, userUtterance, confidence, tenantId, clinicName, timezone = 'Australia/Brisbane', googleMapsUrl, practitionerName, clinicAddress } = options;

  const vr = new twilio.twiml.VoiceResponse();

  console.log('[OpenAICallHandler] Processing utterance:', userUtterance);
  console.log('[OpenAICallHandler] Call SID:', callSid);
  console.log('[OpenAICallHandler] Confidence:', confidence);

  try {
    // 1. Load or create conversation context
    let context = await getOrCreateContext(callSid, callerPhone, tenantId, clinicName);

    // COMPREHENSIVE DEBUG: Log current state for troubleshooting
    console.log(`[OpenAICallHandler] ═══════════════════════════════════════════`);
    console.log(`[OpenAICallHandler] 📞 TURN START - callSid: ${callSid}`);
    console.log(`[OpenAICallHandler] 📊 State: intent=${context.currentState?.im || 'none'}, stage=${context.bookingStage || 'none'}`);
    console.log(`[OpenAICallHandler] 🔒 Locks: intentLocked=${context.intentLocked}, sharedPhoneResolved=${context.sharedPhoneResolved}, identityResolved=${context.identityResolved}`);
    console.log(`[OpenAICallHandler] 📝 Patient: possible=${context.possiblePatientName || 'none'}, confirmed=${context.confirmedPatientId || 'none'}`);
    console.log(`[OpenAICallHandler] 📋 Counters: noiseCount=${context.noiseCount || 0}, emptyCount=${context.emptyCount || 0}`);
    console.log(`[OpenAICallHandler] ═══════════════════════════════════════════`);

    // 1a. Handle low confidence (background noise)
    // Track noiseCount separately from emptyCount
    if (!context.noiseCount) {
      context.noiseCount = 0;
    }
    
    const isLowConfidence = confidence !== undefined && confidence < 0.55;
    const hasValidSpeech = userUtterance && userUtterance.trim();

    // DEBUG: Log speech confidence for troubleshooting
    console.log(`[OpenAICallHandler] 📊 Speech: "${userUtterance}", confidence: ${confidence}, isLowConfidence: ${isLowConfidence}`);

    // CRITICAL: Whitelist common short responses that often get low confidence from Twilio
    // These are valid responses that should NOT be treated as background noise
    const whitelistedShortResponses = [
      'yes', 'yep', 'yup', 'yeah', 'ya', 'uh huh', 'uh-huh', 'mm hmm', 'mmhmm', 'mhm',
      'no', 'nope', 'nah', 'na',
      'ok', 'okay', 'right', 'correct', 'sure', 'alright', 'fine',
      'thanks', 'thank you', 'bye', 'goodbye', 'cheers',
      'one', 'two', 'three', 'first', 'second', 'third',
      'same number', 'same', 'this number', 'that one', 'this one',
      'myself', 'for me', 'for myself', 'someone else', 'my child', 'my son', 'my daughter',
      'today', 'tomorrow', 'morning', 'afternoon', 'evening',
      'that works', 'sounds good', 'perfect', 'great',
      // Additional common responses that might get low confidence
      "that's right", "thats right", "that's correct", "thats correct",
      "that's me", "thats me", "it is", "i am", "speaking",
      "been before", "first time", "new patient", "existing",
      "book", "appointment", "cancel", "reschedule"
    ];
    // Strip punctuation for matching (handles "Yes." vs "yes")
    const utteranceLower = (userUtterance || '').toLowerCase().trim().replace(/[.,!?;:'"]/g, '');
    const isWhitelistedResponse = whitelistedShortResponses.some(phrase =>
      utteranceLower === phrase ||
      utteranceLower.startsWith(phrase + ' ') ||
      utteranceLower.endsWith(' ' + phrase) ||
      utteranceLower.includes(phrase)  // Also check if phrase is contained anywhere
    );

    if (isWhitelistedResponse) {
      console.log(`[OpenAICallHandler] ✅ Whitelisted response detected: "${utteranceLower}"`);
    }

    // GUARDRAIL: Suppress noise detection after OFFER_SLOTS stage or after booking confirmed
    // At this point, we're in critical confirmation flow - never say "background noise"
    const isInConfirmationFlow = isPastStage(context, BookingStage.COLLECT_TIME) ||
                                  context.currentState.bc === true ||
                                  context.currentState.appointmentCreated === true;

    if (isInConfirmationFlow && isLowConfidence) {
      console.log(`[OpenAICallHandler] 🛡️ GUARDRAIL: Suppressing noise detection (stage=${context.bookingStage}, bc=${context.currentState.bc})`);
    }

    // If we get a valid whitelisted response, reset noise count (conversation is flowing)
    if (isWhitelistedResponse && hasValidSpeech) {
      if (context.noiseCount > 0) {
        console.log(`[OpenAICallHandler] ✅ Whitelisted response "${utteranceLower}" - resetting noiseCount from ${context.noiseCount} to 0`);
        context.noiseCount = 0;
      }
    }

    // Only trigger noise handling if NOT in confirmation flow
    if (isLowConfidence && hasValidSpeech && !isWhitelistedResponse && !isInConfirmationFlow) {
      // Low confidence but got some speech that's NOT a known short response - likely background noise
      context.noiseCount = (context.noiseCount || 0) + 1;
      console.log('[OpenAICallHandler] ⚠️ Low confidence detected (background noise?), noiseCount:', context.noiseCount);
      
      if (context.noiseCount >= 2) {
        // After 2 low-confidence turns, offer DETERMINISTIC fallback
        console.log('[OpenAICallHandler] 🔄 Multiple low-confidence turns detected - triggering SMS fallback');

        // Send booking link SMS immediately
        const publicUrl = env.PUBLIC_BASE_URL || 'http://localhost:3000';
        const bookingLink = `${publicUrl}/book/${callSid}`;
        const smsMessage = `Thanks for calling ${clinicName || 'the clinic'}! Complete your booking here: ${bookingLink}`;

        try {
          await sendSMS(callerPhone, smsMessage, tenantId);
          console.log('[OpenAICallHandler] ✅ Fallback booking link SMS sent');
          context.currentState.sl = true;
        } catch (error) {
          console.error('[OpenAICallHandler] Error sending fallback SMS:', error);
        }

        saySafe(vr, "Sorry — I'm getting a lot of background noise. No worries — I've just sent you a text with a link to complete your booking. If you'd prefer a callback from reception, just let me know. Otherwise, have a great day!");

        const gather = vr.gather({
          input: ['speech'],
          timeout: 8,
          speechTimeout: 'auto',
          action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
          method: 'POST',
          enhanced: true,
          speechModel: 'phone_call'
        });

        // Reset noiseCount after offering fallback
        context.noiseCount = 0;
        await saveConversationContext(callSid, context);

        return vr; // Return early with TwiML
      } else {
        // Reprompt with noise-aware message
        saySafe(vr, "Sorry — I'm getting a bit of background noise. Could you say that again?");
        const gather = vr.gather({
          input: ['speech'],
          timeout: 8,
          speechTimeout: 'auto',
          action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
          method: 'POST',
          enhanced: true,
          speechModel: 'phone_call'
        });
        
        await saveConversationContext(callSid, context);
        return vr; // Return early with TwiML
      }
    }
    
    // Reset counters when we receive valid speech with good confidence
    if (hasValidSpeech && !isLowConfidence) {
      context.emptyCount = 0;
      context.noiseCount = 0;
    }
    
    // Reset emptyCount when we receive valid speech
    if (userUtterance && userUtterance.trim()) {
      // Already handled above for low confidence, but ensure it's reset for good confidence
      if (!isLowConfidence) {
        context.emptyCount = 0;
      }
    }

    // DEFENSIVE: Ensure currentState exists
    if (!context.currentState) {
      context.currentState = {};
    }

    // 1a-2. "SEND ME A LINK" CONTEXT ROUTING
    // CRITICAL: If user says "send me a link" during booking flow, interpret as booking link, NOT directions
    const utteranceLowerCheck = userUtterance.toLowerCase().trim();
    const wantsSmsLink = utteranceLowerCheck.includes('send me a link') ||
                         utteranceLowerCheck.includes('text me a link') ||
                         utteranceLowerCheck.includes('send a link') ||
                         utteranceLowerCheck.includes('text a link') ||
                         (utteranceLowerCheck.includes('send') && utteranceLowerCheck.includes('link'));

    // Check if we're in a booking context
    const inBookingContext = context.currentState.im === 'book' ||
                             context.intentLocked === true ||
                             context.availableSlots !== undefined ||
                             context.bookingStage !== undefined;

    // Check if user explicitly wants directions/map
    const wantsDirections = utteranceLowerCheck.includes('direction') ||
                            utteranceLowerCheck.includes('map') ||
                            utteranceLowerCheck.includes('location') ||
                            utteranceLowerCheck.includes('where are you') ||
                            utteranceLowerCheck.includes('how do i get');

    if (wantsSmsLink && inBookingContext && !wantsDirections) {
      console.log('[OpenAICallHandler] 📱 "Send me a link" detected IN BOOKING CONTEXT - sending booking link');

      // Send booking link via SMS
      const publicUrl = env.PUBLIC_BASE_URL || 'http://localhost:3000';
      const bookingLink = `${publicUrl}/book/${callSid}`;
      const smsMessage = `Thanks for calling ${clinicName || 'the clinic'}! Complete your booking here: ${bookingLink}`;

      try {
        await sendSMS(callerPhone, smsMessage, tenantId);
        console.log('[OpenAICallHandler] ✅ Booking link SMS sent');
        context.currentState.sl = true; // Mark SMS link sent
        await saveConversationContext(callSid, context);

        // Respond and end cleanly
        saySafe(vr, "Perfect — I've just sent you a text with a link to complete your booking. You should receive it in just a moment. Is there anything else I can help with?");
        const gather = vr.gather({
          input: ['speech'],
          timeout: 8,
          speechTimeout: 'auto',
          action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
          method: 'POST',
          enhanced: true,
          speechModel: 'phone_call'
        });

        return vr;
      } catch (error) {
        console.error('[OpenAICallHandler] Error sending booking link SMS:', error);
        // Fall through to normal AI handling
      }
    }

    // 1b. Populate tenantInfo for AI context (if not already set)
    if (!context.tenantInfo && tenantId) {
      const tenant = await storage.getTenantById(tenantId);
      if (tenant) {
        // Get practitioner names from DB
        const practitioners = await storage.getActivePractitioners(tenantId);
        const practitionerNames = practitioners.map(p => p.name);

        context.tenantInfo = {
          clinicName: tenant.clinicName || clinicName || 'the clinic',
          address: clinicAddress || (tenant as any).address,
          hasMapsLink: !!(googleMapsUrl || (tenant as any).googleMapsUrl),
          practitionerNames,
          timezone
        };

        console.log('[OpenAICallHandler] Set tenantInfo:', context.tenantInfo);
      }
    }

    // Set practitioner name in context (for "who will I see" question - legacy fallback)
    if (practitionerName && !context.tenantInfo?.practitionerNames?.length) {
      context.practitionerName = practitionerName;
    }

    // 2. PROACTIVE slot fetching: If we have enough info, fetch slots BEFORE calling AI
    //    This allows AI to offer real slots in the same turn
    const hasIntent = context.currentState.im === 'book';
    const hasTimePreference = !!context.currentState.tp;
    const hasNewPatientStatus = context.currentState.np !== null && context.currentState.np !== undefined;
    const shouldFetchSlots = hasIntent && hasTimePreference && hasNewPatientStatus && !context.availableSlots;

    if (shouldFetchSlots) {
      console.log('[OpenAICallHandler] Proactively fetching appointment slots (have all required info)...');
      const slots = await fetchAvailableSlots(context.currentState, tenantId, timezone);
      // Always limit to top 3 slots for offering
      context.availableSlots = slots.slice(0, 3);
      console.log('[OpenAICallHandler] Fetched', slots.length, 'slots, offering top', context.availableSlots.length, 'options');
    }

    // 2b. RESCHEDULE/CANCEL: Look up upcoming appointment if intent is change or cancel
    // CRITICAL: Only look up ONCE per intent, cache result
    const isRescheduleOrCancel = context.currentState.im === 'change' || context.currentState.im === 'cancel';
    if (isRescheduleOrCancel && !context.upcomingAppointment && !context.appointmentLookupDone) {
      console.log('[OpenAICallHandler] 🔍 Looking up upcoming appointment for reschedule/cancel (ONCE)...');
      context.appointmentLookupDone = true; // Mark as done to prevent re-lookup
      try {
        // First find the patient
        const patient = await findPatientByPhoneRobust(callerPhone);
        if (patient) {
          const upcoming = await getNextUpcomingAppointment(patient.id);
          if (upcoming) {
            const apptTime = dayjs(upcoming.starts_at).tz(timezone);
            context.upcomingAppointment = {
              id: upcoming.id,
              practitionerId: upcoming.practitioner_id,
              appointmentTypeId: upcoming.appointment_type_id,
              startsAt: upcoming.starts_at,
              speakable: apptTime.format('dddd [at] h:mm A') // e.g., "Thursday at 2:30 PM"
            };
            console.log('[OpenAICallHandler] ✅ Found upcoming appointment:', context.upcomingAppointment.speakable);
          } else {
            console.log('[OpenAICallHandler] ⚠️ No upcoming appointment found - will offer clean exit');
            context.noAppointmentFound = true;
          }
        } else {
          console.log('[OpenAICallHandler] ⚠️ Patient not found in Cliniko - will offer clean exit');
          context.noAppointmentFound = true;
        }
      } catch (error) {
        console.error('[OpenAICallHandler] Error looking up appointment:', error);
        context.noAppointmentFound = true;
      }
      await saveConversationContext(callSid, context);

      // CLEAN EXIT: If no appointment found, tell caller and exit gracefully
      if (context.noAppointmentFound) {
        saySafe(vr, "I don't see any upcoming appointments under this phone number. Would you like to book a new appointment instead?");
        const gather = vr.gather({
          input: ['speech'],
          timeout: 8,
          speechTimeout: 'auto',
          action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
          method: 'POST',
          enhanced: true,
          speechModel: 'phone_call',
          hints: 'yes, no, book, appointment'
        });
        return vr;
      }
    }

    // 2c. HANDOFF DETECTION: Check for handoff triggers BEFORE calling AI
    //     This allows us to bypass AI and go straight to handoff if needed
    const tenant: Tenant | null = tenantId ? (await storage.getTenantById(tenantId)) ?? null : null;
    const handoffDetection = detectHandoffTrigger(
      userUtterance,
      context.history || [],
      {
        noMatchCount: context.emptyCount || 0,
        confidence: 1.0, // Will be updated after AI response
        isOutOfScope: false, // Will be updated after AI response
        hasClinikoError: false // Will be checked after Cliniko calls
      }
    );
    
    // TERMINAL STATE: After booking confirmed, only allow price/directions/website questions
    // Never trigger handoff, callback, or SMS fallback after confirmation
    const isTerminalState = context.currentState.appointmentCreated === true;

    // If explicit request or profanity detected, trigger handoff immediately
    // BUT NOT if we're in terminal state (booking already confirmed)
    if (handoffDetection.shouldTrigger &&
        (handoffDetection.trigger === 'explicit_request' || handoffDetection.trigger === 'profanity') &&
        !isTerminalState) {
      console.log('[OpenAICallHandler] 🚨 Handoff trigger detected:', handoffDetection.trigger, handoffDetection.reason);
      await processHandoff(vr, callSid, callerPhone, tenant, handoffDetection.trigger || 'unknown', handoffDetection.reason || '');
      return vr;
    } else if (handoffDetection.shouldTrigger && isTerminalState) {
      console.log('[OpenAICallHandler] 🛡️ TERMINAL STATE: Blocking handoff after booking confirmed');
    }

    // 3. Call OpenAI receptionist brain
    const response = await callReceptionistBrain(context, userUtterance);

    console.log('[OpenAICallHandler] Reply:', response.reply);
    console.log('[OpenAICallHandler] Compact state:', JSON.stringify(response.state, null, 2));

    // 3a-0. Handle shared phone disambiguation (booking for yourself or someone else)
    // CRITICAL: This ONLY triggers ONCE, early in the flow, and NEVER after slot selection
    let finalResponse = response;

    // GUARD 1: Never trigger shared phone after it's resolved
    // GUARD 2: Never trigger shared phone after slot selection (si is set)
    // GUARD 3: Never trigger shared phone after booking is complete
    const slotAlreadySelected = context.currentState.si !== undefined && context.currentState.si !== null;
    const bookingComplete = context.currentState.appointmentCreated === true || context.currentState.bc === true;
    const sharedPhoneAlreadyResolved = context.sharedPhoneResolved === true;

    if (context.possiblePatientId && !context.confirmedPatientId && !context.sharedPhoneDisambiguation?.answer
        && !sharedPhoneAlreadyResolved && !slotAlreadySelected && !bookingComplete) {
      // We have a possible patient but haven't asked yet - ask now
      if (!context.sharedPhoneDisambiguation?.asked) {
        // LOOP PREVENTION: Check if we should ask this question
        if (!shouldAskQuestion(context, 'shared_phone_disambiguation')) {
          console.log('[OpenAICallHandler] ⚠️ Max asks reached for shared_phone_disambiguation - skipping to fallback');
          // Clear possible patient and proceed as new patient
          context.possiblePatientId = undefined;
          context.possiblePatientName = undefined;
          context = resolveSharedPhone(context);
          await saveConversationContext(callSid, context);
        } else {
          console.log('[OpenAICallHandler] 📞 Shared phone detected - asking if booking for themselves or someone else');
          console.log('[OpenAICallHandler]   - Possible patient:', context.possiblePatientName, '(ID:', context.possiblePatientId, ')');

          context.sharedPhoneDisambiguation = {
            asked: true
          };
          context = incrementQuestionCount(context, 'shared_phone_disambiguation');
          context = advanceBookingStage(context, BookingStage.SHARED_PHONE);
          await saveConversationContext(callSid, context);

          finalResponse = {
            reply: `I see this number in our system — are you booking for yourself, or for someone else, like a child or family member?`,
            expect_user_reply: true,
            state: {
              ...response.state,
              bc: false // Don't book yet - need identity confirmation
            }
          };
        }
      } else {
        // We've asked but haven't gotten an answer yet - parse the response
        const utteranceLower = userUtterance.toLowerCase().trim();
        
        // Check for "myself" / "me" / "yes" (for myself)
        const isMyself = utteranceLower.includes('myself') || 
                         utteranceLower.includes('for me') ||
                         utteranceLower.includes('yes') && (utteranceLower.includes('me') || utteranceLower.includes('myself')) ||
                         utteranceLower.includes("i'm") && utteranceLower.includes('booking') ||
                         utteranceLower.includes('i am') && utteranceLower.includes('booking');
        
        // Check for "someone else" / "child" / "daughter" / "son" / "no" (for someone else)
        const isSomeoneElse = utteranceLower.includes('someone else') ||
                              utteranceLower.includes('for someone') ||
                              utteranceLower.includes('child') ||
                              utteranceLower.includes('daughter') ||
                              utteranceLower.includes('son') ||
                              utteranceLower.includes('kid') ||
                              utteranceLower.includes('family member') ||
                              utteranceLower.includes('my ') && (utteranceLower.includes('child') || utteranceLower.includes('daughter') || utteranceLower.includes('son')) ||
                              (utteranceLower.includes('no') && !utteranceLower.includes('yes'));
        
        if (isMyself) {
          console.log('[OpenAICallHandler] ✅ User confirmed booking for themselves');
          context.sharedPhoneDisambiguation.answer = 'myself';
          // Don't resolve yet - need name confirmation first
          context = advanceBookingStage(context, BookingStage.COLLECT_NAME);
          await saveConversationContext(callSid, context);

          // Ask for full name to confirm against candidate patient
          finalResponse = {
            reply: `Thanks for confirming. What's your full name?`,
            expect_user_reply: true,
            state: {
              ...response.state,
              bc: false // Don't book yet - need name confirmation
            }
          };
        } else if (isSomeoneElse) {
          console.log('[OpenAICallHandler] ✅ User confirmed booking for someone else');
          // RESOLVE shared phone - this person is NOT the patient on file
          context.possiblePatientId = undefined;
          context.possiblePatientName = undefined;
          context = resolveSharedPhone(context);
          context = advanceBookingStage(context, BookingStage.COLLECT_NAME);
          await saveConversationContext(callSid, context);

          // Ask for the patient's full name
          finalResponse = {
            reply: `No worries. What's the full name of the person you're booking for?`,
            expect_user_reply: true,
            state: {
              ...response.state,
              np: true, // Treat as new patient unless clear match found
              bc: false // Don't book yet - need name
            }
          };
        } else {
          // Unclear response - check if we've asked too many times
          const askCount = getQuestionCount(context, 'shared_phone_disambiguation');
          if (askCount >= 2) {
            console.log('[OpenAICallHandler] ⚠️ Max asks for shared_phone_disambiguation - proceeding as new patient');
            context.possiblePatientId = undefined;
            context.possiblePatientName = undefined;
            context = resolveSharedPhone(context);
            await saveConversationContext(callSid, context);

            // Skip disambiguation and proceed as new patient
            finalResponse = {
              reply: `No worries. What's your full name?`,
              expect_user_reply: true,
              state: {
                ...response.state,
                np: true,
                bc: false
              }
            };
          } else {
            // Ask again
            console.log('[OpenAICallHandler] ⚠️  Unclear shared phone response - asking again');
            context = incrementQuestionCount(context, 'shared_phone_disambiguation');
            await saveConversationContext(callSid, context);

            finalResponse = {
              reply: `Just to confirm — are you booking for yourself, or for someone else?`,
              expect_user_reply: true,
              state: {
                ...response.state,
                bc: false
              }
            };
          }
        }
      }
    } else if (context.sharedPhoneDisambiguation?.answer === 'myself' && !context.confirmedPatientId && response.state.nm && !sharedPhoneAlreadyResolved) {
      // User said "myself" and provided name - check if it matches possible patient
      const providedName = response.state.nm.trim();
      const possibleName = context.possiblePatientName || '';
      
      console.log('[OpenAICallHandler] 🔍 Checking name match for "myself" booking:');
      console.log('[OpenAICallHandler]   - Provided name:', providedName);
      console.log('[OpenAICallHandler]   - Possible patient name:', possibleName);
      
      const { calculateNameSimilarity } = await import('../utils/name-matcher');
      const similarity = calculateNameSimilarity(providedName, possibleName);
      
      if (similarity >= 0.7) {
        // Names match - confirm identity and RESOLVE shared phone
        console.log('[OpenAICallHandler] ✅ Name matches possible patient - confirming identity');
        context.confirmedPatientId = context.possiblePatientId;
        context = resolveSharedPhone(context);
        context = resolveIdentity(context);
        context = advanceBookingStage(context, BookingStage.COLLECT_TIME);
        await saveConversationContext(callSid, context);

        // Continue with booking as existing patient
        finalResponse = {
          ...response,
          state: {
            ...response.state,
            np: false, // Existing patient
            bc: response.state.bc // Preserve booking state
          }
        };
      } else {
        // Names don't match - different person, RESOLVE shared phone
        console.log('[OpenAICallHandler] ❌ Name mismatch - treating as new patient');
        context.possiblePatientId = undefined;
        context.possiblePatientName = undefined;
        context = resolveSharedPhone(context);
        context = advanceBookingStage(context, BookingStage.COLLECT_TIME);
        await saveConversationContext(callSid, context);

        // Continue as new patient
        finalResponse = {
          ...response,
          state: {
            ...response.state,
            np: true, // New patient
            bc: response.state.bc
          }
        };
      }
    } else if (context.sharedPhoneDisambiguation?.answer === 'someone_else' && response.state.nm && !sharedPhoneAlreadyResolved) {
      // User selected "someone else" and provided the patient's name - RESOLVE shared phone
      console.log('[OpenAICallHandler] ✅ Name collected for "someone else" booking - resolving shared phone');
      context = resolveSharedPhone(context);
      context = advanceBookingStage(context, BookingStage.COLLECT_TIME);
      await saveConversationContext(callSid, context);
      
      // Continue with booking as new patient (name already in response.state.nm)
      finalResponse = {
        ...response,
        state: {
          ...response.state,
          np: true, // New patient (someone else)
          bc: response.state.bc // Preserve booking state
        }
      };
    }

    // 3a. Handle name disambiguation response if pending
    // GUARD: Never re-ask identity if already resolved
    if (context.nameDisambiguation && !context.identityResolved) {
      // Use improved yes/no classification with NO-wins precedence
      const { classifyYesNo } = await import('../utils/speech-helpers');
      const yesNoResult = classifyYesNo(userUtterance);

      console.log('[OpenAICallHandler] Name disambiguation response:', {
        utterance: userUtterance,
        yesNoResult,
        existingName: context.nameDisambiguation.existingName,
        spokenName: context.nameDisambiguation.spokenName
      });

      if (yesNoResult === 'yes') {
        // Confirmed - use existing patient, RESOLVE identity
        console.log('[OpenAICallHandler] ✅ Name confirmed - using existing patient without name update');
        const existingName = context.nameDisambiguation.existingName;
        const preservedBc = context.nameDisambiguation.preservedBc;
        const preservedSi = context.nameDisambiguation.preservedSi;
        context = resolveIdentity(context);
        await saveConversationContext(callSid, context);
        // Proceed with booking using existing patient
        finalResponse = {
          ...response,
          state: {
            ...response.state,
            nm: existingName,
            bc: preservedBc !== undefined ? preservedBc : response.state.bc,
            si: preservedSi !== undefined ? preservedSi : response.state.si
          }
        };
        console.log('[OpenAICallHandler] 📋 Restored booking state:', { bc: preservedBc, si: preservedSi });
      } else if (yesNoResult === 'no') {
        // Different person - RESOLVE identity, proceed as new patient
        const existingName = context.nameDisambiguation.existingName;
        const spokenName = context.nameDisambiguation.spokenName;

        console.log('[OpenAICallHandler] ❌ Different person detected - continuing booking as new patient');
        context = resolveIdentity(context);
        context.currentState.identityMismatchRecovery = true;
        await saveConversationContext(callSid, context);

        // Continue booking as new patient - ask for phone and email
        finalResponse = {
          reply: "No worries — this number was previously used by someone else. I can still book you in. What's the best mobile number for you? You can say 'same number' if it's yours. And what email should I use for your confirmation?",
          expect_user_reply: true,
          state: {
            ...response.state,
            np: true,
            bc: false,
            si: null
          }
        };

        console.log('[OpenAICallHandler] 📝 Identity mismatch event logged (no handoff):', {
          existingName,
          spokenName,
          callerPhone
        });
      } else {
        // Unclear response - check if we've asked too many times
        const askCount = getQuestionCount(context, 'identity_confirmation');
        if (askCount >= 2) {
          console.log('[OpenAICallHandler] ⚠️ Max asks for identity_confirmation - proceeding as new patient');
          context = resolveIdentity(context);
          context.currentState.identityMismatchRecovery = true;
          await saveConversationContext(callSid, context);

          finalResponse = {
            reply: "No worries — I'll book you in as a new patient. What's your full name?",
            expect_user_reply: true,
            state: {
              ...response.state,
              np: true,
              bc: false
            }
          };
        } else if (context.nameDisambiguation) {
          // Ask again (only if nameDisambiguation is still defined)
          const existingName = context.nameDisambiguation.existingName;
          console.log('[OpenAICallHandler] ⚠️  Unclear disambiguation response - asking again');
          context = incrementQuestionCount(context, 'identity_confirmation');
          await saveConversationContext(callSid, context);

          finalResponse = {
            reply: `Just to confirm — are you ${existingName}?`,
            expect_user_reply: true,
            state: {
              ...response.state,
              bc: false
            }
          };
        }
      }
    }

    // 3a-2. Handle identity mismatch recovery (collecting phone/email after "no" to disambiguation)
    if (context.currentState.identityMismatchRecovery && !context.nameDisambiguation) {
      console.log('[OpenAICallHandler] 🔄 Identity mismatch recovery - extracting phone and email');
      
      // Extract phone and email from user utterance
      const utteranceLower = userUtterance.toLowerCase();
      
      // Check for "same number" or phone number patterns
      // Also check if phone was already collected in a previous turn
      let phoneProvided = false;
      let newPhone: string | undefined = undefined;
      
      // First, check if phone was already collected from previous turn
      if (context.currentState.pc === true) {
        phoneProvided = true;
        // Use recoveryPhone if set, otherwise use callerPhone
        newPhone = (context.currentState as any).recoveryPhone || callerPhone;
        console.log('[OpenAICallHandler]   - Phone already collected from previous turn:', newPhone);
      } else if (utteranceLower.includes('same number') || utteranceLower.includes('same') || utteranceLower.includes('this number')) {
        phoneProvided = true;
        newPhone = callerPhone; // Use current caller phone
        console.log('[OpenAICallHandler]   - User said "same number" - using caller phone:', callerPhone);
      } else {
        // Try to extract phone number from utterance (basic pattern matching)
        const phonePattern = /(\+?\d{1,3}[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/;
        const phoneMatch = userUtterance.match(phonePattern);
        if (phoneMatch) {
          phoneProvided = true;
          newPhone = phoneMatch[0].replace(/[\s\-\(\)]/g, '');
          console.log('[OpenAICallHandler]   - Extracted phone from utterance:', newPhone);
        }
      }
      
      // Extract email from utterance
      const emailPattern = /[\w\.-]+@[\w\.-]+\.\w+/i;
      const emailMatch = userUtterance.match(emailPattern);
      const emailProvided = !!emailMatch;
      const extractedEmail = emailMatch ? emailMatch[0] : undefined;
      
      console.log('[OpenAICallHandler]   - Phone provided:', phoneProvided, newPhone);
      console.log('[OpenAICallHandler]   - Email provided:', emailProvided, extractedEmail);
      
      // If we have both phone and email, clear recovery flag and continue booking
      if (phoneProvided && emailProvided && newPhone && extractedEmail) {
        console.log('[OpenAICallHandler] ✅ Phone and email collected - clearing recovery flag');
        context.currentState.identityMismatchRecovery = false;
        context.currentState.pc = true; // Phone confirmed
        context.currentState.em = extractedEmail;
        // Update caller phone if different
        if (newPhone !== callerPhone) {
          console.log('[OpenAICallHandler]   - New phone number provided:', newPhone);
          // Note: We can't change callerPhone in context, but we'll use newPhone when creating patient
          (context.currentState as any).recoveryPhone = newPhone;
        }
        await saveConversationContext(callSid, context);
        
        // Continue with booking - AI should proceed normally now
        finalResponse = {
          ...response,
          state: {
            ...response.state,
            np: true, // Ensure marked as new patient
            pc: true,
            em: extractedEmail,
            identityMismatchRecovery: false
          }
        };
      } else if (phoneProvided && newPhone) {
        // Have phone but need email
        console.log('[OpenAICallHandler]   - Phone collected, still need email');
        // CRITICAL: Persist pc to context before saving so it's available on next turn
        context.currentState.pc = true;
        if (newPhone !== callerPhone) {
          (context.currentState as any).recoveryPhone = newPhone;
        }
        await saveConversationContext(callSid, context);
        
        finalResponse = {
          reply: "Great, I've got your number. What email should I use for your confirmation?",
          expect_user_reply: true,
          state: {
            ...response.state,
            np: true,
            pc: true,
            identityMismatchRecovery: true // Keep flag until email collected
          }
        };
      } else if (context.currentState.pc === true && emailProvided && extractedEmail) {
        // Phone was already collected from previous turn, now we have email
        console.log('[OpenAICallHandler] ✅ Phone already collected, email now provided - clearing recovery flag');
        context.currentState.identityMismatchRecovery = false;
        context.currentState.em = extractedEmail;
        await saveConversationContext(callSid, context);
        
        // Continue with booking - AI should proceed normally now
        finalResponse = {
          ...response,
          state: {
            ...response.state,
            np: true, // Ensure marked as new patient
            pc: true,
            em: extractedEmail,
            identityMismatchRecovery: false
          }
        };
      } else if (context.currentState.pc === true) {
        // Phone already collected, but still need email
        console.log('[OpenAICallHandler]   - Phone already collected, still need email');
        finalResponse = {
          reply: "What email should I use for your confirmation?",
          expect_user_reply: true,
          state: {
            ...response.state,
            np: true,
            pc: true,
            identityMismatchRecovery: true // Keep flag until email collected
          }
        };
      } else {
        // Still need phone (and possibly email)
        console.log('[OpenAICallHandler]   - Still need phone and email');
        finalResponse = {
          reply: "I didn't catch your phone number. What's the best mobile number for you? You can say 'same number' if it's yours. And what email should I use?",
          expect_user_reply: true,
          state: {
            ...response.state,
            np: true,
            identityMismatchRecovery: true
          }
        };
      }
    }

    // 3b. CRITICAL: Override AI response if it missed detecting new/existing patient status that user mentioned
    //     This handles cases where AI asks about new/existing even though user already said it
    // Note: finalResponse may already be set by disambiguation handler above
    if (!finalResponse) {
      finalResponse = response;
    }
    const mergedStateForDetection = { ...context.currentState, ...response.state };
    
    // Check if user mentioned new/existing status but AI didn't capture it (np is still null)
    if (mergedStateForDetection.np === null || mergedStateForDetection.np === undefined) {
      const utteranceLower = userUtterance.toLowerCase();
      // Comprehensive patterns for detecting "new patient" / "first visit" mentions
      // Check for variations including apostrophes and contractions
      const mentionedNew = 
        utteranceLower.includes('new patient') || 
        utteranceLower.includes('first visit') || 
        utteranceLower.includes('first time') || 
        utteranceLower.includes('never been') ||
        utteranceLower.includes("haven't been there") || utteranceLower.includes("havent been there") ||
        utteranceLower.includes("haven't been to") || utteranceLower.includes("havent been to") ||
        utteranceLower.includes("haven't been here") || utteranceLower.includes("havent been here") ||
        utteranceLower.includes("haven't been before") || utteranceLower.includes("havent been before") ||
        utteranceLower.includes("haven't been in") || utteranceLower.includes("havent been in") ||
        utteranceLower.includes("haven't been in before") || utteranceLower.includes("havent been in before") ||
        utteranceLower.includes("i haven't been") || utteranceLower.includes("i havent been") ||
        utteranceLower.includes('not been there') ||
        utteranceLower.includes('not been to') ||
        utteranceLower.includes('not been here') ||
        utteranceLower.includes('not been before') ||
        utteranceLower.includes('have not been there') ||
        utteranceLower.includes('have not been to') ||
        utteranceLower.includes('have not been here') ||
        utteranceLower.includes('have not been before') ||
        utteranceLower.includes('i have not been') ||
        utteranceLower.includes('new to the clinic') ||
        utteranceLower.includes('new here');
      // More specific patterns to avoid false positives:
      // - 'been there' alone could match "I've been there for 5 years" (not patient-related)
      // - 'been here' alone could match "I've been here since 9am" (not patient-related)
      // - 'existing' alone could match "existing condition" (not patient-related)
      // - 'i've been' alone could match "I've been having back pain" (not patient-related)
      // - 'not been' alone could match "It's not been easy" or "It hasn't been long" (not patient-related)
      // - 'have not been' alone could match "I have not been feeling well" (not patient-related)
      const mentionedExisting = utteranceLower.includes('been before') || 
                                utteranceLower.includes('existing patient') ||
                                utteranceLower.includes('been there before') ||
                                utteranceLower.includes('been here before') ||
                                utteranceLower.includes('returning patient') ||
                                utteranceLower.includes('i\'ve been a patient') ||
                                utteranceLower.includes('i\'ve been here before') ||
                                utteranceLower.includes('i\'ve been there before') ||
                                utteranceLower.includes('i have been a patient') ||
                                utteranceLower.includes('i have been here before') ||
                                utteranceLower.includes('i have been there before');
      
      if (mentionedNew) {
        console.log('[OpenAICallHandler] ✅ User mentioned being new but AI missed it - overriding response');
        console.log('[OpenAICallHandler]   - User utterance:', userUtterance);
        console.log('[OpenAICallHandler]   - AI had np:', response.state.np);
        // Override the AI's response since it asked about new/existing even though user already said it
        finalResponse = {
          reply: "Great, since it's your first visit, let me check what we have available.",
          state: {
            ...response.state,
            np: true,
            rs: true  // Now we can fetch slots if we have tp
          }
        };
      } else if (mentionedExisting) {
        console.log('[OpenAICallHandler] ✅ User mentioned being existing but AI missed it - overriding response');
        console.log('[OpenAICallHandler]   - User utterance:', userUtterance);
        console.log('[OpenAICallHandler]   - AI had np:', response.state.np);
        // Override the AI's response since it asked about new/existing even though user already said it
        finalResponse = {
          reply: "Perfect, since you've been here before, let me check what we have available.",
          state: {
            ...response.state,
            np: false,
            rs: true  // Now we can fetch slots if we have tp
          }
        };
      } else {
        console.log('[OpenAICallHandler] ℹ️  np is null, checking for new/existing mentions...');
        console.log('[OpenAICallHandler]   - User utterance:', userUtterance);
        console.log('[OpenAICallHandler]   - Lowercase utterance:', utteranceLower);
        // Debug: Log key pattern checks to help diagnose detection issues
        console.log('[OpenAICallHandler]   - Pattern checks: "haven\'t been in"=', utteranceLower.includes("haven't been in"), 
                    ', "havent been in"=', utteranceLower.includes('havent been in'), 
                    ', "i haven\'t been"=', utteranceLower.includes("i haven't been"),
                    ', "i havent been"=', utteranceLower.includes("i havent been"));
      }
    }

    // 3c. CRITICAL: If AI just set rs=true (or we overrode it above) but we don't have slots yet, fetch them NOW
    //     and call AI again so it can offer the slots in the same turn
    if (finalResponse.state.rs === true && !context.availableSlots) {
      // Merge the new state so we have tp and np for fetching (use finalResponse which may have been overridden above)
      let mergedState = { ...context.currentState, ...finalResponse.state };

      // SAFEGUARD 1: Don't fetch slots if we don't know new/existing patient status
      // (Note: This should rarely trigger now since we check above, but keeping as a safety net)
      if (mergedState.np === null || mergedState.np === undefined) {
        console.log('[OpenAICallHandler] ⚠️ AI set rs=true but np is still null - cannot fetch slots yet');
        // Reset rs since we can't fetch slots without knowing new/existing status
        finalResponse = {
          reply: "Sure, I can help with that. Have you been to Spinalogic before, or would this be your first visit?",
          state: {
            ...finalResponse.state,
            rs: false  // Reset so we properly collect np first
          }
        };
        mergedState = { ...mergedState, ...finalResponse.state };
      }
      
      // SAFEGUARD 2: Don't fetch slots if we don't have a time preference
      // Check if we should fetch slots (have np, have tp, rs is true)
      if (finalResponse.state.rs === true && mergedState.np !== null && mergedState.np !== undefined && mergedState.tp) {
        // All required info is available - fetch slots now
        console.log('[OpenAICallHandler] 🔄 AI set rs=true - fetching slots now...');
        
        // Add thinking filler during Cliniko API lookup to prevent dead-air
        const thinkingFiller = ttsThinking();
        // Note: We can't inject this into the response here, but we'll add it before the gather
        
        const slots = await fetchAvailableSlots(mergedState, tenantId, timezone);

        if (slots.length > 0) {
          // Ensure we always offer top 3 slots (even if user gave exact time)
          const slotsToOffer = slots.slice(0, 3);
          context.availableSlots = slotsToOffer;
          console.log('[OpenAICallHandler] ✅ Fetched', slots.length, 'slots, offering top', slotsToOffer.length, 'options');

          // Call AI again with the slots now available
          const responseWithSlots = await callReceptionistBrain(context, userUtterance);
          console.log('[OpenAICallHandler] Reply with slots:', responseWithSlots.reply);
          
          // ENFORCE: If AI tries to book without offering slots first, override it
          if (responseWithSlots.state.bc === true && responseWithSlots.state.si === undefined) {
            console.log('[OpenAICallHandler] ⚠️ AI tried to book without slot selection - forcing slot offer');
            finalResponse = {
              reply: `I have ${slotsToOffer.length} option${slotsToOffer.length > 1 ? 's' : ''} for you. ${slotsToOffer.map((s, i) => {
                // Use natural spoken time if available, otherwise use speakable
                const timeToSpeak = s.spokenTime || s.speakable;
                const practitioner = s.practitionerDisplayName ? ` with ${s.practitionerDisplayName}` : '';
                return `Option ${i + 1}, ${timeToSpeak}${practitioner}`;
              }).join('. ')}. Which one works best?`,
              state: {
                ...responseWithSlots.state,
                bc: false, // Reset booking confirmed
                rs: false  // Reset ready to offer slots
              }
            };
          } else {
            finalResponse = responseWithSlots;
          }
        } else {
          console.log('[OpenAICallHandler] ⚠️ No slots available for the requested time - providing fallback response');
          // No slots available - provide a helpful response instead of leaving caller hanging
          finalResponse = {
            reply: "I'm sorry, we don't have any appointments available at that time. Would a different time work for you? I can check mornings or later in the afternoon.",
            state: {
              ...finalResponse.state,
              rs: false,  // Reset so we can try again with a new time preference
              tp: null    // Clear the time preference so user can give a new one
            }
          };
        }
      } else if (finalResponse.state.rs === true && (mergedState.tp === null || mergedState.tp === undefined)) {
        // We have np but missing tp - ask for time preference
        console.log('[OpenAICallHandler] ⚠️ AI set rs=true but tp is null - need time preference first');
        finalResponse = {
          reply: "When would you like to come in? I can check what we have available.",
          state: {
            ...finalResponse.state,
            rs: false  // Reset so we properly collect tp first
          }
        };
      }
      // If rs is false, we've already handled it above (asked about np or tp)
    }

    // 3c. RESCHEDULE/CANCEL: Look up appointment after AI detects intent
    if ((finalResponse.state.im === 'change' || finalResponse.state.im === 'cancel') && !context.upcomingAppointment) {
      console.log('[OpenAICallHandler] 🔍 AI detected reschedule/cancel intent - looking up appointment...');
      try {
        const patient = await findPatientByPhoneRobust(callerPhone);
        if (patient) {
          const upcoming = await getNextUpcomingAppointment(patient.id);
          if (upcoming) {
            const apptTime = dayjs(upcoming.starts_at).tz(timezone);
            context.upcomingAppointment = {
              id: upcoming.id,
              practitionerId: upcoming.practitioner_id,
              appointmentTypeId: upcoming.appointment_type_id,
              startsAt: upcoming.starts_at,
              speakable: apptTime.format('dddd [at] h:mm A')
            };
            console.log('[OpenAICallHandler] ✅ Found upcoming appointment:', context.upcomingAppointment.speakable);

            // Call AI again with the appointment info so it can tell the user
            const responseWithAppt = await callReceptionistBrain(context, userUtterance);
            console.log('[OpenAICallHandler] Reply with appointment:', responseWithAppt.reply);
            finalResponse = responseWithAppt;
          } else {
            console.log('[OpenAICallHandler] ⚠️ No upcoming appointment found');
            // Let AI handle this - it should offer to book instead
          }
        } else {
          console.log('[OpenAICallHandler] ⚠️ Patient not found in Cliniko');
        }
      } catch (error) {
        console.error('[OpenAICallHandler] Error looking up appointment:', error);
      }
    }

    // 4. Update conversation history
    context = addTurnToHistory(context, 'user', userUtterance);
    context = addTurnToHistory(context, 'assistant', finalResponse.reply);

    // 4a. INTENT LOCK: Once booking intent is locked, never reset to "other" or "faq"
    // This prevents mid-flow resets to "What can I help you with?"
    let stateToApply = { ...finalResponse.state };

    // Lock intent if this is a booking intent
    if (stateToApply.im === 'book' || stateToApply.im === 'change' || stateToApply.im === 'cancel') {
      if (!context.intentLocked) {
        console.log(`[OpenAICallHandler] 🔒 Intent LOCKED: ${stateToApply.im}`);
        context.intentLocked = true;
        context = advanceBookingStage(context, BookingStage.INTENT);
      }
    }

    // If intent is already locked, don't allow AI to reset it
    if (context.intentLocked && (stateToApply.im === 'other' || stateToApply.im === 'faq')) {
      console.log(`[OpenAICallHandler] ⚠️ Intent reset blocked: AI tried to set im="${stateToApply.im}" but intent is locked`);
      // Preserve the locked intent
      stateToApply.im = context.currentState.im || 'book';
    }

    // Prevent AI from overriding resolved states
    if (context.sharedPhoneResolved) {
      // Never re-trigger shared phone questions
      console.log('[OpenAICallHandler] ⚠️ Shared phone already resolved - blocking any re-trigger');
    }

    if (context.identityResolved) {
      // Never re-trigger identity questions
      console.log('[OpenAICallHandler] ⚠️ Identity already resolved - blocking any re-trigger');
    }

    context = updateConversationState(context, stateToApply);

    // 4b. HANDOFF DETECTION: Check for handoff triggers after AI response
    //     This catches frustration loops, low confidence, out-of-scope, etc.
    //     CRITICAL: NEVER trigger handoff during shared phone disambiguation
    //     CRITICAL: NEVER trigger handoff after booking is confirmed (terminal state)
    const isSharedPhoneDisambiguation = context.sharedPhoneDisambiguation && !context.confirmedPatientId;
    const isInTerminalState = context.currentState.appointmentCreated === true;

    if (!isSharedPhoneDisambiguation && !isInTerminalState) {
      const postAIHandoffDetection = detectHandoffTrigger(
        userUtterance,
        context.history || [],
        {
          noMatchCount: context.emptyCount || 0,
          confidence: 0.8, // Assume good confidence if AI responded (could be improved with actual confidence score)
          isOutOfScope: finalResponse.handoff_needed === true && finalResponse.alert_category === 'OUT_OF_SCOPE',
          hasClinikoError: false // Will be checked after Cliniko calls
        }
      );

      // If handoff detected (and not already handled), trigger it
      if (postAIHandoffDetection.shouldTrigger &&
          postAIHandoffDetection.trigger !== 'explicit_request' &&
          postAIHandoffDetection.trigger !== 'profanity') {
        console.log('[OpenAICallHandler] 🚨 Post-AI handoff trigger detected:', postAIHandoffDetection.trigger, postAIHandoffDetection.reason);
        await processHandoff(vr, callSid, callerPhone, tenant, postAIHandoffDetection.trigger || 'unknown', postAIHandoffDetection.reason || '');
        return vr;
      }
    } else if (isSharedPhoneDisambiguation) {
      console.log('[OpenAICallHandler] ⏸️  Skipping handoff detection during shared phone disambiguation');
    } else if (isInTerminalState) {
      console.log('[OpenAICallHandler] 🛡️ TERMINAL STATE: Skipping handoff detection after booking confirmed');
    }

    // 4c. Detect repeated confusion or handoff requests
    let shouldCreateAlert = false;
    let alertCategory = 'TRICKY';
    let alertSummary = '';

    // Check for handoff_needed flag from AI
    if (finalResponse.handoff_needed === true && finalResponse.alert_category) {
      shouldCreateAlert = true;
      alertCategory = finalResponse.alert_category;
      alertSummary = `Caller needs human assistance: ${finalResponse.reply.substring(0, 100)}`;
    }

    // Check for repeated confusion (same question asked >2 times or similar confusion patterns)
    const recentTurns = context.history.slice(-4);
    const userTurns = recentTurns.filter(t => t.role === 'user');
    if (userTurns.length >= 3) {
      // Simple heuristic: if user repeats similar question or shows confusion
      const lastUserMsg = userTurns[userTurns.length - 1].content.toLowerCase();
      const prevUserMsg = userTurns[userTurns.length - 2]?.content.toLowerCase() || '';
      
      // Detect confusion patterns
      const confusionPhrases = ["i don't understand", "what?", "i'm confused", "that's not what", "no that's not right", "you didn't", "i said"];
      const hasConfusion = confusionPhrases.some(phrase => lastUserMsg.includes(phrase));
      
      if (hasConfusion && userTurns.length >= 2) {
        shouldCreateAlert = true;
        alertCategory = 'BOOKING_HELP';
        alertSummary = `Repeated confusion detected after ${userTurns.length} turns. Last message: ${lastUserMsg.substring(0, 100)}`;
      }
    }

    // Create alert if needed
    if (shouldCreateAlert && tenantId) {
      try {
        const call = await storage.getCallByCallSid(callSid);
        const alert = await storage.createAlert({
          tenantId,
          conversationId: call?.conversationId,
          reason: alertCategory.toLowerCase(),
          payload: {
            category: alertCategory,
            summary: alertSummary,
            callSid,
            callerPhone,
            lastUserUtterance: userUtterance,
            aiResponse: finalResponse.reply,
            conversationHistory: context.history.slice(-3)
          }
        });
        
        // Push alert via websocket
        const { emitAlertCreated } = await import('../services/websocket');
        emitAlertCreated(alert);
        
        console.log(`[OpenAICallHandler] ✅ Alert created: ${alertCategory} for call ${callSid}`);
      } catch (error) {
        console.error('[OpenAICallHandler] ❌ Error creating alert:', error);
      }
    }

    // 5. Check if booking is confirmed and create appointment
    // CRITICAL: Do NOT book if handoff is needed (user said they're different person or booking for someone else)
    if (finalResponse.state.bc && finalResponse.state.nm && context.availableSlots && finalResponse.state.si !== undefined && finalResponse.state.si !== null && !finalResponse.handoff_needed) {
      console.log('[OpenAICallHandler] 🎯 Booking confirmed! Creating appointment...');

      const selectedSlot = context.availableSlots[finalResponse.state.si];

      // BOOKING LOCK: Prevent double-booking from race conditions / duplicate webhooks
      const now = Date.now();
      const lockExpiry = context.currentState.bookingLockUntil || 0;
      const isLocked = lockExpiry > now;

      if (isLocked && !context.currentState.appointmentCreated) {
        // Lock is active but appointment not yet created - booking in progress
        console.log('[OpenAICallHandler] ⏳ Booking lock active, skipping duplicate attempt (expires in', Math.round((lockExpiry - now) / 1000), 's)');
        // Don't create duplicate - the original request will complete
      } else if (selectedSlot && !context.currentState.appointmentCreated) {  // Prevent duplicate bookings
        // Set booking lock for 10 seconds to prevent race conditions
        context.currentState.bookingLockUntil = now + 10_000;
        console.log('[OpenAICallHandler] 🔒 Booking lock acquired for 10 seconds');

        try {
          // CRITICAL: Use enriched slot's practitioner and appointment type (from multi-practitioner query)
          // Only fallback to env vars if slot doesn't have the info (legacy single-practitioner mode)
          const isNewPatient = context.currentState.np === true;

          // Use slot's practitioner ID (from multi-practitioner query) or fallback to env
          const practitionerId = selectedSlot.clinikoPractitionerId || env.CLINIKO_PRACTITIONER_ID;

          // Use slot's appointment type ID (already determined by isNewPatient during slot fetch)
          // or fallback to env
          const appointmentTypeId = selectedSlot.appointmentTypeId ||
            (isNewPatient ? env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID : env.CLINIKO_APPT_TYPE_ID);

          if (!practitionerId || !appointmentTypeId) {
            throw new Error('Missing Cliniko configuration (practitioner ID or appointment type ID)');
          }

          // Get tenant context for Cliniko API call
          let tenantCtx = undefined;
          if (tenantId) {
            const tenant = await storage.getTenantById(tenantId);
            if (tenant) {
              tenantCtx = getTenantContext(tenant);
            }
          }

          console.log('[OpenAICallHandler] Creating appointment with:', {
            name: finalResponse.state.nm,
            phone: callerPhone,
            time: selectedSlot.startISO,
            speakable: selectedSlot.speakable,
            practitionerId,
            practitionerName: selectedSlot.practitionerDisplayName,
            appointmentTypeId,
            isNewPatient: isNewPatient ? '✅ NEW PATIENT' : '⏱️ EXISTING PATIENT'
          });

          // CRITICAL: Check for existing patient and name mismatch before creating appointment
          // This prevents overwriting existing patient data
          // BUT: Skip if identity is already confirmed via shared phone disambiguation
          let existingPatient = null;
          if (context.confirmedPatientId) {
            // Identity already confirmed - use confirmed patient ID
            console.log('[OpenAICallHandler] ✅ Using confirmed patient ID:', context.confirmedPatientId);
            // We'll use confirmedPatientId when creating the appointment
            existingPatient = { id: context.confirmedPatientId };
          } else {
            // Check for existing patient by phone (legacy flow)
            const { shouldDisambiguateName } = await import('../utils/name-matcher');
            existingPatient = await findPatientByPhoneRobust(callerPhone);
            
            // Skip disambiguation if already handled in previous turn OR if shared phone disambiguation is active
            // CRITICAL: Also skip if identity is already resolved (prevents "Are you X?" loop)
            if (!context.nameDisambiguation && !context.sharedPhoneDisambiguation && !context.identityResolved && !context.sharedPhoneResolved && existingPatient && finalResponse.state.nm) {
              const existingFullName = `${existingPatient.first_name || ''} ${existingPatient.last_name || ''}`.trim();
              const newFullName = finalResponse.state.nm.trim();
              
              if (shouldDisambiguateName(existingFullName, newFullName)) {
                console.log('[OpenAICallHandler] ⚠️  Name mismatch detected - asking for disambiguation');
                console.log('[OpenAICallHandler]   - Existing patient:', existingFullName);
                console.log('[OpenAICallHandler]   - Spoken name:', newFullName);
                
                // Store disambiguation context
                // CRITICAL: Preserve bc and si values so they can be restored after confirmation
                context.nameDisambiguation = {
                  existingName: existingFullName,
                  spokenName: newFullName,
                  patientId: existingPatient.id.toString(),
                  preservedBc: finalResponse.state.bc === true, // Save original booking_confirmed state
                  preservedSi: finalResponse.state.si !== undefined && finalResponse.state.si !== null 
                    ? finalResponse.state.si 
                    : undefined // Save original selected_slot_index
                };
                await saveConversationContext(callSid, context);
                
                // Override response to ask for confirmation
                finalResponse = {
                  reply: `This number is already on file — are you ${existingFullName}?`,
                  expect_user_reply: true,
                  state: {
                    ...finalResponse.state,
                    bc: false // Don't book yet - need confirmation
                  }
                };
                
                // Don't create appointment yet - wait for confirmation
                console.log('[OpenAICallHandler] ⚠️  Booking paused - waiting for name confirmation');
              } else {
                // Names match or are similar enough - proceed with existing patient
                console.log('[OpenAICallHandler] ✅ Name matches existing patient - proceeding with booking');
              }
            }
          }
          
          // Only create appointment if booking is confirmed and no disambiguation pending
          if (finalResponse.state.bc === true && !context.nameDisambiguation) {
            // Create appointment in Cliniko
            // CRITICAL: If existing patient confirmed via disambiguation, use existing name (not spoken name) to prevent overwrite
            // Note: nameDisambiguation is cleared after confirmation, so we use the nm field which was updated above
            const nameToUse = finalResponse.state.nm || undefined;
            
            // Use recovery phone if available (from identity mismatch recovery), otherwise use caller phone
            const phoneToUse = (context.currentState as any).recoveryPhone || callerPhone;
            if ((context.currentState as any).recoveryPhone) {
              console.log('[OpenAICallHandler] 🔄 Using recovery phone for patient creation:', phoneToUse);
            }
            
            // CRITICAL: If we have a confirmedPatientId from shared phone disambiguation,
            // pass it directly to createAppointmentForPatient to ensure we use the exact patient
            // the user confirmed, not just any patient with that phone number.
            // This is essential when multiple patients share the same phone number.
            if (context.confirmedPatientId) {
              console.log('[OpenAICallHandler] ✅ Using confirmed patient ID for appointment:', context.confirmedPatientId);
              console.log('[OpenAICallHandler]   - This ensures the correct patient record is used (shared phone disambiguation)');
            }
            
            const appointment = await createAppointmentForPatient(phoneToUse, {
              practitionerId,
              appointmentTypeId,
              startsAt: selectedSlot.startISO,
              fullName: nameToUse, // Use existing name if disambiguation confirmed
              notes: finalResponse.state.sym ? `Symptom: ${finalResponse.state.sym}` : undefined,
              patientId: context.confirmedPatientId, // Pass confirmed patient ID if available
              tenantCtx
            });

            console.log('[OpenAICallHandler] ✅ Appointment created:', appointment.id);

            // Format appointment date for SMS
            const appointmentTime = dayjs(selectedSlot.startISO).tz(timezone);
            const formattedDate = appointmentTime.format('dddd, MMMM D [at] h:mm A');

            // Send SMS confirmation (only if not already sent)
            // Include: time, practitioner name, address, and map link
            if (!context.currentState.smsConfirmSent) {
              const includeMapUrl = googleMapsUrl || undefined;
              await sendAppointmentConfirmation({
                to: callerPhone,
                appointmentDate: formattedDate,
                clinicName: clinicName || 'Spinalogic',
                practitionerName: selectedSlot.practitionerDisplayName || undefined,
                address: clinicAddress || context.tenantInfo?.address,
                mapUrl: includeMapUrl
              });
              context.currentState.smsConfirmSent = true;
              // Track if map was included in confirmation SMS
              if (includeMapUrl) {
                context.currentState.confirmSmsIncludedMap = true;
                context.currentState.smsMapSent = true; // Map already sent via confirmation
              }
              console.log('[OpenAICallHandler] ✅ SMS confirmation sent (mapIncluded:', !!includeMapUrl, ')');
            } else {
              console.log('[OpenAICallHandler] SMS confirmation already sent, skipping');
            }

            // For NEW patients, send the intake form link (only if not already sent)
            // Use context.currentState.np (accumulated state) since np was set early in conversation
            if (isNewPatient && !context.currentState.smsIntakeSent) {
              // Generate form token using callSid
              const formToken = `form_${callSid}`;

              await sendNewPatientForm({
                to: callerPhone,
                token: formToken,
                clinicName: clinicName || 'Spinalogic'
              });
              context.currentState.smsIntakeSent = true;
              console.log('[OpenAICallHandler] ✅ New patient form SMS sent');
            } else if (isNewPatient) {
              console.log('[OpenAICallHandler] Intake form SMS already sent, skipping');
            }

            // Mark appointment as created to prevent duplicates
            context.currentState.appointmentCreated = true;

            // Save booked slot time for reference in FAQ answers
            context.bookedSlotTime = selectedSlot.speakable;

            // Override AI response with deterministic SSML booking confirmation
            const patientName = finalResponse.state.nm ?? undefined;
            const appointmentTimeSpeakable = selectedSlot.speakable || formattedDate;
            const practitionerName = selectedSlot.practitionerDisplayName;
            const lastFourDigits = callerPhone.slice(-4);
            const bookingConfirmation = ttsBookingConfirmed(patientName, appointmentTimeSpeakable, practitionerName, lastFourDigits);
            
            // After booking, always ask if they need anything else (ONCE per call)
            if (!context.postBookingPrompted) {
              finalResponse.reply = `${bookingConfirmation} Before you go — do you need the price, directions, or our website?`;
              finalResponse.expect_user_reply = true; // This is a question expecting a reply
              context.postBookingPrompted = true; // Mark as shown to prevent repetition
              await saveConversationContext(callSid, context);
            } else {
              // Already shown - use AI's response (which should handle any follow-up)
              finalResponse.reply = bookingConfirmation;
            }
          } else {
            // Disambiguation pending - don't create appointment yet
            console.log('[OpenAICallHandler] ⏸️  Booking paused - disambiguation in progress');
          }

        } catch (error) {
          console.error('[OpenAICallHandler] ❌ Error creating appointment:', error);
        }
      } else if (!selectedSlot) {
        console.warn('[OpenAICallHandler] Invalid slot index:', finalResponse.state.si);
      } else {
        console.log('[OpenAICallHandler] Appointment already created, skipping');
      }
    }

    // 5b. Check if map link was requested (use smsMapSent flag to prevent duplicates)
    if (finalResponse.state.ml === true && !context.currentState.smsMapSent) {
      try {
        await sendMapLink({
          to: callerPhone,
          clinicName: clinicName || 'Spinalogic',
          mapUrl: googleMapsUrl,  // Use tenant's configured Google Maps URL
          clinicAddress: clinicAddress  // Fallback to address-based map
        });
        context.currentState.smsMapSent = true;
        context.currentState.ml = true; // Also set ml for AI awareness
        console.log('[OpenAICallHandler] ✅ Map link SMS sent');
        
        // Override AI response with warm SSML directions message
        finalResponse.reply = ttsDirections(clinicName || 'Spinalogic');
      } catch (error) {
        console.error('[OpenAICallHandler] ❌ Error sending map link:', error);
      }
    } else if (finalResponse.state.ml === true) {
      console.log('[OpenAICallHandler] Map link SMS already sent, skipping');
    }

    // 5c. RESCHEDULE: Handle reschedule confirmation
    if (finalResponse.state.rc === true && context.upcomingAppointment && context.availableSlots && finalResponse.state.si !== undefined && finalResponse.state.si !== null) {
      const selectedSlot = context.availableSlots[finalResponse.state.si];
      if (selectedSlot && !context.currentState.rc) {
        console.log('[OpenAICallHandler] 🔄 Reschedule confirmed! Moving appointment...');
        try {
          await rescheduleAppointment(
            context.upcomingAppointment.id,
            selectedSlot.startISO,
            undefined, // patientId not needed
            context.upcomingAppointment.practitionerId,
            context.upcomingAppointment.appointmentTypeId
          );
          console.log('[OpenAICallHandler] ✅ Appointment rescheduled to:', selectedSlot.speakable);

          // Send SMS confirmation
          const appointmentTime = dayjs(selectedSlot.startISO).tz(timezone);
          const formattedDate = appointmentTime.format('dddd, MMMM D [at] h:mm A');
          await sendAppointmentConfirmation({
            to: callerPhone,
            appointmentDate: formattedDate,
            clinicName: clinicName || 'Spinalogic'
          });
          console.log('[OpenAICallHandler] ✅ Reschedule SMS confirmation sent');

          context.currentState.rc = true; // Mark as done to prevent duplicates
        } catch (error) {
          console.error('[OpenAICallHandler] ❌ Error rescheduling appointment:', error);
        }
      }
    }

    // 5d. CANCEL: Handle cancel confirmation
    if (finalResponse.state.cc === true && context.upcomingAppointment && !context.currentState.cc) {
      console.log('[OpenAICallHandler] ❌ Cancel confirmed! Cancelling appointment...');
      try {
        await cancelAppointment(context.upcomingAppointment.id);
        console.log('[OpenAICallHandler] ✅ Appointment cancelled');
        context.currentState.cc = true; // Mark as done to prevent duplicates
      } catch (error) {
        console.error('[OpenAICallHandler] ❌ Error cancelling appointment:', error);
      }
    }

    // 6. Save context to database
    await saveConversationContext(callSid, context);

    // 6b. Check if caller wants to end the call (goodbye detection)
    const userUtteranceLower = (userUtterance || '').toLowerCase().trim();
    
    // Check if AI is expecting a reply (asking a question)
    const aiExpectsReply = finalResponse.expect_user_reply !== false;
    
    // Goodbye phrases that always indicate hangup (regardless of context)
    const alwaysGoodbyePhrases = [
      "that's it", "that's all", "that is all", "that is it",
      'goodbye', 'bye', 'good bye', 'see ya', 'see you', 'thanks bye', 'thank you bye',
      'i\'m good', 'im good', "i'm done", 'im done', "that's everything", 'nothing else',
      'all set', 'all done', 'we\'re done', 'we are done', 'all good', 'no thanks',
      'no thank you', 'no more', 'nothing more'
    ];
    
    // Short negative words that only indicate hangup when NOT answering a question
    // When AI is asking a question, "no" is likely an answer, not a goodbye
    const conditionalGoodbyePhrases = ['no', 'nope', 'nah'];
    
    // First check always-goodbye phrases
    let matchedPhrase = alwaysGoodbyePhrases.find(phrase => {
      return userUtteranceLower.includes(phrase);
    });
    
    // Only check conditional phrases (no/nope/nah) if AI is NOT expecting a reply
    // This prevents "No, first time" from being treated as hangup when answering a question
    if (!matchedPhrase && !aiExpectsReply) {
      matchedPhrase = conditionalGoodbyePhrases.find(phrase => {
        // Use word boundary regex to avoid substring matches
        const wordBoundaryRegex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return wordBoundaryRegex.test(userUtteranceLower);
      });
    }
    
    const wantsToEndCall = !!matchedPhrase;

    // 7. Build TwiML response based on expect_user_reply flag
    // CRITICAL: Only include <Gather> when expecting user reply (asking a question)
    // If informational/confirmation only, return <Say> only (or <Say> + <Hangup> if closing)
    
    // Determine if we should expect a reply
    // Default to true if not specified (backward compatibility), but check goodbye first
    const expectsReply = wantsToEndCall ? false : (finalResponse.expect_user_reply !== false);
    
    if (wantsToEndCall) {
      console.log('[OpenAICallHandler] ⚠️  Caller wants to end call - hanging up gracefully');
      console.log('[OpenAICallHandler]   - User utterance:', userUtterance);
      console.log('[OpenAICallHandler]   - Matched phrase:', matchedPhrase);
      // Use deterministic SSML goodbye template
      saySafeSSML(vr, finalResponse.reply || ttsGoodbye());
      saySafeSSML(vr, ttsGoodbye());
      vr.hangup();
      return vr;
    }
    
    if (expectsReply) {
      // Asking a question - include Gather
      const gather = vr.gather({
        input: ['speech'],
        timeout: 8,
        speechTimeout: 'auto',
        action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
        method: 'POST',
        enhanced: true,
        speechModel: 'phone_call', // Required when enhanced=true to fix warning 13335
        bargeIn: true,
        actionOnEmptyResult: true, // Call action even on timeout (empty result)
        profanityFilter: false, // Allow natural speech patterns
        hints: 'yes, no, new patient, first time, first visit, existing patient, been before, appointment, morning, afternoon, today, tomorrow'
      });

      // Note: Removed thinking filler - slots are fetched proactively, so no delay needed
      // If there's actual API delay, the gather will handle it naturally

      // Say response INSIDE gather to enable barge-in (caller can interrupt)
      // REGRESSION SAFETY: Always use saySafeSSML which converts SSML to Twilio-native format
      // This ensures no SSML tags reach Twilio <Say> element (prevents error 13520)
      // saySafeSSML handles both SSML and plain text safely
      saySafeSSML(gather, finalResponse.reply);

      // CRITICAL: Never include Hangup when Gather is present
      // Return TwiML with just the gather - no goodbye/hangup after it
      return vr;
    } else {
      // AI said expect_user_reply=false - but we still need to handle continuation!
      // CRITICAL FIX: Never return without Gather/Redirect unless explicit hangup

      // If handoff is needed, process handoff instead of just hanging up
      if (finalResponse.handoff_needed === true) {
        console.log('[OpenAICallHandler] 🔄 Handoff needed - processing handoff');
        saySafeSSML(vr, finalResponse.reply);
        const handoffReason = finalResponse.alert_category
          ? `AI detected ${finalResponse.alert_category.toLowerCase()}`
          : 'AI requested handoff';
        await processHandoff(vr, callSid, callerPhone, tenant, 'out_of_scope', handoffReason);
        return vr;
      }

      // If AI explicitly set expect_user_reply=false and caller said "no" after booking, close politely
      if (finalResponse.expect_user_reply === false && context.currentState.appointmentCreated) {
        const noPhrases = ['no', 'nope', 'nah', "that's it", "that's all", 'nothing else', 'no thanks'];
        const saidNo = noPhrases.some(phrase => {
          if (phrase.length <= 3 && /^\w+$/.test(phrase)) {
            const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return regex.test(userUtteranceLower);
          }
          return userUtteranceLower.includes(phrase);
        });

        if (saidNo) {
          saySafeSSML(vr, finalResponse.reply);
          saySafeSSML(vr, ttsGoodbye());
          vr.hangup();
          return vr;
        }
      }

      // Check for cancel completion - caller explicitly confirmed and cancel is done
      if (context.currentState.cc === true && finalResponse.state.cc === true) {
        console.log('[OpenAICallHandler] ✅ Cancel completed - closing call');
        saySafeSSML(vr, finalResponse.reply);
        saySafeSSML(vr, ttsGoodbye());
        vr.hangup();
        return vr;
      }

      // Check for reschedule completion - caller confirmed and reschedule is done
      if (context.currentState.rc === true && finalResponse.state.rc === true) {
        console.log('[OpenAICallHandler] ✅ Reschedule completed - closing call');
        saySafeSSML(vr, finalResponse.reply);
        saySafeSSML(vr, ttsGoodbye());
        vr.hangup();
        return vr;
      }

      // SAFETY NET: Always add Gather to continue conversation
      // This prevents dead air when AI sets expect_user_reply=false but call should continue
      console.log('[OpenAICallHandler] ⚠️ expect_user_reply=false but no explicit close - adding safety Gather');
      const safetyGather = vr.gather({
        input: ['speech'],
        timeout: 8,
        speechTimeout: 'auto',
        action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
        method: 'POST',
        enhanced: true,
        speechModel: 'phone_call',
        bargeIn: true,
        actionOnEmptyResult: true,
        profanityFilter: false,
        hints: 'yes, no, reschedule, cancel, tomorrow, today, morning, afternoon'
      });
      saySafeSSML(safetyGather, finalResponse.reply);
      return vr;
    }

  } catch (error) {
    console.error('[OpenAICallHandler] Error processing conversation:', error);
    console.error('[OpenAICallHandler] Error stack:', error instanceof Error ? error.stack : 'No stack');

    // Graceful error handling - don't hang up, give user a chance to continue
    try {
      saySafe(vr, "Sorry — I had a small hiccup there. Let me try again.");
      // Redirect back to continue the conversation instead of hanging up
      vr.redirect({ method: "POST" }, abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}&retry=true`));
    } catch (fallbackError) {
      console.error('[OpenAICallHandler] Fallback error handling also failed:', fallbackError);
      // Last resort: simple message
      const emergencyVr = new twilio.twiml.VoiceResponse();
      emergencyVr.say({ voice: 'Polly.Olivia-Neural' }, "Sorry, there was a technical problem. Please try calling again.");
      emergencyVr.hangup();
      return emergencyVr;
    }

    return vr;
  }
}

/**
 * Handle greeting - initial call setup
 */
export async function handleOpenAIGreeting(
  callSid: string,
  callerPhone: string,
  tenantId?: number,
  clinicName?: string,
  timezone?: string
): Promise<twilio.twiml.VoiceResponse> {
  const vr = new twilio.twiml.VoiceResponse();

  console.log('[OpenAICallHandler] Starting OpenAI conversation for call:', callSid);

  try {
    // Initialize conversation context
    const context = await getOrCreateContext(callSid, callerPhone, tenantId, clinicName);

    // Generate warm greeting using SSML helper
    const knownName = context.knownPatient?.firstName;
    const greeting = ttsGreeting(clinicName || 'Spinalogic', knownName);
    
    // For known patients, we still need to ask if it's them or someone else
    let fullGreeting = greeting;
    if (context.knownPatient && !knownName) {
      fullGreeting = `${greeting} <break time="400ms"/> I think I might recognise this number. Is this for you, or someone else?`;
    }

    // Add greeting to history (strip SSML for storage)
    const greetingText = fullGreeting.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const updatedContext = addTurnToHistory(context, 'assistant', greetingText);
    await saveConversationContext(callSid, updatedContext);

    // Speak greeting and gather response
    const gather = vr.gather({
      input: ['speech'],
      timeout: 8,
      speechTimeout: 'auto',
      action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
      method: 'POST',
      enhanced: true,
      speechModel: 'phone_call', // Required when enhanced=true to fix warning 13335
      bargeIn: true,
      actionOnEmptyResult: true, // Call action even on timeout (empty result)
      hints: 'appointment, booking, reschedule, cancel, question, today, tomorrow, morning, afternoon'
    });

    saySafeSSML(gather, fullGreeting);

    // With actionOnEmptyResult: true, gather timeout will always redirect to action URL
    // The action URL (openai-continue) handles all timeout cases, so no fallback needed here
    // Return TwiML with just the gather - no goodbye/hangup after it
    return vr;

  } catch (error) {
    console.error('[OpenAICallHandler] Error in greeting:', error);
    console.error('[OpenAICallHandler] Error stack:', error instanceof Error ? error.stack : 'No stack');
    
    try {
      // Graceful error handling - don't hang up immediately
      saySafe(vr, "Sorry — I had a small hiccup there. Let me try again.");
      // Redirect back to greeting to retry
      vr.redirect({ method: "POST" }, abs(`/api/voice/openai-incoming?callSid=${encodeURIComponent(callSid)}&retry=true`));
    } catch (fallbackError) {
      console.error('[OpenAICallHandler] Fallback error handling also failed:', fallbackError);
      // Last resort: simple message
      const emergencyVr = new twilio.twiml.VoiceResponse();
      emergencyVr.say({ voice: 'Polly.Olivia-Neural' }, "Thanks for calling. I'm having some technical difficulties. Please call back in a moment.");
      emergencyVr.hangup();
      return emergencyVr;
    }
    
    return vr;
  }
}
