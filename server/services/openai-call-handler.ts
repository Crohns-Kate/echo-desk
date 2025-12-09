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
  type ConversationContext,
  type CompactCallState,
  type ParsedCallState
} from '../ai/receptionistBrain';
import { findPatientByPhoneRobust, getAvailability, createAppointmentForPatient } from './cliniko';
import { saySafe } from '../utils/voice-constants';
import { abs } from '../utils/url';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// ═══════════════════════════════════════════════
// Conversation State Storage
// ═══════════════════════════════════════════════

/**
 * Save conversation context to database
 */
async function saveConversationContext(
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

    // Return stored context with history validation
    const loadedContext = conversation.context as any as ConversationContext;

    // CRITICAL: Ensure history is a proper array (might be undefined/null from DB)
    if (!Array.isArray(loadedContext.history)) {
      console.warn('[OpenAICallHandler] Invalid history in stored context, initializing as empty array');
      loadedContext.history = [];
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
async function getOrCreateContext(
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

  // Check if caller matches existing patient
  let knownPatient: { firstName: string; fullName: string; id: string } | undefined;
  if (tenantId) {
    try {
      const patient = await findPatientByPhoneRobust(callerPhone);
      if (patient) {
        const fullName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim();
        knownPatient = {
          firstName: patient.first_name || '',
          fullName: fullName || 'Unknown',
          id: patient.id.toString()
        };
        console.log('[OpenAICallHandler] Matched caller to patient:', knownPatient.fullName);
      }
    } catch (error) {
      console.warn('[OpenAICallHandler] Error looking up patient:', error);
    }
  }

  return initializeConversation(callSid, callerPhone, clinicName, knownPatient);
}

// ═══════════════════════════════════════════════
// Time Preference Parsing and Slot Fetching
// ═══════════════════════════════════════════════

/**
 * Parse natural language time preference into date range
 * Examples: "today afternoon", "tomorrow morning", "this afternoon at 4pm"
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

  // Handle "today"
  if (lower.includes('today')) {
    start = now;
    end = now.endOf('day');

    // Refine to morning/afternoon/evening
    if (lower.includes('morning')) {
      start = now.hour(8).minute(0);
      end = now.hour(12).minute(0);
    } else if (lower.includes('afternoon')) {
      start = now.hour(12).minute(0);
      end = now.hour(17).minute(0);
    } else if (lower.includes('evening')) {
      start = now.hour(17).minute(0);
      end = now.hour(20).minute(0);
    }
  }
  // Handle "tomorrow"
  else if (lower.includes('tomorrow')) {
    start = now.add(1, 'day').hour(8).minute(0);
    end = now.add(1, 'day').hour(18).minute(0);

    if (lower.includes('morning')) {
      start = now.add(1, 'day').hour(8).minute(0);
      end = now.add(1, 'day').hour(12).minute(0);
    } else if (lower.includes('afternoon')) {
      start = now.add(1, 'day').hour(12).minute(0);
      end = now.add(1, 'day').hour(17).minute(0);
    }
  }
  // Handle "this afternoon" (default to today)
  else if (lower.includes('afternoon')) {
    start = now.hour(12).minute(0);
    end = now.hour(17).minute(0);
  }
  // Handle "this morning" (default to today)
  else if (lower.includes('morning')) {
    start = now.hour(8).minute(0);
    end = now.hour(12).minute(0);
  }
  // Handle "next week"
  else if (lower.includes('next week')) {
    start = now.add(7, 'days').hour(8).minute(0);
    end = now.add(7, 'days').hour(18).minute(0);
  }
  // Default: rest of today
  else {
    start = now;
    end = now.endOf('day');
  }

  // If start time is in the past, move to next day
  if (start.isBefore(now)) {
    start = now;
  }

  return {
    start: start.toDate(),
    end: end.toDate()
  };
}

/**
 * Fetch available appointment slots from Cliniko
 * Uses compact state format (tp = time_preference, np = is_new_patient)
 */
async function fetchAvailableSlots(
  state: Partial<CompactCallState>,
  tenantId?: number,
  timezone: string = 'Australia/Brisbane'
): Promise<Array<{ startISO: string; speakable: string; practitionerId?: string; appointmentTypeId?: string }>> {
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
    const availability = await getAvailability({
      fromISO: timeRange.start.toISOString(),
      toISO: timeRange.end.toISOString(),
      timezone
    });

    if (!availability || !availability.slots || availability.slots.length === 0) {
      console.log('[OpenAICallHandler] No available slots found');
      return [];
    }

    // Format slots for human speech
    const slots = availability.slots.slice(0, 3).map((slot: { startISO: string; practitionerId?: string; appointmentTypeId?: string }) => {
      const slotTime = dayjs(slot.startISO).tz(timezone);
      const speakable = slotTime.format('h:mm A'); // e.g., "2:15 PM"

      return {
        startISO: slot.startISO,
        speakable,
        practitionerId: slot.practitionerId,
        appointmentTypeId: slot.appointmentTypeId
      };
    });

    console.log('[OpenAICallHandler] Found', slots.length, 'slots:', slots.map((s: { speakable: string }) => s.speakable).join(', '));
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
  tenantId?: number;
  clinicName?: string;
  timezone?: string;
}

/**
 * Main handler function for OpenAI-powered conversation
 * Returns TwiML VoiceResponse
 */
export async function handleOpenAIConversation(
  options: OpenAICallHandlerOptions
): Promise<twilio.twiml.VoiceResponse> {
  const { callSid, callerPhone, userUtterance, tenantId, clinicName, timezone = 'Australia/Brisbane' } = options;

  const vr = new twilio.twiml.VoiceResponse();

  console.log('[OpenAICallHandler] Processing utterance:', userUtterance);
  console.log('[OpenAICallHandler] Call SID:', callSid);

  try {
    // 1. Load or create conversation context
    let context = await getOrCreateContext(callSid, callerPhone, tenantId, clinicName);

    // 2. Check if we need to fetch appointment slots (rs = ready_to_offer_slots)
    if (context.currentState.rs && !context.availableSlots) {
      console.log('[OpenAICallHandler] Fetching appointment slots...');
      const slots = await fetchAvailableSlots(context.currentState, tenantId, timezone);
      context.availableSlots = slots;
    }

    // 3. Call OpenAI receptionist brain
    const response = await callReceptionistBrain(context, userUtterance);

    console.log('[OpenAICallHandler] Reply:', response.reply);
    console.log('[OpenAICallHandler] Compact state:', JSON.stringify(response.state, null, 2));

    // 4. Update conversation history
    context = addTurnToHistory(context, 'user', userUtterance);
    context = addTurnToHistory(context, 'assistant', response.reply);
    context = updateConversationState(context, response.state);

    // 5. Save context to database
    await saveConversationContext(callSid, context);

    // 6. Generate TwiML response
    saySafe(vr, response.reply);

    // 7. Gather next user input
    const gather = vr.gather({
      input: ['speech'],
      timeout: 5,
      speechTimeout: 'auto',
      action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
      method: 'POST',
      enhanced: true
    });

    // 8. If no response, handle silence
    saySafe(vr, "Are you still there? Let me know if you need anything else.");

    return vr;

  } catch (error) {
    console.error('[OpenAICallHandler] Error processing conversation:', error);

    // Fallback error handling
    saySafe(vr, "I'm having a bit of trouble with my system. Let me transfer you to our reception team.");
    vr.hangup();

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

    // Generate greeting based on whether we know the caller
    let greeting = `Hi, thanks for calling ${clinicName || 'Spinalogic'}, this is Sarah. How can I help you today?`;

    if (context.knownPatient) {
      greeting = `Hi, thanks for calling ${clinicName || 'Spinalogic'}, this is Sarah. I think I might recognise this number – are you ${context.knownPatient.firstName}, or someone else? How can I help you today?`;
    }

    // Add greeting to history
    const updatedContext = addTurnToHistory(context, 'assistant', greeting);
    await saveConversationContext(callSid, updatedContext);

    // Speak greeting and gather response
    const gather = vr.gather({
      input: ['speech'],
      timeout: 8,
      speechTimeout: 'auto',
      action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
      method: 'POST',
      enhanced: true,
      hints: 'appointment, booking, reschedule, cancel, question, today, tomorrow, morning, afternoon'
    });

    saySafe(gather, greeting);

    // If no response
    saySafe(vr, "Are you still there?");

    return vr;

  } catch (error) {
    console.error('[OpenAICallHandler] Error in greeting:', error);
    saySafe(vr, "Thanks for calling. I'm having some technical difficulties. Please call back in a moment.");
    vr.hangup();
    return vr;
  }
}
