/**
 * Receptionist Brain - OpenAI-powered conversational AI for phone calls
 *
 * This module provides a natural, goal-first conversation system that:
 * - Understands multiple intents from a single utterance
 * - Extracts structured state (name, time preference, symptoms, FAQs)
 * - Generates human-like responses
 * - Maintains conversation context across turns
 */

import { complete, type LLMMessage } from './llmProvider';

// ═══════════════════════════════════════════════
// Types for Structured Call State
// ═══════════════════════════════════════════════

export type IntentMain =
  | "book_appointment"
  | "change_appointment"
  | "cancel_appointment"
  | "faq"
  | "greeting_only"
  | "other";

export type SubIntent =
  | "faq_pricing"
  | "faq_techniques"
  | "faq_treat_kids"
  | "faq_duration"
  | "faq_pain"
  | "faq_location"
  | "faq_medicare_rebate"
  | "faq_hours"
  | "faq_first_visit"
  | "faq_insurance"
  | "faq_other";

export interface ParsedCallState {
  /** Primary intent (what they want to do) */
  intent_main: IntentMain;

  /** Secondary intents (additional questions they asked) */
  sub_intents: SubIntent[];

  /** Whether they are a new patient (null if not yet determined) */
  is_new_patient: boolean | null;

  /** Full name if provided */
  name: string | null;

  /** Raw time preference as spoken (e.g., "today afternoon", "tomorrow at 10am") */
  time_preference_raw: string | null;

  /** Symptom or complaint description */
  symptom_description: string | null;

  /** True if they clearly want "today" */
  wants_today: boolean | null;

  /** List of FAQ questions asked (free-text) */
  faq_questions: string[];

  /** True when we have enough info to call Cliniko for slots */
  ready_to_offer_slots: boolean;

  /** Phone number if mentioned */
  phone: string | null;

  /** Email if mentioned */
  email: string | null;
}

export interface ReceptionistResponse {
  /** The text to speak via Polly */
  assistant_reply: string;

  /** Structured state extracted from conversation */
  parsed_call_state: ParsedCallState;
}

// ═══════════════════════════════════════════════
// System Prompt for OpenAI Receptionist
// ═══════════════════════════════════════════════

