/**
 * Intent Router - LLM-powered intent classification with expanded intent taxonomy
 * Classifies caller speech into actionable intents with high accuracy
 */

import { complete, isLLMAvailable, type LLMMessage } from './llmProvider';
import { checkSafetyGuardrails, type SafetyCheckResult } from './safetyGuardrails';

// Expanded intent taxonomy
export type IntentType =
  | 'booking_standard'      // Regular follow-up appointment
  | 'booking_new_patient'   // First-time patient booking
  | 'change_appointment'    // Reschedule existing
  | 'cancel_appointment'    // Cancel existing
  | 'faq_prices'           // Pricing questions
  | 'faq_hours'            // Operating hours
  | 'faq_location'         // Directions, parking
  | 'faq_first_visit'      // What to expect
  | 'faq_services'         // What services offered
  | 'faq_insurance'        // Insurance/payment
  | 'ask_human'            // Transfer to operator
  | 'greeting'             // Hello, hi, etc.
  | 'confirmation'         // Yes, okay, sure
  | 'negation'             // No, not that
  | 'clarification'        // What?, can you repeat
  | 'irrelevant'           // Off-topic chatter
  | 'emergency'            // Medical emergency
  | 'unknown';             // Couldn't determine

export interface IntentDetails {
  // Extracted entities
  name?: string;
  email?: string;
  phone?: string;
  preferredDay?: string;
  preferredTime?: string;
  appointmentType?: string;
  existingPatient?: boolean;

  // Original utterance analysis
  sentiment?: 'positive' | 'neutral' | 'negative' | 'urgent';
  questionType?: 'yes_no' | 'open' | 'choice' | 'statement';
}

export interface IntentResult {
  intent: IntentType;
  details: IntentDetails;
  confidence: number;
  rawResponse?: string;
  safetyCheck?: SafetyCheckResult;
}

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for a chiropractic clinic's phone system.
Analyze the caller's speech and return a JSON object with their intent and extracted details.

