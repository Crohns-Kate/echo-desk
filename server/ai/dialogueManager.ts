/**
 * Dialogue Manager - Orchestrates AI-driven conversation flow
 * Handles the dialogue loop: speech → intent → action → response
 */

import { classifyIntent, type IntentType, type IntentResult, describeIntent } from './intentRouter';
import { respondToQuery, getQuickResponse } from './knowledgeResponder';
import {
  getMemory,
  recordIntent,
  recordSystemResponse,
  updateCollectedInfo,
  setAwaitingResponse,
  getNextMissingInfo,
  markConfirmed,
  recordError,
  getConversationSummary,
  type ConversationMemory,
  type CollectedInfo
} from './stateMemory';
import { checkSafetyGuardrails, getSafeFallback, validateResponse } from './safetyGuardrails';
import { complete, isLLMAvailable, type LLMMessage } from './llmProvider';

export interface DialogueContext {
  callSid: string;
  tenantId?: number;
  clinicName?: string;
  timezone?: string;
  callerPhone?: string;
}

export interface DialogueResponse {
  speech: string;                  // What to say to caller
  action?: DialogueAction;         // Optional action to trigger
  nextStep?: string;               // Hint for next FSM step
  shouldTransfer?: boolean;        // Transfer to human
  shouldHangup?: boolean;          // End call
  collectDigits?: boolean;         // Expect DTMF input
  gatherHints?: string;           // Speech hints for Twilio
  intent: IntentType;             // Detected intent
  confidence: number;             // Intent confidence
}

export type DialogueAction =
  | { type: 'lookup_patient'; phone: string }
  | { type: 'search_availability'; day?: string; time?: string }
  | { type: 'create_booking'; slot: any; patientId?: string }
  | { type: 'cancel_appointment'; appointmentId?: string }
  | { type: 'send_form'; phone: string }
  | { type: 'transfer_to_human'; reason: string }
  | { type: 'log_intent'; intent: string; details: any };

/**
 * Main dialogue processing function
 * Takes caller speech and returns appropriate response
 */
export async function processUtterance(
  utterance: string,
  context: DialogueContext
): Promise<DialogueResponse> {
  const { callSid, tenantId, clinicName = 'the clinic', callerPhone } = context;

  console.log(`[DialogueManager] Processing: "${utterance}" for ${callSid}`);

  // Get or initialize memory
  const memory = getMemory(callSid, tenantId);

  // Check safety first
  const safetyCheck = checkSafetyGuardrails(utterance);
  if (safetyCheck.responseOverride) {
    recordIntent(callSid, safetyCheck.suggestedIntent as IntentType || 'unknown', utterance);
    recordSystemResponse(callSid, safetyCheck.responseOverride);

    return {
      speech: safetyCheck.responseOverride,
      intent: safetyCheck.suggestedIntent as IntentType || 'emergency',
      confidence: 0.99,
      shouldTransfer: safetyCheck.suggestedIntent === 'ask_human',
      action: safetyCheck.suggestedIntent === 'emergency'
        ? { type: 'transfer_to_human', reason: 'emergency' }
        : undefined
    };
  }

  // Classify intent
  const intentResult = await classifyIntent(utterance);
  console.log(`[DialogueManager] Intent: ${intentResult.intent} (${intentResult.confidence})`);

  // Record in memory
  recordIntent(callSid, intentResult.intent, utterance, intentResult.details);

  // Route based on intent
  const response = await routeIntent(intentResult, memory, context, utterance);

  // Record system response
  recordSystemResponse(callSid, response.speech);

  return response;
}

/**
 * Route to appropriate handler based on intent
 */