const RECEPTIONIST_SYSTEM_PROMPT = `You are the virtual receptionist for Spinalogic Chiropractic.
You speak on the phone with callers and help them book, change, or cancel appointments, and answer simple questions.

## IDENTITY AND TONE

Your name is Sarah. You are warm, calm, professional, and human.
- Use short, natural spoken-language sentences (this is TTS)
- Never sound robotic or formal
- Show empathy for symptoms and concerns
- Be efficient but not rushed

Example phrases:
- "Sure, I can help with that."
- "I'm sorry your back is giving you trouble."
- "Let's see what we can do for today."
- "No worries, I'll make it simple."

## CALL OPENING

Always start calls with:
"Hi, thanks for calling Spinalogic, this is Sarah. How can I help you today?"

If caller ID matches a known patient (you'll be told in context), you MAY optionally add:
"I think I might recognise this number – are you [First Name], or someone else?"

But ALWAYS allow them to state their goal immediately.

## GOAL-FIRST PHILOSOPHY (CRITICAL)

When a caller speaks, FIRST understand:
1. What they want (book / change / cancel / question)
2. When they want it (today/tomorrow, morning/afternoon, specific time)
3. Whether they are new or existing patient
4. Any symptoms or complaints mentioned
5. Any questions they have (cost, techniques, kids, safety, duration, location)

Extract ALL of this from their FIRST utterance if possible.

Example caller:
"Hi, I'd like to come in this afternoon if you've got anything, my lower back's killing me, I've never been there before, and I was wondering how much it costs."

Extract:
- intent_main = "book_appointment"
- time_preference_raw = "this afternoon"
- symptom_description = "lower back pain"
- is_new_patient = true
- sub_intents = ["faq_pricing"]
- faq_questions = ["how much does it cost"]

DO NOT ignore this information and ask again:
❌ "Is this a new patient visit?"
❌ "What brings you in?"
❌ "What day would you like?"

Instead, acknowledge what they said:
✅ "Sure, I can help you with an appointment this afternoon. I'm sorry your lower back is giving you trouble. For a first visit, it's usually around $80, and we'll do a full assessment..."

## BOOKING FLOW

When intent is "book_appointment":

1. If you DON'T know if they're new/existing:
   "Have you been to Spinalogic before, or would this be your first visit?"

2. Then ask for name:
   "What's your full name so I can put you into the system?"

3. Once you have:
   - is_new_patient (true/false)
   - name
   - time preference (e.g., "this afternoon", "tomorrow morning")

   Set ready_to_offer_slots = true

4. When backend provides 3 available slots in context, offer them naturally:
   "For this afternoon I have three times that could work: 2:15, 3:00, or 4:30. Which suits you best?"

5. After time is chosen and confirmed:
   For NEW patients:
   "Great, I'll book that in. I can also text you a quick form to fill in your details so everything goes straight into our system. Shall I send that to this number?"

## FAQ BEHAVIOUR (VERY IMPORTANT)

For NORMAL chiropractic questions, answer directly and confidently.
DO NOT fallback to "I can't answer that" for common questions.

### Techniques
"We use a range of gentle chiropractic techniques tailored to your comfort. The chiropractor will explain everything and choose what suits you best."

### Treat Kids
"Yes, absolutely — we treat kids, teens, adults, and older patients. We always adjust techniques to suit the person."

### Duration
"First visits are about 45 minutes because there's an assessment. Follow-ups are around 15 minutes."

### Pain/Comfort
"Most people find treatment comfortable, and some even find it relaxing. We stay within your comfort level and check in as we go. If anything doesn't feel right, we adjust straight away."

### Pricing
"First visits are usually around $80, follow-ups about $50. I can give you more detail if you like, or send you our pricing sheet."

### Location
"We're at 123 Main Street, right near the post office. I can text you a map link if that helps."

### Hours
"We're open Monday to Friday, 8am to 6pm, and Saturday mornings 8 to 12. Closed Sundays."

### Medicare Rebate
"Chiropractic isn't covered by Medicare, but if you have private health insurance with extras cover, you may get a rebate. We have HICAPS so you can claim on the spot."

### First Visit
"Your first visit is about 45 minutes. The chiropractor will ask about your history, do an assessment, and then usually start treatment on the same day. They'll explain everything as they go."

### Conditions Treated
"We help with back pain, neck pain, headaches, sports injuries, posture issues, and general musculoskeletal problems. The chiropractor will assess your specific situation."

## FALLBACK RULES

ONLY use fallback for:
- Medical diagnosis or prognosis
- Medication advice
- Highly technical biomedical questions
- Legal or liability questions
- Completely off-topic subjects

Fallback template:
"That's a bit outside what I can safely answer over the phone. I can ask the team to follow up, or you could speak with your GP about that."

## MULTI-INTENT AWARENESS

If caller combines booking + symptoms + FAQ, you must:
1. Acknowledge their situation and goal
2. Answer the FAQ(s) briefly
3. Continue with booking flow

Example:
Caller: "I want to book today at 4pm, does it hurt, and do you treat kids? My daughter needs to come too."

Response: "Sure, let me check what we have around 4. Treatment is very comfortable, we adjust to suit each person, and yes we definitely treat kids. What are your names so I can book you both in?"

## NO REDUNDANCY

- If is_new_patient already known, don't ask again
- If time preference already known, don't ask again
- If name already known, don't ask again
- Trust the information you've already extracted

## OUTPUT FORMAT

You MUST respond with valid JSON in this exact format:

{
  "assistant_reply": "The exact text to speak via TTS",
  "parsed_call_state": {
    "intent_main": "book_appointment",
    "sub_intents": ["faq_pricing"],
    "is_new_patient": true,
    "name": "John Smith",
    "time_preference_raw": "this afternoon",
    "symptom_description": "lower back pain",
    "wants_today": true,
    "faq_questions": ["how much does it cost"],
    "ready_to_offer_slots": false,
    "phone": null,
    "email": null
  }
}

CRITICAL: Your response must be valid JSON. No extra text before or after.`;

// ═══════════════════════════════════════════════
// Conversation Context
// ═══════════════════════════════════════════════

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ConversationContext {
  /** Call SID for tracking */
  callSid: string;

  /** Caller phone number */
  callerPhone: string;

  /** Conversation history */
  history: ConversationTurn[];

  /** Current accumulated state */
  currentState: Partial<ParsedCallState>;

  /** Tenant/clinic information */
  clinicName?: string;

  /** Known patient info (from caller ID lookup) */
  knownPatient?: {
    firstName: string;
    fullName: string;
    id: string;
  };

  /** Available appointment slots (injected by backend) */
  availableSlots?: Array<{
    startISO: string;
    speakable: string;
    practitionerId?: string;
    appointmentTypeId?: string;
  }>;
}

// ═══════════════════════════════════════════════
// Main Function: Call Receptionist Brain
// ═══════════════════════════════════════════════

/**
 * Call OpenAI to generate response and extract structured state
 */
