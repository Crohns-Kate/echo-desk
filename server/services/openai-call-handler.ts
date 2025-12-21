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
// Deterministic Time Preference Extraction (No LLM dependency)
// ═══════════════════════════════════════════════

/**
 * Extract time preference from raw utterance deterministically.
 * This runs BEFORE calling the AI to ensure tp is set even if LLM doesn't extract it.
 *
 * Priority order (higher = more specific):
 * 1. Specific time (e.g., "4pm", "at 3:30") - HIGHEST PRIORITY
 * 2. Time of day (e.g., "afternoon", "morning")
 * 3. Day names (e.g., "Monday", "Tuesday")
 * 4. Relative days (e.g., "tomorrow", "today")
 * 5. Week references (e.g., "this week", "next week")
 *
 * Examples:
 * - "this afternoon at 4pm" → "today 4:00pm" (specific time wins)
 * - "this afternoon" → "today afternoon"
 * - "tomorrow morning" → "tomorrow morning"
 * - "3pm" / "at 3" → "today 3:00pm"
 */
function extractTimePreferenceFromUtterance(utterance: string): string | null {
  const lower = utterance.toLowerCase().trim();

  // ═══════════════════════════════════════════════
  // PATTERN 1 (HIGHEST PRIORITY): Specific time with explicit meridiem
  // e.g., "4pm", "4:30pm", "at 3 p.m.", "around 10:00am"
  // MUST have am/pm to be considered specific
  // ═══════════════════════════════════════════════
  const specificTimeMatch = lower.match(
    /\b(?:at|around|about)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i
  );

  if (specificTimeMatch) {
    let hour = parseInt(specificTimeMatch[1], 10);
    const minute = specificTimeMatch[2] || '00';
    const meridiem = specificTimeMatch[3].toLowerCase().replace(/\./g, '');

    const timeStr = `${hour}:${minute}${meridiem}`;
    console.log('[extractTimePreference] Matched specific time (PRIORITY):', `today ${timeStr}`);
    return `today ${timeStr}`;
  }

  // ═══════════════════════════════════════════════
  // PATTERN 2: Time of day with optional day reference
  // "this afternoon", "tomorrow morning", "today evening"
  // ═══════════════════════════════════════════════
  const timeOfDayMatch = lower.match(
    /\b(this|today|tomorrow|next)?\s*(morning|afternoon|evening|arvo)\b/i
  );

  if (timeOfDayMatch) {
    const dayRef = timeOfDayMatch[1] || 'today';
    let timeOfDay = timeOfDayMatch[2];

    // Normalize "arvo" to "afternoon" (Australian slang)
    if (timeOfDay === 'arvo') timeOfDay = 'afternoon';

    // "this afternoon" → "today afternoon"
    const normalizedDay = dayRef === 'this' ? 'today' : dayRef;

    console.log('[extractTimePreference] Matched time-of-day pattern:', `${normalizedDay} ${timeOfDay}`);
    return `${normalizedDay} ${timeOfDay}`;
  }

  // Pattern 3: Day names (monday, tuesday, etc.)
  const dayNameMatch = lower.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );

  if (dayNameMatch) {
    const dayName = dayNameMatch[1].toLowerCase();
    console.log('[extractTimePreference] Matched day name:', dayName);
    return dayName;
  }

  // Pattern 4: Relative days
  if (/\btomorrow\b/i.test(lower)) {
    console.log('[extractTimePreference] Matched "tomorrow"');
    return 'tomorrow';
  }

  if (/\btoday\b/i.test(lower)) {
    console.log('[extractTimePreference] Matched "today"');
    return 'today';
  }

  // Pattern 5: "next week", "this week"
  if (/\bnext\s+week\b/i.test(lower)) {
    console.log('[extractTimePreference] Matched "next week"');
    return 'next week';
  }

  if (/\bthis\s+week\b/i.test(lower)) {
    console.log('[extractTimePreference] Matched "this week"');
    return 'today'; // Default to today for "this week"
  }

  // No time preference found
  return null;
}

/**
 * Check if newTp is more specific than currentTp.
 * Specificity order: specific time > time of day > day name > relative day > week
 *
 * Examples:
 * - "today 4:00pm" is more specific than "today afternoon"
 * - "today afternoon" is more specific than "today"
 * - "tomorrow morning" is more specific than "tomorrow"
 */
function isMoreSpecificTime(newTp: string | null, currentTp: string | null): boolean {
  if (!newTp) return false;
  if (!currentTp) return true;  // New tp always beats no tp

  const lower = newTp.toLowerCase();
  const currentLower = currentTp.toLowerCase();

  // Specificity scores
  const getSpecificityScore = (tp: string): number => {
    // Specific time with AM/PM (e.g., "4:00pm", "10:30am")
    if (/\d{1,2}:\d{2}(am|pm)/i.test(tp)) return 100;

    // Time of day (morning, afternoon, evening)
    if (/(morning|afternoon|evening|arvo)/i.test(tp)) return 50;

    // Specific day
    if (/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(tp)) return 30;

    // Tomorrow
    if (/tomorrow/i.test(tp)) return 20;

    // Today
    if (/today/i.test(tp)) return 15;

    // This/next week
    if (/(this|next)\s+week/i.test(tp)) return 10;

    return 0;
  };

  const newScore = getSpecificityScore(lower);
  const currentScore = getSpecificityScore(currentLower);

  return newScore > currentScore;
}