async function routeIntent(
  intentResult: IntentResult,
  memory: ConversationMemory,
  context: DialogueContext,
  utterance: string
): Promise<DialogueResponse> {
  const { intent, details, confidence } = intentResult;
  const { clinicName = 'the clinic', callerPhone } = context;

  switch (intent) {
    // === EMERGENCY ===
    case 'emergency':
      return {
        speech: "I'm hearing that this may be an emergency. If this is a medical emergency, please hang up and call 000 immediately. They can help you right away. Is this a medical emergency?",
        intent,
        confidence,
        action: { type: 'transfer_to_human', reason: 'emergency_detected' }
      };

    // === BOOKING INTENTS ===
    case 'booking_new_patient':
      updateCollectedInfo(context.callSid, { isNewPatient: true });
      return handleBookingIntent(memory, context, intentResult, true);

    case 'booking_standard':
      updateCollectedInfo(context.callSid, { isNewPatient: false });
      return handleBookingIntent(memory, context, intentResult, false);

    // === APPOINTMENT CHANGES ===
    case 'change_appointment':
      return {
        speech: "I can help you reschedule. Let me transfer you to our reception team who can find your appointment and help you change it.",
        intent,
        confidence,
        shouldTransfer: true,
        action: { type: 'transfer_to_human', reason: 'reschedule_request' }
      };

    case 'cancel_appointment':
      return {
        speech: "I can help you cancel your appointment. Let me transfer you to reception to process that for you.",
        intent,
        confidence,
        shouldTransfer: true,
        action: { type: 'cancel_appointment' }
      };

    // === FAQ INTENTS ===
    case 'faq_prices':
      return await handleFaqIntent('prices', utterance, context);

    case 'faq_hours':
      return await handleFaqIntent('hours', utterance, context);

    case 'faq_location':
      return await handleFaqIntent('location', utterance, context);

    case 'faq_first_visit':
      return await handleFaqIntent('first_visit', utterance, context);

    case 'faq_services':
      return await handleFaqIntent('services', utterance, context);

    case 'faq_insurance':
      return await handleFaqIntent('insurance', utterance, context);

    // === TRANSFER ===
    case 'ask_human':
      return {
        speech: "Absolutely, let me transfer you to our reception team. One moment please.",
        intent,
        confidence,
        shouldTransfer: true,
        action: { type: 'transfer_to_human', reason: 'caller_requested' }
      };

    // === DIALOGUE CONTROL ===
    case 'confirmation':
      return handleConfirmation(memory, context);

    case 'negation':
      return handleNegation(memory, context);

    case 'clarification':
      return handleClarification(memory, context);

    case 'greeting':
      return {
        speech: `Hello! Thanks for calling ${clinicName}. Are you looking to book an appointment today?`,
        intent,
        confidence,
        gatherHints: 'yes, no, appointment, question',
        nextStep: 'patient_type'
      };

    // === FALLBACK ===
    case 'irrelevant':
    case 'unknown':
    default:
      return handleUnknown(memory, context, utterance);
  }
}

/**
 * Handle booking intents
 */
async function handleBookingIntent(
  memory: ConversationMemory,
  context: DialogueContext,
  intentResult: IntentResult,
  isNewPatient: boolean
): Promise<DialogueResponse> {
  const { details } = intentResult;
  const { callSid, callerPhone } = context;

  // Update collected info with any extracted details
  if (details.name) {
    updateCollectedInfo(callSid, { callerName: details.name, firstName: details.name.split(' ')[0] });
  }
  if (details.preferredDay) {
    updateCollectedInfo(callSid, { preferredDay: details.preferredDay });
  }
  if (details.preferredTime) {
    updateCollectedInfo(callSid, { preferredTime: details.preferredTime });
  }

  // Determine what we still need
  const nextMissing = getNextMissingInfo(callSid);

  // If new patient and we haven't checked phone, do that first
  if (isNewPatient && memory.missing.needsPatientType) {
    setAwaitingResponse(callSid, 'confirmation');
    return {
      speech: "Great! I'll help you book your first appointment. Is this number a good one to text you at?",
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      nextStep: 'phone_confirm',
      gatherHints: 'yes, no',
      action: { type: 'log_intent', intent: 'booking_new_patient', details }
    };
  }

  // If returning patient, try to look them up
  if (!isNewPatient && callerPhone && !memory.collected.patientId) {
    return {
      speech: "Let me look up your account. One moment.",
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      nextStep: 'patient_lookup',
      action: { type: 'lookup_patient', phone: callerPhone }
    };
  }

  // If we have day preference, search availability
  if (memory.collected.preferredDay || details.preferredDay) {
    return {
      speech: "Let me find available times for you.",
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      nextStep: 'appointment_search',
      action: {
        type: 'search_availability',
        day: memory.collected.preferredDay || details.preferredDay,
        time: memory.collected.preferredTime || details.preferredTime
      }
    };
  }

  // Ask when they'd like to come
  setAwaitingResponse(callSid, 'date');
  return {
    speech: "When would you like to come in? You can say a day like Monday or Tuesday, or just say whenever is next available.",
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    nextStep: 'chief_complaint',
    gatherHints: 'monday, tuesday, wednesday, thursday, friday, saturday, tomorrow, today, next week'
  };
}

/**
 * Handle FAQ intents
 */
async function handleFaqIntent(
  category: string,
  utterance: string,
  context: DialogueContext
): Promise<DialogueResponse> {
  const { tenantId, clinicName } = context;

  try {
    const response = await respondToQuery(utterance, {
      tenantId,
      clinicName,
      category: category as any
    });

    // Add follow-up offer
    const followUp = " Would you like to book an appointment?";
    const fullResponse = response.answer + followUp;

    return {
      speech: fullResponse,
      intent: `faq_${category}` as IntentType,
      confidence: 0.9,
      nextStep: 'faq_followup',
      gatherHints: 'yes, no, book, appointment'
    };
  } catch (error) {
    console.error(`[DialogueManager] FAQ error:`, error);
    return {
      speech: getQuickResponse(category as any, clinicName) + " Would you like to book an appointment?",
      intent: `faq_${category}` as IntentType,
      confidence: 0.7,
      nextStep: 'faq_followup'
    };
  }
}