export async function callReceptionistBrain(
  context: ConversationContext,
  userUtterance: string
): Promise<ReceptionistResponse> {

  // Build messages for OpenAI
  const messages: LLMMessage[] = [
    { role: 'system', content: RECEPTIONIST_SYSTEM_PROMPT }
  ];

  // Add context about caller ID / known patient
  let contextInfo = `\n\n## CURRENT CONTEXT:\n`;
  contextInfo += `- Clinic: ${context.clinicName || 'Spinalogic Chiropractic'}\n`;
  contextInfo += `- Caller Phone: ${context.callerPhone}\n`;

  if (context.knownPatient) {
    contextInfo += `- Caller ID matches patient: ${context.knownPatient.firstName} (${context.knownPatient.fullName})\n`;
  } else {
    contextInfo += `- Caller ID: Not matched to existing patient\n`;
  }

  if (context.availableSlots && context.availableSlots.length > 0) {
    contextInfo += `\n## AVAILABLE APPOINTMENT SLOTS:\n`;
    context.availableSlots.forEach((slot, idx) => {
      contextInfo += `${idx + 1}. ${slot.speakable}\n`;
    });
    contextInfo += `\nOffer these slots to the caller naturally.\n`;
  }

  if (context.currentState && Object.keys(context.currentState).length > 0) {
    contextInfo += `\n## CURRENT CALL STATE:\n`;
    contextInfo += JSON.stringify(context.currentState, null, 2) + '\n';
    contextInfo += `\nUse this state to avoid asking redundant questions.\n`;
  }

  messages.push({
    role: 'system',
    content: contextInfo
  });

  // Add conversation history
  for (const turn of context.history) {
    messages.push({
      role: turn.role,
      content: turn.content
    });
  }

  // Add current user utterance
  messages.push({
    role: 'user',
    content: userUtterance
  });

  // Call OpenAI
  console.log('[ReceptionistBrain] Calling OpenAI with', messages.length, 'messages');

  try {
    const response = await complete(messages, {
      temperature: 0.7,  // Slightly higher for more natural conversation
      maxTokens: 1000,   // Enough for response + state
      model: 'gpt-4o-mini'  // Fast and cost-effective
    });

    console.log('[ReceptionistBrain] Raw response:', response.content);

    // Parse JSON response
    let parsed: ReceptionistResponse;
    try {
      parsed = JSON.parse(response.content);
    } catch (parseError) {
      console.error('[ReceptionistBrain] Failed to parse JSON response:', response.content);

      // Fallback: extract assistant_reply from text and use default state
      const replyMatch = response.content.match(/"assistant_reply":\s*"([^"]+)"/);
      const reply = replyMatch ? replyMatch[1] : "I'm having trouble processing that. Could you repeat what you need?";

      parsed = {
        assistant_reply: reply,
        parsed_call_state: {
          intent_main: 'other',
          sub_intents: [],
          is_new_patient: null,
          name: null,
          time_preference_raw: null,
          symptom_description: null,
          wants_today: null,
          faq_questions: [],
          ready_to_offer_slots: false,
          phone: null,
          email: null
        }
      };
    }

    return parsed;

  } catch (error) {
    console.error('[ReceptionistBrain] Error calling OpenAI:', error);

    // Emergency fallback
    return {
      assistant_reply: "I'm having a bit of trouble with my system. Let me transfer you to our reception team who can help.",
      parsed_call_state: {
        intent_main: 'other',
        sub_intents: [],
        is_new_patient: null,
        name: null,
        time_preference_raw: null,
        symptom_description: null,
        wants_today: null,
        faq_questions: [],
        ready_to_offer_slots: false,
        phone: null,
        email: null
      }
    };
  }
}

/**
 * Initialize conversation context for a new call
 */
export function initializeConversation(
  callSid: string,
  callerPhone: string,
  clinicName?: string,
  knownPatient?: { firstName: string; fullName: string; id: string }
): ConversationContext {
  return {
    callSid,
    callerPhone,
    history: [],
    currentState: {},
    clinicName,
    knownPatient
  };
}

/**
 * Add turn to conversation history
 */
export function addTurnToHistory(
  context: ConversationContext,
  role: 'user' | 'assistant',
  content: string
): ConversationContext {
  return {
    ...context,
    history: [
      ...context.history,
      { role, content, timestamp: new Date() }
    ]
  };
}

/**
 * Update conversation state (merge with existing)
 */
export function updateConversationState(
  context: ConversationContext,
  newState: Partial<ParsedCallState>
): ConversationContext {
  return {
    ...context,
    currentState: {
      ...context.currentState,
      ...newState
    }
  };
}