/**
 * Check if a string is a valid person name (not a pronoun, possessive, or common word)
 * Returns false for phrases like "myself", "my son", "for myself", etc.
 */
function isValidPersonName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;

  const lower = name.toLowerCase().trim();

  // Pronouns and self-references
  const pronouns = [
    'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
    'me', 'you', 'him', 'her', 'us', 'them', 'i', 'we', 'they',
    'my', 'your', 'his', 'its', 'our', 'their'
  ];

  // Possessive family/relationship references (these need real names)
  const possessiveReferences = [
    'my son', 'my daughter', 'my wife', 'my husband', 'my partner',
    'my child', 'my kid', 'my kids', 'my children', 'my baby',
    'my mother', 'my father', 'my mom', 'my dad', 'my mum',
    'my brother', 'my sister', 'my friend', 'my boyfriend', 'my girlfriend',
    'my spouse', 'my fiancé', 'my fiancee', 'my fiance',
    'the child', 'the kid', 'the baby', 'the son', 'the daughter',
    'son', 'daughter', 'wife', 'husband', 'partner', 'child', 'kid', 'baby'
  ];

  // Common non-name words and articles
  const nonNameWords = [
    'for', 'and', 'the', 'a', 'an', 'this', 'that', 'here', 'there',
    'when', 'what', 'where', 'which', 'who', 'whom', 'whose',
    'today', 'tomorrow', 'both', 'all', 'some', 'any', 'each',
    'appointment', 'booking', 'please', 'thanks', 'thank', 'can', 'make'
  ];

  // Placeholder markers we use internally
  const placeholders = ['primary', 'secondary', 'caller', 'patient1', 'patient2'];

  // Check for exact pronoun match
  if (pronouns.includes(lower)) {
    console.log('[isValidPersonName] Rejected pronoun:', name);
    return false;
  }

  // Check if name starts with possessive pronoun (e.g., "my son")
  if (lower.startsWith('my ') || lower.startsWith('your ') ||
      lower.startsWith('his ') || lower.startsWith('her ') ||
      lower.startsWith('the ') || lower.startsWith('for ')) {
    console.log('[isValidPersonName] Rejected possessive/prepositional reference:', name);
    return false;
  }

  // Check for possessive reference matches
  if (possessiveReferences.includes(lower)) {
    console.log('[isValidPersonName] Rejected possessive reference:', name);
    return false;
  }

  // Check if starts with common non-name word like "for myself"
  for (const word of nonNameWords) {
    if (lower.startsWith(word + ' ')) {
      console.log('[isValidPersonName] Rejected - starts with non-name word:', name);
      return false;
    }
  }

  // Check for placeholder markers
  if (placeholders.includes(lower)) {
    console.log('[isValidPersonName] Rejected placeholder:', name);
    return false;
  }

  // Check if it's a single non-name word
  if (nonNameWords.includes(lower)) {
    console.log('[isValidPersonName] Rejected non-name word:', name);
    return false;
  }

  // Reject if name is too short (less than 2 characters)
  if (lower.length < 2) {
    console.log('[isValidPersonName] Rejected - too short:', name);
    return false;
  }

  // Valid name
  return true;
}

/**
 * Extract two names from an utterance for group booking
 * Handles patterns like:
 * - "Michael Bishop and Scott Bishop"
 * - "John Smith and Jane Doe"
 * - "Michael and Scott"
 * Returns null if no two-name pattern is found OR if extracted names are not valid person names
 */
