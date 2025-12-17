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
import { findPatientByPhoneRobust, getAvailability, createAppointmentForPatient, getNextUpcomingAppointment, rescheduleAppointment, cancelAppointment, getMultiPractitionerAvailability, type EnrichedSlot } from './cliniko';
import { getTenantContext } from './tenantResolver';
import { sendAppointmentConfirmation, sendNewPatientForm, sendMapLink } from './sms';
import { saySafe } from '../utils/voice-constants';
import { abs } from '../utils/url';
import { env } from '../utils/env';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// ═══════════════════════════════════════════════
// Name Sanitization (remove speech artifacts)
// ═══════════════════════════════════════════════

/**
 * Sanitize patient name by removing common speech-to-text artifacts
 * Examples: "Chris message" → "Chris", "John text" → "John"
 */
function sanitizePatientName(name: string | null | undefined): string | null {
  if (!name) return null;

  // Words to strip from end of name (speech artifacts)
  const artifactWords = [
    'message', 'text', 'sms', 'link', 'email',
    'please', 'thanks', 'thank you', 'okay', 'ok',
    'appointment', 'booking', 'book'
  ];

  let sanitized = name.trim();

  // Remove trailing artifact words (case-insensitive)
  for (const artifact of artifactWords) {
    const regex = new RegExp(`\\s+${artifact}\\s*$`, 'i');
    sanitized = sanitized.replace(regex, '');
  }

  // Remove any trailing punctuation
  sanitized = sanitized.replace(/[.,!?;:]+$/, '').trim();

  // Capitalize first letter of each word
  sanitized = sanitized.replace(/\b\w/g, c => c.toUpperCase());

  return sanitized || null;
}

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

    const slots: EnrichedSlot[] = slotsToUse.slice(0, 3).map((slot: { startISO: string }) => {
      const slotTime = dayjs(slot.startISO).tz(timezone);
      const speakable = slotTime.format('h:mm A'); // e.g., "2:15 PM"

      return {
        startISO: slot.startISO,
        speakable,
        speakableWithPractitioner: `${speakable} with ${fallbackPractitionerName}`,
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
  const { callSid, callerPhone, userUtterance, tenantId, clinicName, timezone = 'Australia/Brisbane', googleMapsUrl, practitionerName, clinicAddress } = options;

  const vr = new twilio.twiml.VoiceResponse();

  console.log('[OpenAICallHandler] Processing utterance:', userUtterance);
  console.log('[OpenAICallHandler] Call SID:', callSid);

  try {
    // 1. Load or create conversation context
    let context = await getOrCreateContext(callSid, callerPhone, tenantId, clinicName);

    // DEFENSIVE: Ensure currentState exists
    if (!context.currentState) {
      context.currentState = {};
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
      context.availableSlots = slots;
      console.log('[OpenAICallHandler] Fetched', slots.length, 'slots for AI to offer');
    }

    // 2a-bis. SECONDARY BOOKING: After primary booking completed, user wants to book for someone else
    //         Detect "book for my child/son/daughter" or "same time as my appointment" etc.
    //         MUST be checked BEFORE reschedule/cancel to avoid "couldn't find appointment" error
    if (context.currentState.appointmentCreated) {
      const utteranceLower = userUtterance.toLowerCase();
      const secondaryBookingPhrases = [
        'book for my',
        'also book',
        'another appointment',
        'same time for',
        'same time as my',
        'book my child',
        'book my son',
        'book my daughter',
        'for my child',
        'for my son',
        'for my daughter',
        'for my kid',
        'family member',
        'someone else',
        'another person',
        'one more appointment',
        'second appointment'
      ];

      const isSecondaryBooking = secondaryBookingPhrases.some(phrase => utteranceLower.includes(phrase));

      if (isSecondaryBooking) {
        console.log('[OpenAICallHandler] 🎯 SECONDARY BOOKING detected after primary appointment');
        console.log('[OpenAICallHandler]   - User utterance:', userUtterance);

        // ═══════════════════════════════════════════════
        // SECONDARY BOOKING SESSION: Reset all booking-related state
        // This allows a fresh booking flow for the child/family member
        // ═══════════════════════════════════════════════

        // Core booking state
        context.currentState.im = 'book';
        context.currentState.bookingFor = 'someone_else';
        context.currentState.appointmentCreated = false; // Allow new booking
        context.currentState.bc = false;
        context.currentState.si = null;
        context.currentState.nm = null; // Need new name for child/family member
        context.currentState.np = true; // Treat secondary booking as new patient
        context.availableSlots = undefined; // Will fetch fresh slots

        // CRITICAL: Reset terminal lock so empty speech prompts work
        context.currentState.terminalLock = false;
        context.currentState.callStage = 'ask_name'; // We need to ask for child's name

        // CRITICAL: Reset SMS flags for secondary booking session
        // Store primary SMS state and allow new SMS for secondary patient
        context.currentState.smsConfirmSentPrimary = context.currentState.smsConfirmSent;
        context.currentState.smsIntakeSentPrimary = context.currentState.smsIntakeSent;
        context.currentState.smsConfirmSent = false; // Allow confirmation SMS for child
        context.currentState.smsIntakeSent = false; // Allow intake form SMS for child

        // Reset booking lock
        context.currentState.bookingLockUntil = undefined;

        // Keep time preference if "same time" mentioned
        if (utteranceLower.includes('same time')) {
          console.log('[OpenAICallHandler]   - Keeping time preference (same time requested)');
          // tp is preserved
        } else {
          context.currentState.tp = null; // Ask for time preference
        }

        // Try to extract child's name from utterance
        const nameMatch = userUtterance.match(/(?:for|book)\s+(?:my\s+)?(?:child|son|daughter|kid)?\s*(?:named?\s+)?([A-Z][a-z]+)/i);
        if (nameMatch) {
          const extractedName = sanitizePatientName(nameMatch[1]);
          context.currentState.secondaryPatientName = extractedName;
          console.log('[OpenAICallHandler]   - Extracted child name:', extractedName);
        }

        console.log('[OpenAICallHandler]   - Reset state for secondary booking (terminalLock: false, SMS flags reset)');
      }
    }

    // 2b. RESCHEDULE/CANCEL: Look up upcoming appointment if intent is change or cancel
    //     Skip if this is a secondary booking (bookingFor='someone_else')
    const isRescheduleOrCancel = context.currentState.im === 'change' || context.currentState.im === 'cancel';
    const isSecondaryBookingFlow = context.currentState.bookingFor === 'someone_else';
    if (isRescheduleOrCancel && !context.upcomingAppointment && !isSecondaryBookingFlow) {
      console.log('[OpenAICallHandler] 🔍 Looking up upcoming appointment for reschedule/cancel...');
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
            console.log('[OpenAICallHandler] ⚠️ No upcoming appointment found for patient');
          }
        } else {
          console.log('[OpenAICallHandler] ⚠️ Patient not found in Cliniko');
        }
      } catch (error) {
        console.error('[OpenAICallHandler] Error looking up appointment:', error);
      }
    }

    // 3. Call OpenAI receptionist brain
    const response = await callReceptionistBrain(context, userUtterance);

    console.log('[OpenAICallHandler] Reply:', response.reply);
    console.log('[OpenAICallHandler] Compact state:', JSON.stringify(response.state, null, 2));

    // 3b. CRITICAL: If AI just set rs=true but we don't have slots yet, fetch them NOW
    //     and call AI again so it can offer the slots in the same turn
    let finalResponse = response;
    if (response.state.rs === true && !context.availableSlots) {
      // Merge the new state so we have tp and np for fetching
      const mergedState = { ...context.currentState, ...response.state };

      // SAFEGUARD 1: Don't fetch slots if we don't know new/existing patient status
      if (mergedState.np === null || mergedState.np === undefined) {
        console.log('[OpenAICallHandler] ⚠️ AI set rs=true but np is null - cannot fetch slots yet');
        // Override response to ask about new/existing patient
        finalResponse = {
          reply: "Sure, I can help with that. Have you been to Spinalogic before, or would this be your first visit?",
          state: {
            ...response.state,
            rs: false  // Reset so we properly collect np first
          }
        };
      }
      // SAFEGUARD 2: Don't fetch slots if we don't have a time preference
      else if (!mergedState.tp) {
        console.log('[OpenAICallHandler] ⚠️ AI set rs=true but tp is null - need time preference first');
        // Override response to ask for time preference
        finalResponse = {
          reply: "When would you like to come in? I can check what we have available.",
          state: {
            ...response.state,
            rs: false  // Reset so we properly collect tp first
          }
        };
      } else {
        console.log('[OpenAICallHandler] 🔄 AI set rs=true - fetching slots now...');
        const slots = await fetchAvailableSlots(mergedState, tenantId, timezone);

        if (slots.length > 0) {
          context.availableSlots = slots;
          console.log('[OpenAICallHandler] ✅ Fetched', slots.length, 'slots, calling AI again to offer them');

          // Call AI again with the slots now available
          const responseWithSlots = await callReceptionistBrain(context, userUtterance);
          console.log('[OpenAICallHandler] Reply with slots:', responseWithSlots.reply);
          finalResponse = responseWithSlots;
        } else {
          console.log('[OpenAICallHandler] ⚠️ No slots available for the requested time - providing fallback response');
          // No slots available - provide a helpful response instead of leaving caller hanging
          finalResponse = {
            reply: "I'm sorry, we don't have any appointments available at that time. Would a different time work for you? I can check mornings or later in the afternoon.",
            state: {
              ...response.state,
              rs: false,  // Reset so we can try again with a new time preference
              tp: null    // Clear the time preference so user can give a new one
            }
          };
        }
      }
    }

    // 3c. RESCHEDULE/CANCEL: Look up appointment after AI detects intent
    //     Skip if this is a secondary booking flow (user wants to book for someone else after primary booking)
    if ((finalResponse.state.im === 'change' || finalResponse.state.im === 'cancel') && !context.upcomingAppointment && context.currentState.bookingFor !== 'someone_else') {
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
    context = updateConversationState(context, finalResponse.state);

    // 5. Check if booking is confirmed and create appointment
    if (finalResponse.state.bc && finalResponse.state.nm && context.availableSlots && finalResponse.state.si !== undefined && finalResponse.state.si !== null) {
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
        // CALL STAGE: Mark as booking in progress (suppresses empty speech prompts)
        context.currentState.callStage = 'booking_in_progress';
        console.log('[OpenAICallHandler] 🔒 Booking lock acquired for 10 seconds, stage: booking_in_progress');

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

          // ═══════════════════════════════════════════════
          // NAME HANDLING: Sanitize and use correct name for booking
          // For secondary bookings, use secondaryPatientName if available
          // ═══════════════════════════════════════════════
          const isSecondaryBooking = context.currentState.bookingFor === 'someone_else';
          let patientName: string | null = finalResponse.state.nm;

          // Sanitize the name (remove speech artifacts like "message", "text", etc.)
          patientName = sanitizePatientName(patientName) || patientName;

          // For secondary booking, prefer secondaryPatientName if we extracted it
          if (isSecondaryBooking && context.currentState.secondaryPatientName) {
            patientName = context.currentState.secondaryPatientName;
            console.log('[OpenAICallHandler] 🧒 Using secondary patient name:', patientName);
          }

          console.log('[OpenAICallHandler] Creating appointment with:', {
            name: patientName,
            phone: callerPhone,
            time: selectedSlot.startISO,
            speakable: selectedSlot.speakable,
            practitionerId,
            practitionerName: selectedSlot.practitionerDisplayName,
            appointmentTypeId,
            isNewPatient: isNewPatient ? '✅ NEW PATIENT' : '⏱️ EXISTING PATIENT',
            isSecondaryBooking: isSecondaryBooking ? '🧒 SECONDARY (child/family)' : '👤 PRIMARY'
          });

          // Create appointment in Cliniko
          const appointment = await createAppointmentForPatient(callerPhone, {
            practitionerId,
            appointmentTypeId,
            startsAt: selectedSlot.startISO,
            fullName: patientName,
            notes: finalResponse.state.sym ? `Symptom: ${finalResponse.state.sym}` : undefined,
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

          // TERMINAL LOCK: After booking, lock flow to prevent:
          // - Identity prompts, empty speech retries, duplicate confirmations
          // Allowed: FAQ, directions, price, "book another appointment"
          context.currentState.terminalLock = true;
          context.currentState.callStage = 'terminal';
          console.log('[OpenAICallHandler] 🔐 Terminal lock engaged - stage: terminal');

          // Save booked slot time for reference in FAQ answers
          context.bookedSlotTime = selectedSlot.speakable;

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
    const goodbyePhrases = [
      'no', 'nope', 'nah', "that's it", "that's all", "that is all", "that is it",
      'goodbye', 'bye', 'good bye', 'see ya', 'see you', 'thanks bye', 'thank you bye',
      'i\'m good', 'im good', "i'm done", 'im done', "that's everything", 'nothing else',
      'all set', 'all done', 'we\'re done', 'we are done', 'all good', 'no thanks',
      'no thank you', 'no more', 'nothing more'
    ];
    const wantsToEndCall = goodbyePhrases.some(phrase => userUtteranceLower.includes(phrase));

    if (wantsToEndCall) {
      console.log('[OpenAICallHandler] Caller wants to end call - hanging up gracefully');
      const goodbyeMessages = [
        "Perfect! We'll be in touch soon. Have a lovely day!",
        "Beautiful! Talk to you soon. Take care!",
        "Lovely! We'll get back to you shortly. Bye for now!"
      ];
      const randomGoodbye = goodbyeMessages[Math.floor(Math.random() * goodbyeMessages.length)];
      saySafe(vr, randomGoodbye);
      vr.hangup();
      return vr;
    }

    // 7. Gather next user input with barge-in enabled (Say INSIDE Gather)
    // CRITICAL: Only ONE <Gather> per response - use actionOnEmptyResult to handle silence on next turn
    const gather = vr.gather({
      input: ['speech'],
      timeout: 8,
      speechTimeout: 'auto',
      action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
      method: 'POST',
      // GUARD: Only set enhanced=true with phone_call model (Twilio warning 13335)
      enhanced: true,
      speechModel: 'phone_call',
      bargeIn: true,
      profanityFilter: false, // Allow natural speech patterns
      actionOnEmptyResult: true, // Send empty result to continue handler (handles "Are you still there?" on next turn)
      hints: 'yes, no, new patient, first time, first visit, existing patient, been before, appointment, morning, afternoon, today, tomorrow, goodbye, that\'s all, nothing else'
    });

    // Say response INSIDE gather to enable barge-in (caller can interrupt)
    saySafe(gather, finalResponse.reply);

    // NO second gather here - actionOnEmptyResult handles silence by calling continue handler
    // The continue handler will say "Are you still there?" if SpeechResult is empty

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
    // CRITICAL: Only ONE <Gather> per response - use actionOnEmptyResult to handle silence on next turn
    const gather = vr.gather({
      input: ['speech'],
      timeout: 8,
      speechTimeout: 'auto',
      action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
      method: 'POST',
      // GUARD: Only set enhanced=true with phone_call model (Twilio warning 13335)
      enhanced: true,
      speechModel: 'phone_call',
      bargeIn: true,
      actionOnEmptyResult: true, // Send empty result to continue handler (handles "Are you still there?" on next turn)
      hints: 'appointment, booking, reschedule, cancel, question, today, tomorrow, morning, afternoon'
    });

    saySafe(gather, greeting);

    // NO second gather here - actionOnEmptyResult handles silence by calling continue handler
    // The continue handler will say "Are you still there?" if SpeechResult is empty

    return vr;

  } catch (error) {
    console.error('[OpenAICallHandler] Error in greeting:', error);
    saySafe(vr, "Thanks for calling. I'm having some technical difficulties. Please call back in a moment.");
    vr.hangup();
    return vr;
  }
}