/**
 * Handle confirmation responses
 */
function handleConfirmation(memory: ConversationMemory, context: DialogueContext): DialogueResponse {
  const awaiting = memory.awaitingResponseType;

  if (awaiting === 'confirmation') {
    markConfirmed(context.callSid);
    return {
      speech: "Perfect! Let me create that booking for you now.",
      intent: 'confirmation',
      confidence: 0.95,
      nextStep: 'confirm_booking'
    };
  }

  // Generic confirmation - continue with flow
  return {
    speech: "Great! What would you like to do?",
    intent: 'confirmation',
    confidence: 0.9,
    nextStep: 'patient_type',
    gatherHints: 'appointment, book, question'
  };
}

/**
 * Handle negation responses
 */
function handleNegation(memory: ConversationMemory, context: DialogueContext): DialogueResponse {
  const awaiting = memory.awaitingResponseType;

  if (awaiting === 'slot') {
    return {
      speech: "No problem, let me find some other options for you.",
      intent: 'negation',
      confidence: 0.9,
      nextStep: 'appointment_search',
      action: { type: 'search_availability' }
    };
  }

  if (awaiting === 'confirmation') {
    return {
      speech: "No problem. Would you like to choose a different time, or is there something else I can help with?",
      intent: 'negation',
      confidence: 0.9,
      nextStep: 'appointment_search',
      gatherHints: 'different time, other options, something else, that\'s all'
    };
  }

  return {
    speech: "Okay, is there something else I can help you with today?",
    intent: 'negation',
    confidence: 0.85,
    gatherHints: 'appointment, question, no'
  };
}

/**
 * Handle clarification requests
 */
function handleClarification(memory: ConversationMemory, context: DialogueContext): DialogueResponse {
  // Repeat the last question if we have one
  if (memory.lastQuestion) {
    return {
      speech: `Sorry about that. ${memory.lastQuestion}`,
      intent: 'clarification',
      confidence: 0.95
    };
  }

  return {
    speech: "Sorry, let me repeat that. Would you like to book an appointment, or do you have a question I can help with?",
    intent: 'clarification',
    confidence: 0.9,
    gatherHints: 'appointment, book, question'
  };
}

/**
 * Handle unknown/irrelevant utterances
 */
async function handleUnknown(
  memory: ConversationMemory,
  context: DialogueContext,
  utterance: string
): Promise<DialogueResponse> {
  const errorCount = recordError(context.callSid, 'unknown_intent');

  // After 3 failures, offer transfer
  if (errorCount >= 3) {
    return {
      speech: "I'm having trouble understanding. Let me transfer you to our reception team who can help.",
      intent: 'unknown',
      confidence: 0.5,
      shouldTransfer: true,
      action: { type: 'transfer_to_human', reason: 'repeated_failures' }
    };
  }

  // Try LLM for a contextual response
  if (isLLMAvailable()) {
    try {
      const response = await generateContextualResponse(utterance, memory, context);
      if (response) {
        return {
          speech: response,
          intent: 'unknown',
          confidence: 0.6
        };
      }
    } catch (error) {
      console.warn('[DialogueManager] Contextual response failed:', error);
    }
  }

  // Fallback
  return {
    speech: "I didn't quite catch that. Would you like to book an appointment, or do you have a question I can help answer?",
    intent: 'unknown',
    confidence: 0.5,
    gatherHints: 'book, appointment, question, speak to someone'
  };
}

/**
 * Generate contextual response using LLM
 */
async function generateContextualResponse(
  utterance: string,
  memory: ConversationMemory,
  context: DialogueContext
): Promise<string | null> {
  const { clinicName } = context;

  const systemPrompt = `You are a helpful voice assistant for ${clinicName}, a chiropractic clinic.
The caller said something you're not sure how to handle.
Generate a SHORT, friendly response (under 30 words) that:
1. Acknowledges what they said
2. Redirects to how you can help (booking appointments or answering questions)
Do NOT provide medical advice.`;

  const conversationContext = memory.transcript.slice(-4).map(t =>
    `${t.role === 'caller' ? 'Caller' : 'Assistant'}: ${t.content}`
  ).join('\n');

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Recent conversation:\n${conversationContext}\n\nCaller just said: "${utterance}"\n\nYour response:` }
  ];

  const response = await complete(messages, {
    temperature: 0.5,
    maxTokens: 100
  });

  if (!response.content) return null;

  const validation = validateResponse(response.content);
  return validation.valid ? validation.sanitized : null;
}

/**
 * Get conversation state for FSM integration
 */
export function getDialogueState(callSid: string): {
  memory: ConversationMemory;
  summary: string;
  canContinue: boolean;
} {
  const memory = getMemory(callSid);
  return {
    memory,
    summary: getConversationSummary(callSid),
    canContinue: memory.errorCount < 5
  };
}