function extractTwoNamesFromUtterance(utterance: string): Array<{ name: string; relation?: string }> | null {
  const cleaned = utterance.trim();

  // Skip if utterance is too short or empty
  if (cleaned.length < 5) return null;

  // Pattern 1: "FirstName LastName and FirstName LastName"
  // e.g., "Michael Bishop and Scott Bishop"
  const fullNamesPattern = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+and\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/i;
  const fullNamesMatch = cleaned.match(fullNamesPattern);

  if (fullNamesMatch) {
    const name1 = `${fullNamesMatch[1]} ${fullNamesMatch[2]}`;
    const name2 = `${fullNamesMatch[3]} ${fullNamesMatch[4]}`;

    // Validate both names are real person names
    if (!isValidPersonName(name1) || !isValidPersonName(name2)) {
      console.log('[extractTwoNames] Rejected - not valid person names:', name1, 'and', name2);
      return null;
    }

    console.log('[extractTwoNames] Matched full names:', name1, 'and', name2);
    return [
      { name: name1, relation: 'caller' },
      { name: name2, relation: 'family' }
    ];
  }

  // Pattern 2: "FirstName and FirstName LastName" or "FirstName LastName and FirstName"
  // e.g., "Michael and Scott Bishop" or "Michael Bishop and Scott"
  const mixedNamesPattern = /\b([A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?\s+and\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?\b/i;
  const mixedNamesMatch = cleaned.match(mixedNamesPattern);

  if (mixedNamesMatch) {
    const firstName1 = mixedNamesMatch[1];
    const firstName2 = mixedNamesMatch[2];
    const lastName = mixedNamesMatch[3] || '';

    // If only first names, treat them as complete names
    const name1 = firstName1;
    const name2 = lastName ? `${firstName2} ${lastName}` : firstName2;

    // Validate both names are real person names
    if (!isValidPersonName(name1) || !isValidPersonName(name2)) {
      console.log('[extractTwoNames] Rejected - not valid person names:', name1, 'and', name2);
      return null;
    }

    console.log('[extractTwoNames] Matched names:', name1, 'and', name2);
    return [
      { name: name1, relation: 'caller' },
      { name: name2, relation: 'family' }
    ];
  }

  // Pattern 3: Simple "FirstName and FirstName"
  // e.g., "Michael and Scott"
  const simpleNamesPattern = /\b([A-Z][a-z]{2,})\s+and\s+([A-Z][a-z]{2,})\b/i;
  const simpleNamesMatch = cleaned.match(simpleNamesPattern);

  if (simpleNamesMatch) {
    const name1 = simpleNamesMatch[1];
    const name2 = simpleNamesMatch[2];

    // Validate both names are real person names
    if (!isValidPersonName(name1) || !isValidPersonName(name2)) {
      console.log('[extractTwoNames] Rejected - not valid person names:', name1, 'and', name2);
      return null;
    }

    console.log('[extractTwoNames] Matched simple names:', name1, 'and', name2);
    return [
      { name: name1, relation: 'caller' },
      { name: name2, relation: 'family' }
    ];
  }

  // No two-name pattern found
  return null;
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
  timezone: string = 'Australia/Brisbane',
  maxSlots: number = 3  // Default 3 slots, more for group bookings
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
        maxSlots,  // Use parameter for group booking support
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

    // ═══════════════════════════════════════════════
    // 2c. DETERMINISTIC GROUP BOOKING DETECTION: Detect group booking from utterance
    // BEFORE calling AI. This seeds gb and gp on the FIRST turn so executor can trigger.
    // The AI would normally set these, but executor runs BEFORE AI response is applied.
    // ═══════════════════════════════════════════════
    const utteranceLowerForGroup = userUtterance.toLowerCase().trim();

    // Group booking phrase patterns - detect multi-person booking intent
    const groupBookingPatterns = [
      /myself and my (son|child|daughter|kids?|husband|wife|partner|mum|mom|dad|father|mother)/i,
      /me and my (son|child|daughter|kids?|husband|wife|partner|mum|mom|dad|father|mother)/i,
      /my (son|child|daughter|kids?|husband|wife|partner|mum|mom|dad|father|mother) and (me|myself|i)/i,
      /both of us/i,
      /two of us/i,
      /for (both|two|the two)/i,
      /appointments? for (both|two|me and)/i,
      /book(ing)? for (me|myself) and/i,
      /for myself and/i,
      /(book|appointment|see).+(son|child|daughter|kids?).+and.+(me|myself)/i,
      /(book|appointment|see).+(me|myself).+and.+(son|child|daughter|kids?)/i
    ];

    const isGroupBookingUtterance = groupBookingPatterns.some(pattern => pattern.test(userUtterance));

    if (isGroupBookingUtterance && !context.currentState.gb) {
      console.log('[OpenAICallHandler] 🎯 DETERMINISTIC GROUP BOOKING DETECTION: First-turn detection triggered');
      console.log('[OpenAICallHandler]   Utterance:', userUtterance);

      // Set group booking flag
      context.currentState.gb = true;

      // Try to extract ACTUAL names from the utterance first
      const extractedNames = extractTwoNamesFromUtterance(userUtterance);

      if (extractedNames && extractedNames.length >= 2) {
        // Found actual names - use them directly!
        context.currentState.gp = extractedNames;
        console.log('[OpenAICallHandler] 🎯 EXTRACTED REAL NAMES:', extractedNames.map(p => p.name).join(', '));
      } else if (!context.currentState.gp || context.currentState.gp.length < 2) {
        // No names found - seed with placeholders
        // These will be replaced with actual names when AI extracts them
        let relation = 'family member';
        const relationMatch = userUtterance.match(/my\s+(son|child|daughter|kids?|husband|wife|partner|mum|mom|dad|father|mother)/i);
        if (relationMatch) {
          relation = relationMatch[1].toLowerCase();
        }

        context.currentState.gp = [
          { name: 'PRIMARY', relation: 'caller' },
          { name: 'SECONDARY', relation: relation }
        ];
        console.log('[OpenAICallHandler]   Seeded gp with placeholders:', context.currentState.gp);
      }

      // Also extract time preference if present
      const extractedTpFirst = extractTimePreferenceFromUtterance(userUtterance);
      if (extractedTpFirst && !context.currentState.tp) {
        context.currentState.tp = extractedTpFirst;
        context.currentState.rs = true;
        console.log('[OpenAICallHandler]   Extracted tp from first utterance:', extractedTpFirst);
      }

      // Set booking intent
      context.currentState.im = 'book';

      console.log('[OpenAICallHandler] 🎯 DETERMINISTIC GROUP BOOKING: gb=%s, gp.length=%d, tp=%s',
        context.currentState.gb,
        context.currentState.gp?.length || 0,
        context.currentState.tp || 'null'
      );
    }

    // ═══════════════════════════════════════════════
    // 2c-bis. NAME EXTRACTION FOR EXISTING GROUP BOOKING
    // If gp has placeholders and utterance contains names, replace them
    // ═══════════════════════════════════════════════
    const hasPlaceholders = context.currentState.gp?.some(
      (p: { name: string }) => p.name === 'PRIMARY' || p.name === 'SECONDARY'
    );

    if (context.currentState.gb && hasPlaceholders) {
      const extractedNames = extractTwoNamesFromUtterance(userUtterance);
      if (extractedNames && extractedNames.length >= 2) {
        console.log('[OpenAICallHandler] 📝 REPLACING PLACEHOLDERS with real names:', extractedNames.map(p => p.name).join(', '));
        context.currentState.gp = extractedNames;
      }
    }

    // ═══════════════════════════════════════════════
    // 2d. DETERMINISTIC TP EXTRACTION: For group bookings, extract time preference
    // from utterance BEFORE calling AI. This ensures tp is set even if LLM doesn't.
    // ═══════════════════════════════════════════════
    // CRITICAL: Extract TP even when gp.length < 2, because caller might say
    // "Tommy Brown, this afternoon" - we need to capture the time even if
    // we're still collecting names. The executor will only run when gp is complete.
    const isGroupBookingMode = context.currentState.gb === true;

    if (isGroupBookingMode && !context.currentState.tp) {
      const extractedTp = extractTimePreferenceFromUtterance(userUtterance);
      if (extractedTp) {
        console.log('[OpenAICallHandler] 🕐 DETERMINISTIC TP: Group booking mode, extracted tp from utterance:', extractedTp);
        context.currentState.tp = extractedTp;

        // Also set request_slots since we now have tp
        context.currentState.rs = true;
        console.log('[OpenAICallHandler] 🕐 DETERMINISTIC TP: Set tp="%s" and rs=true for group booking', extractedTp);
      } else {
        console.log('[OpenAICallHandler] 🕐 DETERMINISTIC TP: Group booking mode but no time preference found in utterance:', userUtterance);
      }
    }

    // Log group booking state before AI call
    if (context.currentState.gb) {
      console.log('[OpenAICallHandler] 👨‍👩‍👧 GROUP BOOKING STATE BEFORE AI:',
        'gb=', context.currentState.gb,
        'gp=', context.currentState.gp?.map((p: { name: string; relation?: string }) => p.name),
        'tp=', context.currentState.tp,
        'np=', context.currentState.np
      );
    }

    // ═══════════════════════════════════════════════
    // 2e. GROUP BOOKING EXECUTOR - MUST RUN BEFORE AI
    // If group booking is ready (gb=true, gp>=2 with REAL names, tp set, not complete),
    // execute immediately without calling AI. AI must NOT decide outcomes.
    // ═══════════════════════════════════════════════

    // Check if gp contains ACTUAL names (not placeholders, pronouns, or possessive references)
    // Uses isValidPersonName() to reject phrases like "myself", "my son", "for myself", etc.
    const hasRealNames = Array.isArray(context.currentState.gp) &&
                          context.currentState.gp.length >= 2 &&
                          context.currentState.gp.every((p: { name: string }) =>
                            p.name &&
                            isValidPersonName(p.name)
                          );

    const groupBookingReady = context.currentState.gb === true &&
                               hasRealNames &&
                               context.currentState.tp &&
                               !context.currentState.groupBookingComplete;

    // Hard logging for verification
    console.log('[GroupBookingExecutor] CHECK:', {
      gb: context.currentState.gb,
      gpLength: Array.isArray(context.currentState.gp) ? context.currentState.gp.length : 0,
      gpNames: context.currentState.gp?.map((p: { name: string }) => p.name) || [],
      hasRealNames,
      tp: context.currentState.tp || 'null',
      groupBookingComplete: context.currentState.groupBookingComplete || false,
      ready: groupBookingReady
    });

    if (groupBookingReady) {
      console.log('[GroupBookingExecutor] 🚀 RUNNING - All conditions met, bypassing AI');
      console.log('[GroupBookingExecutor] Patients:', context.currentState.gp?.map((p: { name: string; relation?: string }) => p.name).join(', '));
      console.log('[GroupBookingExecutor] Time preference:', context.currentState.tp);

      try {
        // Fetch slots if not already available
        if (!context.availableSlots || context.availableSlots.length === 0) {
          console.log('[GroupBookingExecutor] 🔄 Fetching slots...');
          const groupSize = context.currentState.gp?.length || 2;
          const slots = await fetchAvailableSlots(
            { ...context.currentState, np: true },  // Treat as new patients
            tenantId,
            timezone,
            groupSize * 2  // Fetch extra slots for flexibility
          );
          context.availableSlots = slots;
          console.log('[GroupBookingExecutor] ✅ Fetched', slots.length, 'slots');
        }

        const groupPatients = context.currentState.gp || [];

        if (!context.availableSlots || context.availableSlots.length < groupPatients.length) {
          console.log('[GroupBookingExecutor] ⚠️ Not enough slots for group booking');
          console.log('[GroupBookingExecutor] Available:', context.availableSlots?.length || 0, 'Required:', groupPatients.length);

          // CRITICAL: Do NOT fall through to AI - return TwiML response directly
          const patientNames = groupPatients.map((p: { name: string }) => p.name).join(' and ');
          const noSlotsMessage = `I'm sorry, I couldn't find enough back-to-back appointments for ${patientNames} at ${context.currentState.tp}. Would you like me to check a different time, or book separate appointments?`;

          const gather = vr.gather({
            input: ['speech'],
            timeout: 8,
            speechTimeout: 'auto',
            action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
            method: 'POST',
            enhanced: true,
            speechModel: 'phone_call',
            bargeIn: true,
            profanityFilter: false,
            actionOnEmptyResult: true,
            hints: 'different time, separate appointments, tomorrow, morning, afternoon'
          });

          saySafe(gather, noSlotsMessage);

          // Save context and return - do NOT call AI
          await saveConversationContext(callSid, context);
          return vr;
        }

        // We have enough slots - proceed with booking
        {
          // Execute group booking
          const groupBookingResults: Array<{ name: string; patientId: string; appointmentId: string; time: string }> = [];

          // Set booking lock
          context.currentState.bookingLockUntil = Date.now() + 20_000;
          context.currentState.callStage = 'booking_in_progress';
          console.log('[GroupBookingExecutor] 🔒 Booking lock acquired');

          // Get tenant context
          let tenantCtx = undefined;
          if (tenantId) {
            const tenant = await storage.getTenantById(tenantId);
            if (tenant) {
              tenantCtx = getTenantContext(tenant);
            }
          }

          // Book appointments for each group member
          for (let i = 0; i < groupPatients.length; i++) {
            const member = groupPatients[i];

            // Check we have enough slots
            if (i >= context.availableSlots.length) {
              console.log('[GroupBookingExecutor] ⚠️ Not enough slots. Booked', i, 'of', groupPatients.length);
              break;
            }

            const slot = context.availableSlots[i];
            const practitionerId = slot.clinikoPractitionerId || env.CLINIKO_PRACTITIONER_ID;
            const appointmentTypeId = slot.appointmentTypeId || env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID;

            // Sanitize name
            const memberName = sanitizePatientName(member.name) || member.name;

            console.log('[GroupBookingExecutor] 📋 Creating appointment', i + 1, 'for:', memberName, 'at', slot.speakable);

            const appointment = await createAppointmentForPatient(callerPhone, {
              practitionerId,
              appointmentTypeId,
              startsAt: slot.startISO,
              fullName: memberName,
              notes: context.currentState.sym
                ? `Symptom: ${context.currentState.sym} (Group booking: ${member.relation || 'family'})`
                : `Group booking: ${member.relation || 'family'}`,
              tenantCtx,
              callSid,  // For traceability
              conversationId: context.conversationId  // For traceability
            });

            // CRITICAL: Verify appointment was actually created (has ID)
            if (!appointment || !appointment.id) {
              console.error('[GroupBookingExecutor] ❌ CRITICAL: Cliniko returned no appointment ID!');
              throw new Error('Cliniko booking failed - no appointment ID returned');
            }

            console.log('[GroupBookingExecutor] ✅ Appointment created:', appointment.id, 'patient:', appointment.patient_id);

            groupBookingResults.push({
              name: memberName,
              patientId: appointment.patient_id,
              appointmentId: appointment.id,
              time: slot.speakable
            });
          }

          // Send SMS confirmation (once for the caller)
          if (groupBookingResults.length > 0) {
            const appointmentSummary = groupBookingResults.map(r => `${r.name}: ${r.time}`).join(', ');
            const firstSlot = context.availableSlots[0];
            const appointmentTime = dayjs(firstSlot.startISO).tz(timezone);
            const formattedDate = appointmentTime.format('dddd, MMMM D');

            await sendAppointmentConfirmation({
              to: callerPhone,
              appointmentDate: `${formattedDate} - ${appointmentSummary}`,
              clinicName: clinicName || 'Spinalogic',
              practitionerName: firstSlot.practitionerDisplayName,
              address: clinicAddress || context.tenantInfo?.address,
              mapUrl: googleMapsUrl || undefined
            });
            context.currentState.smsConfirmSent = true;
            console.log('[GroupBookingExecutor] ✅ SMS confirmation sent');

            // Send intake forms for each patient with their Cliniko patient ID
            for (const result of groupBookingResults) {
              const formToken = `form_${callSid}_${result.patientId}`;

              await sendNewPatientForm({
                to: callerPhone,
                token: formToken,
                clinicName: clinicName || 'Spinalogic',
                clinikoPatientId: result.patientId  // Link form to correct Cliniko patient
              });
              console.log('[GroupBookingExecutor] ✅ Intake form sent for:', result.name, 'patientId:', result.patientId);
            }
            context.currentState.smsIntakeSent = true;
          }

          // Mark group booking complete ONLY after all operations succeed
          context.currentState.groupBookingComplete = groupBookingResults.length;
          context.currentState.terminalLock = true;
          context.currentState.callStage = 'terminal';
          context.currentState.bc = true;
          console.log('[GroupBookingExecutor] 🎉 COMPLETE!', groupBookingResults.length, 'appointments created');

          // Save context
          await saveConversationContext(callSid, context);

          // Generate confirmation TwiML - bypass AI entirely
          const bookedNames = groupBookingResults.map(r => r.name).join(' and ');
          const bookedTimes = groupBookingResults.map(r => r.time).join(' and ');
          const confirmationMessage = `Perfect! I've booked ${bookedNames} for ${bookedTimes}. I'm sending a text with the appointment details and forms. Is there anything else I can help with?`;

          const gather = vr.gather({
            input: ['speech'],
            timeout: 8,
            speechTimeout: 'auto',
            action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
            method: 'POST',
            enhanced: true,
            speechModel: 'phone_call',
            bargeIn: true,
            profanityFilter: false,
            actionOnEmptyResult: true,
            hints: 'yes, no, goodbye, that\'s all, nothing else'
          });

          saySafe(gather, confirmationMessage);

          // Return immediately - do NOT call AI
          return vr;
        }
      } catch (error: any) {
        console.error('[GroupBookingExecutor] ❌ BOOKING FAILED:', error?.message || error);

        // Reset state on failure
        context.currentState.callStage = 'offer_slots';
        context.currentState.bookingLockUntil = undefined;
        context.currentState.bookingFailed = true;
        context.currentState.bookingError = error?.message || String(error);

        // Create alert for manual follow-up
        try {
          await storage.createAlert({
            tenantId: tenantId || 1,
            conversationId: context.conversationId || 0,
            reason: 'booking_failed',
            payload: {
              callSid,
              callerPhone,
              groupPatients: context.currentState.gp?.map((p: { name: string }) => p.name),
              requestedTime: context.currentState.tp,
              error: error?.message || String(error),
              errorStack: error?.stack,
              type: 'group_booking'
            },
            status: 'open'
          });
          console.log('[GroupBookingExecutor] ✅ Alert created for booking failure');
        } catch (alertError) {
          console.error('[GroupBookingExecutor] Failed to create alert:', alertError);
        }

        // Send SMS fallback notification
        try {
          await sendAppointmentConfirmation({
            to: callerPhone,
            appointmentDate: `Requested: ${context.currentState.tp || 'your preferred time'} - PENDING CONFIRMATION`,
            clinicName: clinicName || 'Spinalogic',
            customMessage: 'We received your group booking request. Our team will confirm shortly.'
          });
          console.log('[GroupBookingExecutor] ✅ Fallback SMS sent');
        } catch (smsError) {
          console.error('[GroupBookingExecutor] Failed to send fallback SMS:', smsError);
        }

        // CRITICAL: Return a fallback TwiML response - do NOT fall through to AI
        // AI might say "booked" when booking failed!
        const failureMessage = "I couldn't complete the booking just now. I'll have reception confirm your appointments by text in a moment. Is there anything else I can help with?";

        const failGather = vr.gather({
          input: ['speech'],
          timeout: 8,
          speechTimeout: 'auto',
          action: abs(`/api/voice/openai-continue?callSid=${encodeURIComponent(callSid)}`),
          method: 'POST',
          enhanced: true,
          speechModel: 'phone_call',
          bargeIn: true,
          profanityFilter: false,
          actionOnEmptyResult: true
        });

        saySafe(failGather, failureMessage);

        await saveConversationContext(callSid, context);
        return vr;  // Return immediately - do NOT call AI
      }
    }

    // 3. Call OpenAI receptionist brain (ONLY if group booking executor did not run/complete)
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

    // ═══════════════════════════════════════════════
    // 3d. PROTECT GROUP BOOKING STATE FROM AI OVERWRITE
    // Group booking state is SYSTEM-OWNED, not AI-OWNED.
    // Once gb=true is set, the AI must NEVER reset it or clear gp/tp.
    // ═══════════════════════════════════════════════
    if (context.currentState.gb === true) {
      console.log('[OpenAICallHandler] 🔒 PROTECTING group booking state from AI overwrite');

      // ALWAYS preserve gb=true
      finalResponse.state.gb = true;

      // NEVER let AI clear gp (patient list)
      if (Array.isArray(context.currentState.gp) && context.currentState.gp.length > 0) {
        // If AI provided new names that pass validation, allow update
        // Otherwise preserve existing gp
        const aiGp = finalResponse.state.gp;
        if (Array.isArray(aiGp) && aiGp.length >= 2 &&
            aiGp.every((p: { name: string }) => isValidPersonName(p.name))) {
          console.log('[OpenAICallHandler]   AI provided valid names, updating gp');
          // Allow the update - AI extracted real names
        } else {
          // Preserve existing gp
          finalResponse.state.gp = context.currentState.gp;
          console.log('[OpenAICallHandler]   Preserved existing gp:', context.currentState.gp.map((p: {name: string}) => p.name).join(', '));
        }
      }

      // ═══════════════════════════════════════════════
      // CRITICAL FIX: Check if AI returned gp with REAL relation words as names
      // (like "son", "daughter" - NOT placeholders like PRIMARY/SECONDARY)
      // Only override AI reply if it's NOT already asking for names
      // ═══════════════════════════════════════════════
      const aiGp = finalResponse.state.gp;
      if (Array.isArray(aiGp) && aiGp.length >= 1) {
        // Find entries with relation words as names (NOT placeholders - those are expected)
        // Placeholders (PRIMARY, SECONDARY) are fine - AI will update them later
        const placeholderNames = ['primary', 'secondary', 'caller', 'patient1', 'patient2'];
        const relationWords = ['son', 'daughter', 'child', 'kid', 'baby', 'wife', 'husband',
                               'partner', 'mother', 'father', 'mom', 'mum', 'dad',
                               'brother', 'sister', 'friend', 'boyfriend', 'girlfriend',
                               'spouse', 'fiancé', 'fiancee', 'fiance'];

        const invalidEntries = aiGp.filter((p: { name: string; relation?: string }) => {
          const lower = (p.name || '').toLowerCase().trim();
          // Only flag as invalid if it's a RELATION WORD used as a name (not placeholder)
          return relationWords.includes(lower) && !placeholderNames.includes(lower);
        });

        // Check if AI is already asking for names (don't override if so)
        const replyLower = finalResponse.reply.toLowerCase();
        const isAlreadyAskingForNames = replyLower.includes('name') &&
          (replyLower.includes('get') || replyLower.includes('what') || replyLower.includes('who'));

        if (invalidEntries.length > 0 && !isAlreadyAskingForNames) {
          // AI put a relation word as a name AND is NOT asking for the name
          const invalidNames = invalidEntries.map((p: { name: string; relation?: string }) => p.name);
          console.log('[OpenAICallHandler] ⚠️ AI used relation words as actual names:', invalidNames);

          // Find the VALID name(s) that AI extracted correctly
          const validEntries = aiGp.filter((p: { name: string }) => {
            const lower = (p.name || '').toLowerCase().trim();
            return !relationWords.includes(lower) && !placeholderNames.includes(lower) && p.name.trim().length > 0;
          });
          const validNames = validEntries.map((p: { name: string }) => p.name);

          // Keep the gp structure but only with valid entries (so executor knows count)
          // DON'T clear completely - keep structure for group booking flow
          if (validEntries.length > 0) {
            finalResponse.state.gp = validEntries;
            console.log('[OpenAICallHandler]   Keeping valid names:', validNames.join(', '));
          }
          // If no valid names, keep gp as-is so AI can fix it in next turn
          // DON'T clear gp - that breaks the group booking flow

          // Determine what relation word was used, to ask for that person's name
          const relationToHuman: Record<string, string> = {
            'son': 'son', 'daughter': 'daughter', 'child': 'child', 'kid': 'child',
            'baby': 'baby', 'wife': 'wife', 'husband': 'husband', 'partner': 'partner',
            'mother': 'mother', 'father': 'father', 'mom': 'mother', 'mum': 'mother',
            'dad': 'father', 'brother': 'brother', 'sister': 'sister', 'friend': 'friend',
            'boyfriend': 'boyfriend', 'girlfriend': 'girlfriend', 'spouse': 'spouse',
            'fiancé': 'fiancé', 'fiancee': 'fiancée', 'fiance': 'fiancé'
          };

          const firstInvalidName = invalidNames[0]?.toLowerCase();
          const relationWord = relationToHuman[firstInvalidName] || 'the other person';

          // Override reply to ask for the missing name
          const firstValidName = validNames[0];
          if (firstValidName) {
            const firstName = firstValidName.split(' ')[0];
            finalResponse.reply = `Thanks ${firstName}. And what's your ${relationWord}'s name?`;
          } else {
            finalResponse.reply = `Can I get your ${relationWord}'s name please?`;
          }

          console.log('[OpenAICallHandler]   Overriding AI reply to ask for name:', finalResponse.reply);
        } else if (invalidEntries.length > 0) {
          console.log('[OpenAICallHandler]   AI has invalid names but is already asking for names, not overriding');
        }
      }

      // Time preference handling: more specific time always wins
      // e.g., "4pm" overrides "afternoon", but "afternoon" does not override "4pm"
      if (context.currentState.tp) {
        if (!finalResponse.state.tp) {
          // AI didn't provide tp - preserve existing
          finalResponse.state.tp = context.currentState.tp;
          console.log('[OpenAICallHandler]   Preserved existing tp:', context.currentState.tp);
        } else if (isMoreSpecificTime(finalResponse.state.tp, context.currentState.tp)) {
          // AI provided MORE specific time - allow the update
          console.log('[OpenAICallHandler]   AI provided more specific tp:', finalResponse.state.tp, '(was:', context.currentState.tp, ')');
        } else {
          // AI provided LESS specific time - preserve existing
          finalResponse.state.tp = context.currentState.tp;
          console.log('[OpenAICallHandler]   Preserved more specific tp:', context.currentState.tp, '(AI tried:', finalResponse.state.tp, ')');
        }
      }

      // Preserve groupBookingComplete if already set
      if (context.currentState.groupBookingComplete) {
        finalResponse.state.groupBookingComplete = context.currentState.groupBookingComplete;
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
            tenantCtx,
            callSid,  // For traceability
            conversationId: context.conversationId  // For traceability
          });

          // CRITICAL: Verify appointment was actually created (has ID)
          if (!appointment || !appointment.id) {
            console.error('[OpenAICallHandler] ❌ CRITICAL: Cliniko returned no appointment ID!');
            throw new Error('Cliniko booking failed - no appointment ID returned');
          }

          console.log('[OpenAICallHandler] ✅ Appointment created:', appointment.id);

          // Store appointment ID in context for verification
          context.currentState.lastAppointmentId = appointment.id;

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
          // CRITICAL: Include clinikoPatientId so form updates the correct patient
          if (isNewPatient && !context.currentState.smsIntakeSent) {
            // Generate form token using callSid
            const formToken = `form_${callSid}`;

            await sendNewPatientForm({
              to: callerPhone,
              token: formToken,
              clinicName: clinicName || 'Spinalogic',
              clinikoPatientId: appointment.patient_id  // Link form to correct Cliniko patient
            });
            context.currentState.smsIntakeSent = true;
            console.log('[OpenAICallHandler] ✅ New patient form SMS sent with patientId:', appointment.patient_id);
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

        } catch (error: any) {
          console.error('[OpenAICallHandler] ❌ BOOKING FAILED:', error?.message || error);

          // CRITICAL: Override AI reply - do NOT say "booked" when booking failed
          finalResponse.reply = "I couldn't complete the booking just now. I'll have reception confirm your appointment by text in a moment. Is there anything else I can help with?";

          // Create alert for manual follow-up
          try {
            await storage.createAlert({
              tenantId: tenantId || 1,
              conversationId: context.conversationId || 0,
              reason: 'booking_failed',
              payload: {
                callSid,
                callerPhone,
                patientName: finalResponse.state.nm || 'unknown',
                requestedSlot: selectedSlot?.speakable || 'unknown',
                requestedTime: selectedSlot?.startISO || 'unknown',
                practitionerId: selectedSlot?.clinikoPractitionerId || 'unknown',
                appointmentTypeId: selectedSlot?.appointmentTypeId || 'unknown',
                error: error?.message || String(error),
                errorStack: error?.stack
              },
              status: 'open'
            });
            console.log('[OpenAICallHandler] ✅ Alert created for booking failure');
          } catch (alertError) {
            console.error('[OpenAICallHandler] Failed to create alert:', alertError);
          }

          // Send SMS fallback notification
          try {
            await sendAppointmentConfirmation({
              to: callerPhone,
              appointmentDate: `Requested: ${selectedSlot?.speakable || 'your preferred time'} - PENDING CONFIRMATION`,
              clinicName: clinicName || 'Spinalogic',
              practitionerName: selectedSlot?.practitionerDisplayName,
              address: clinicAddress || context.tenantInfo?.address,
              customMessage: 'We received your booking request. Our team will confirm shortly.'
            });
            console.log('[OpenAICallHandler] ✅ Fallback SMS sent');
          } catch (smsError) {
            console.error('[OpenAICallHandler] Failed to send fallback SMS:', smsError);
          }

          // Mark booking as NOT created
          context.currentState.appointmentCreated = false;
          context.currentState.bookingFailed = true;
          context.currentState.bookingError = error?.message || String(error);
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
    // CRITICAL: Do NOT allow goodbye if group booking is in progress
    const userUtteranceLower = (userUtterance || '').toLowerCase().trim();
    const goodbyePhrases = [
      'no', 'nope', 'nah', "that's it", "that's all", "that is all", "that is it",
      'goodbye', 'bye', 'good bye', 'see ya', 'see you', 'thanks bye', 'thank you bye',
      'i\'m good', 'im good', "i'm done", 'im done', "that's everything", 'nothing else',
      'all set', 'all done', 'we\'re done', 'we are done', 'all good', 'no thanks',
      'no thank you', 'no more', 'nothing more'
    ];
    const wantsToEndCall = goodbyePhrases.some(phrase => userUtteranceLower.includes(phrase));

    // Check if group booking is in progress (should NOT allow goodbye)
    const groupBookingInProgress = context.currentState.gb === true &&
                                    !context.currentState.groupBookingComplete;

    if (wantsToEndCall && groupBookingInProgress) {
      // BLOCK: Group booking in progress - don't allow premature goodbye
      console.log('[OpenAICallHandler] ⚠️ BLOCKED goodbye - group booking in progress');
      console.log('[OpenAICallHandler]   - gb:', context.currentState.gb);
      console.log('[OpenAICallHandler]   - groupBookingComplete:', context.currentState.groupBookingComplete);
      console.log('[OpenAICallHandler]   - gp:', context.currentState.gp?.map((p: { name: string }) => p.name));

      // Continue with booking flow instead of hanging up
      // AI response will handle asking for remaining info
    } else if (wantsToEndCall && context.currentState.bc === true) {
      // Booking confirmed - safe to say goodbye
      console.log('[OpenAICallHandler] Caller wants to end call - booking complete, hanging up gracefully');
      const goodbyeMessages = [
        "Perfect! Your appointments are all set. Have a lovely day!",
        "Beautiful! We'll see you soon. Take care!",
        "Wonderful! Everything's booked. Bye for now!"
      ];
      const randomGoodbye = goodbyeMessages[Math.floor(Math.random() * goodbyeMessages.length)];
      saySafe(vr, randomGoodbye);
      vr.hangup();
      return vr;
    } else if (wantsToEndCall && !context.currentState.gb) {
      // Not a group booking and caller wants to leave - allow it
      console.log('[OpenAICallHandler] Caller wants to end call - no active booking, hanging up gracefully');
      const goodbyeMessages = [
        "No worries! Feel free to call back anytime. Have a lovely day!",
        "That's fine! We're here when you need us. Take care!",
        "All good! Don't hesitate to call back. Bye for now!"
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