INTENT TYPES (choose exactly one):
- booking_standard: Returning patient wants to book an appointment
- booking_new_patient: First-time patient wants to book
- change_appointment: Wants to reschedule an existing appointment
- cancel_appointment: Wants to cancel an existing appointment
- faq_prices: Asking about costs, fees, prices, how much
- faq_hours: Asking about opening hours, when open/closed, business hours
- faq_location: Asking about address, directions, parking, where located
- faq_first_visit: Asking what to expect on first visit, consultation duration, appointment length
- faq_services: Asking about treatments/services offered, techniques used, methods, if treat kids/children/pediatric, does treatment hurt/painful, age ranges, what conditions treated
- faq_insurance: Asking about insurance, payment methods, Medicare, health funds
- ask_human: Wants to speak to a real person/receptionist
- greeting: Just saying hello/hi
- confirmation: Saying yes, okay, sure, that works
- negation: Saying no, not that, different
- clarification: Asking to repeat or didn't understand
- irrelevant: Off-topic, unrelated to clinic
- emergency: Medical emergency (chest pain, can't breathe, etc.)
- unknown: Cannot determine intent

EXTRACT THESE DETAILS (if mentioned):
- name: Caller's name
- email: Email address
- phone: Phone number
- preferredDay: Day they want (monday, tomorrow, today, etc.)
- preferredTime: Time preference (morning, afternoon, 3pm, etc.)
- appointmentType: Type of visit mentioned
- existingPatient: true if they indicate they've been before
- sentiment: positive/neutral/negative/urgent
- questionType: yes_no/open/choice/statement

Return ONLY valid JSON in this format:
{
  "intent": "intent_type",
  "confidence": 0.0-1.0,
  "details": { ... extracted details ... }
}`;

/**
 * Classify intent using LLM
 */
async function classifyWithLLM(utterance: string): Promise<IntentResult> {
  const messages: LLMMessage[] = [
    { role: 'system', content: INTENT_SYSTEM_PROMPT },
    { role: 'user', content: `Classify this caller speech:\n"${utterance}"` }
  ];

  const response = await complete(messages, {
    temperature: 0.2,
    maxTokens: 300
  });

  // Extract JSON from response
  const jsonMatch = response.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in LLM response');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    intent: parsed.intent || 'unknown',
    details: parsed.details || {},
    confidence: parsed.confidence || 0.8,
    rawResponse: response.content
  };
}

/**
 * Fallback keyword-based classification
 */
function classifyWithKeywords(utterance: string): IntentResult {
  const text = utterance.toLowerCase().trim();
  const details: IntentDetails = {};
  let intent: IntentType = 'unknown';
  let confidence = 0.6;

  // Emergency detection (highest priority)
  const emergencyKeywords = ['emergency', 'chest pain', 'can\'t breathe', 'heart attack', 'ambulance', 'dying', '000', '911'];
  if (emergencyKeywords.some(kw => text.includes(kw))) {
    return { intent: 'emergency', details: { sentiment: 'urgent' }, confidence: 0.95 };
  }

  // Ask human
  if (text.includes('speak to') || text.includes('talk to') || text.includes('real person') ||
      text.includes('operator') || text.includes('human') || text.includes('receptionist')) {
    intent = 'ask_human';
    confidence = 0.85;
  }
  // FAQ: Prices
  else if (text.includes('how much') || text.includes('cost') || text.includes('price') ||
           text.includes('fee') || text.includes('charge') || text.includes('pay')) {
    intent = 'faq_prices';
    confidence = 0.8;
  }
  // FAQ: Hours
  else if (text.includes('hours') || text.includes('open') || text.includes('close') ||
           text.includes('when are you')) {
    intent = 'faq_hours';
    confidence = 0.8;
  }
  // FAQ: Location
  else if (text.includes('where') || text.includes('address') || text.includes('direction') ||
           text.includes('parking') || text.includes('located')) {
    intent = 'faq_location';
    confidence = 0.8;
  }
  // FAQ: First visit
  else if (text.includes('first visit') || text.includes('first time') || text.includes('what to expect') ||
           text.includes('what happens') || text.includes('bring')) {
    intent = 'faq_first_visit';
    confidence = 0.8;
  }
  // FAQ: Insurance
  else if (text.includes('insurance') || text.includes('medicare') || text.includes('health fund') ||
           text.includes('cover') || text.includes('rebate')) {
    intent = 'faq_insurance';
    confidence = 0.8;
  }
  // Cancel
  else if (text.includes('cancel')) {
    intent = 'cancel_appointment';
    confidence = 0.85;
  }
  // Reschedule/change
  else if (text.includes('reschedule') || text.includes('change') || text.includes('move') ||
           text.includes('different time')) {
    intent = 'change_appointment';
    confidence = 0.8;
  }
  // Booking (check for new patient indicators)
  else if (text.includes('book') || text.includes('appointment') || text.includes('schedule') ||
           text.includes('come in') || text.includes('see the doctor')) {
    const isNew = text.includes('new patient') || text.includes('first') || text.includes('never been');
    intent = isNew ? 'booking_new_patient' : 'booking_standard';
    details.existingPatient = !isNew;
    confidence = 0.75;
  }
  // Confirmation
  else if (/^(yes|yeah|yep|sure|okay|ok|that works|sounds good|perfect)/.test(text)) {
    intent = 'confirmation';
    confidence = 0.9;
  }
  // Negation
  else if (/^(no|nope|not|different|other|neither)/.test(text)) {
    intent = 'negation';
    confidence = 0.9;
  }
  // Greeting
  else if (/^(hi|hello|hey|good morning|good afternoon|g'day)/.test(text)) {
    intent = 'greeting';
    confidence = 0.9;
  }
  // Clarification
  else if (text.includes('what') && text.includes('?') || text.includes('repeat') ||
           text.includes('didn\'t catch') || text.includes('pardon')) {
    intent = 'clarification';
    confidence = 0.7;
  }

  // Extract day preferences
  const dayPatterns = [
    { pattern: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, extract: (m: RegExpMatchArray) => m[1].toLowerCase() },
    { pattern: /\btomorrow\b/i, extract: () => 'tomorrow' },
    { pattern: /\btoday\b/i, extract: () => 'today' },
    { pattern: /\bthis week\b/i, extract: () => 'this_week' },
    { pattern: /\bnext week\b/i, extract: () => 'next_week' }
  ];

  for (const { pattern, extract } of dayPatterns) {
    const match = text.match(pattern);
    if (match) {
      details.preferredDay = extract(match);
      break;
    }
  }

  // Extract time preferences
  const timePatterns = [
    { pattern: /\b(morning|early)\b/i, extract: () => 'morning' },
    { pattern: /\b(afternoon|arvo)\b/i, extract: () => 'afternoon' },
    { pattern: /\b(evening|after work)\b/i, extract: () => 'evening' },
    { pattern: /\b(\d{1,2})\s*(?::|\.)?(\d{2})?\s*(am|pm)?\b/i, extract: (m: RegExpMatchArray) => {
      const hour = m[1];
      const min = m[2] || '00';
      const period = m[3] || (parseInt(hour) < 12 ? 'am' : 'pm');
      return `${hour}:${min}${period}`;
    }}
  ];

  for (const { pattern, extract } of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      details.preferredTime = extract(match);
      break;
    }
  }

  // Extract name (simple pattern)
  const nameMatch = text.match(/(?:my name is|i'm|this is|it's)\s+([a-z]+)/i);
  if (nameMatch) {
    details.name = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
  }

  // Determine sentiment
  if (text.includes('urgent') || text.includes('asap') || text.includes('emergency')) {
    details.sentiment = 'urgent';
  } else if (text.includes('thank') || text.includes('great') || text.includes('perfect')) {
    details.sentiment = 'positive';
  } else if (text.includes('frustrated') || text.includes('annoyed') || text.includes('ridiculous')) {
    details.sentiment = 'negative';
  } else {
    details.sentiment = 'neutral';
  }

  return { intent, details, confidence };
}

/**
 * Main intent classification function
 * Uses LLM when available, falls back to keywords
 */
export async function classifyIntent(utterance: string): Promise<IntentResult> {
  // First, check safety guardrails
  const safetyCheck = checkSafetyGuardrails(utterance);

  // If safety check triggers an override, use that
  if (safetyCheck.shouldOverride) {
    return {
      intent: safetyCheck.suggestedIntent as IntentType,
      details: { sentiment: 'urgent' },
      confidence: 0.99,
      safetyCheck
    };
  }

  // Try LLM classification if available
  if (isLLMAvailable()) {
    try {
      const result = await classifyWithLLM(utterance);
      if (result.confidence > 0.6) {
        result.safetyCheck = safetyCheck;
        return result;
      }
      console.log('[IntentRouter] LLM confidence too low, using keyword fallback');
    } catch (error) {
      console.warn('[IntentRouter] LLM classification failed:', error);
    }
  }

  // Fallback to keyword matching
  const result = classifyWithKeywords(utterance);
  result.safetyCheck = safetyCheck;
  return result;
}

/**
 * Get a human-readable description of the intent
 */
export function describeIntent(intent: IntentType): string {
  const descriptions: Record<IntentType, string> = {
    booking_standard: 'Book a standard appointment',
    booking_new_patient: 'Book new patient appointment',
    change_appointment: 'Change existing appointment',
    cancel_appointment: 'Cancel appointment',
    faq_prices: 'Question about pricing',
    faq_hours: 'Question about hours',
    faq_location: 'Question about location',
    faq_first_visit: 'Question about first visit',
    faq_services: 'Question about services',
    faq_insurance: 'Question about insurance',
    ask_human: 'Wants to speak to human',
    greeting: 'Greeting',
    confirmation: 'Confirmation',
    negation: 'Negation',
    clarification: 'Needs clarification',
    irrelevant: 'Irrelevant',
    emergency: 'Medical emergency',
    unknown: 'Unknown intent'
  };
  return descriptions[intent] || intent;
}
