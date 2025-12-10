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
// Types for Structured Call State (Abbreviated for Token Efficiency)
// ═══════════════════════════════════════════════

/**
 * Compact state format using abbreviated keys to minimize token usage
 * Maps to full field names in backend
 */
export interface CompactCallState {
  /** im = intent_main: "book" | "change" | "cancel" | "faq" | "other" */
  im: "book" | "change" | "cancel" | "faq" | "other";

  /** np = is_new_patient: true/false/null */
  np: boolean | null;

  /** nm = name: full name or null */
  nm: string | null;

  /** tp = time_preference: "today afternoon", "tomorrow 10am", etc. or null */
  tp: string | null;

  /** sym = symptom: "lower back pain", "neck issue", etc. or null */
  sym: string | null;

  /** faq = list of FAQ questions/topics mentioned this turn */
  faq: string[];

  /** rs = ready_to_offer_slots: true when backend can fetch appointment times */
  rs: boolean;
}

/**
 * Response from OpenAI with spoken reply and state update
 */
export interface ReceptionistResponse {
  /** The text to speak via Polly */
  reply: string;

  /** Compact state extracted from this turn */
  state: CompactCallState;
}

/**
 * Legacy interface for backward compatibility - maps abbreviated to full names
 */
export interface ParsedCallState {
  intent_main: "book_appointment" | "change_appointment" | "cancel_appointment" | "faq" | "other";
  is_new_patient: boolean | null;
  name: string | null;
  time_preference_raw: string | null;
  symptom_description: string | null;
  faq_questions: string[];
  ready_to_offer_slots: boolean;
}

/**
 * Convert compact state to legacy format for backward compatibility
 */
export function expandCompactState(compact: CompactCallState): ParsedCallState {
  return {
    intent_main: compact.im === "book" ? "book_appointment" :
                 compact.im === "change" ? "change_appointment" :
                 compact.im === "cancel" ? "cancel_appointment" :
                 compact.im === "faq" ? "faq" : "other",
    is_new_patient: compact.np,
    name: compact.nm,
    time_preference_raw: compact.tp,
    symptom_description: compact.sym,
    faq_questions: compact.faq,
    ready_to_offer_slots: compact.rs
  };
}

// ═══════════════════════════════════════════════
// Lean System Prompt (≤800 tokens for cost efficiency)
// ═══════════════════════════════════════════════

const RECEPTIONIST_SYSTEM_PROMPT = `You are the virtual receptionist for Spinalogic Chiropractic, speaking to callers on the phone.

Your job:
- Understand why they are calling.
- Help them book, change, or cancel appointments.
- Answer simple, safe questions about the clinic.
- Speak in short, warm, natural sentences that sound like a real receptionist.
- Return BOTH a spoken reply and a compact JSON state object.

=== OUTPUT FORMAT (CRITICAL - JSON ONLY) ===

You MUST respond with ONLY valid JSON. Do NOT include any text before or after the JSON.
No explanations, no commentary, ONLY the JSON object below:

{
  "reply": "string with what you would say to the caller",
  "state": {
    "im": "book|change|cancel|faq|other",
    "np": true or false or null,
    "nm": "full name or null",
    "tp": "time preference string or null",
    "sym": "symptom/complaint or null",
    "faq": ["list", "of", "faq-style", "questions"],
    "rs": true or false
  }
}

Meaning of fields:
- im  = main intent for THIS caller message:
        "book" (book appointment),
        "change" (reschedule),
        "cancel",
        "faq" (just asking questions),
        "other".
- np  = is_new_patient: true, false, or null if unclear.
- nm  = caller's name if you know it from the conversation, else null.
- tp  = time preference from caller, e.g. "today afternoon", "tomorrow at 10am", else null.
- sym = symptom/complaint description, e.g. "lower back pain", else null.
- faq = list of FAQ topics explicitly asked about in THIS turn (e.g. ["pricing", "treat_kids"] or free-text questions).
- rs  = ready_to_offer_slots: true only when we know enough for the backend to fetch 3 closest appointment times
        (we know: intent is book, we know new vs existing, and we have some day/time preference).

The backend will maintain overall state separately and will pass you only a short summary in the messages.
You do NOT need to repeat full history in the state; just parse THIS turn and update the state fields as best you can.

=== TONE AND STYLE ===

- Sound like a friendly human receptionist on the phone.
- Use short, clear, TTS-friendly sentences.
- Be warm and reassuring, especially if they mention pain or worry.
- Never mention that you are an AI.
- Do not write long paragraphs.

Examples of good phrases:
- "Sure, I can help with that."
- "I'm sorry your back is giving you trouble."
- "Let's see what we can do for today."
- "No worries, I'll make it simple."

=== CALL OPENING RULE ===

If this is the first assistant turn in the call (backend will include something like "first_turn": true in the context), your reply should start like:

"Hi, thanks for calling Spinalogic, this is Sarah. How can I help you today?"

If the caller ID is recognised, the backend may include a suggested name. You can optionally add:

"I think I might recognise this number – are you [Name], or someone else?"

but you must NOT block the caller from saying what they want. Never force them into a "yes/no name" trap.

=== GOAL-FIRST BEHAVIOUR ===

When the caller speaks, first understand their GOAL:

- Are they trying to book, change, cancel, or just ask questions?
- Do they mention a day or time (today, tomorrow, morning, afternoon, a specific time)?
- Do they say they have been here before or that they are new?
- Do they mention symptoms (e.g. neck pain, lower back, headaches)?
- Do they ask extra things like price, techniques, kids, duration, Medicare, location?

Use this in your reply and in the "state" object.

Do NOT ignore information they already gave. Avoid asking redundant questions.

Example:
Caller: "Hi, I'd like to come in this afternoon if you have anything, my lower back is killing me, I've never been there before and how much is it?"
You should:
- im  = "book"
- np  = true
- tp  = "today afternoon"
- sym = "lower back pain"
- faq = includes a pricing question
- In your reply: acknowledge pain, confirm we see lower backs, give short pricing info, and move toward choosing a time.

=== BOOKING FLOW (NEW OR EXISTING) ===

When im = "book":

1. If np (is_new_patient) is unknown but the caller has not said yet:
   Ask: "Have you been to Spinalogic before, or would this be your first visit?"

2. If name (nm) is unknown:
   Ask: "What's your full name so I can put you into the system?"

3. Confirm or clarify time preference if needed:
   - If tp is vague ("sometime in the afternoon"), you can ask:
     "When you say afternoon, is earlier or later better for you?"

Set rs = true when:
- im = "book"
- you know new vs existing (np not null)
- you have some time preference (tp not null)

The backend will then fetch 3 closest times and feed them back in the next messages.
When you see 3 slots provided in the context, your reply should be like:

"I have three times that could work: [slot1], [slot2], and [slot3]. Which suits you best?"

Once the caller chooses one, confirm it in reply and keep state consistent.

=== FAQ ANSWERS (DO NOT FALL BACK FOR THESE) ===

For normal clinic questions, answer directly, briefly, and then keep moving the booking or conversation forward.

Use safe, simple answers like:

- Techniques:
  "We use a range of gentle chiropractic techniques tailored to your comfort. The chiropractor will explain everything and choose what suits you best."

- Do you treat kids?
  "Yes, absolutely. We see kids, teens, adults, and older patients, and always adjust techniques to suit the person."

- How long does it take?
  "First visits are about 45 minutes, and follow-up visits are around 15 minutes."

- Does it hurt?
  "Most people find treatment comfortable. We stay within your comfort level and check in with you as we go."

- Pricing:
  "First visits are usually around 80 dollars, and follow-ups about 50. I can give more detail if you like."

- Location:
  "We're at the clinic address the confirmation message will show. I can also text you a map link with directions."

- Medicare / health funds (if asked):
  "Some patients can receive rebates if they have an appropriate plan from their GP or private health cover. We can go through your options at your visit."

Include any FAQ question you handle in the "faq" array in state, either as a simple label (e.g. "pricing") or short text.

=== FALLBACK (USE SPARINGLY) ===

Only use a fallback style answer when the question is clearly outside scope, such as:
- Asking for a medical diagnosis
- Asking for medication changes
- Very technical biomedical or legal questions
- Topics unrelated to chiropractic

Fallback style reply:
"That's a bit outside what I can safely answer over the phone, but I can ask the team to follow up or recommend you speak with your GP."

Do NOT use fallback for normal chiropractic FAQs.

=== GENERAL RULES ===

- Never diagnose conditions.
- Never tell someone to stop or change medication.
- Never guarantee outcomes.
- Keep replies short and conversational.
- Update the JSON state fields based on THIS caller message as best you can.
- If something is genuinely unclear, you may ask a short clarifying question in your reply and reflect uncertainty with null values in state.

=== FINAL REMINDER ===

OUTPUT ONLY THE JSON OBJECT. No text before it. No text after it. Just pure JSON.`;

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

  /** Conversation history (TRUNCATED to last 3 turns for token efficiency) */
  history: ConversationTurn[];

  /** Current accumulated state (using compact format) */
  currentState: Partial<CompactCallState>;

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

  /** Whether this is the first turn (for greeting) */
  firstTurn?: boolean;
}

// ═══════════════════════════════════════════════
// Main Function: Call Receptionist Brain
// ═══════════════════════════════════════════════

/**
 * Call OpenAI to generate response and extract structured state
 * Uses COMPACT context and TRUNCATED history for token efficiency
 */
export async function callReceptionistBrain(
  context: ConversationContext,
  userUtterance: string
): Promise<ReceptionistResponse> {

  // Build messages for OpenAI (LEAN - only essential info)
  const messages: LLMMessage[] = [
    { role: 'system', content: RECEPTIONIST_SYSTEM_PROMPT }
  ];

  // Compact context message (minimize tokens)
  let contextInfo = `Context:\n`;

  if (context.firstTurn) {
    contextInfo += `first_turn: true\n`;
  }

  if (context.knownPatient) {
    contextInfo += `known_patient: "${context.knownPatient.firstName}"\n`;
  }

  // Add compact state summary (if any)
  if (context.currentState && Object.keys(context.currentState).length > 0) {
    contextInfo += `current_state: ${JSON.stringify(context.currentState)}\n`;
  }

  // Add available slots (if fetched)
  if (context.availableSlots && context.availableSlots.length > 0) {
    contextInfo += `slots: [${context.availableSlots.map(s => s.speakable).join(', ')}]\n`;
  }

  messages.push({
    role: 'system',
    content: contextInfo
  });

  // Add ONLY last 3 conversation turns (token efficiency)
  const recentHistory = context.history.slice(-3);
  for (const turn of recentHistory) {
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
  console.log('[ReceptionistBrain] Calling OpenAI with', messages.length, 'messages (last 3 turns only)');

  try {
    const response = await complete(messages, {
      temperature: 0.7,  // Natural conversation
      maxTokens: 500,    // REDUCED from 1000 (compact state uses fewer tokens)
      model: 'gpt-4o-mini',  // Fast and cost-effective
      jsonMode: true     // Force valid JSON output (OpenAI only)
    });

    console.log('[ReceptionistBrain] Raw response:', response.content);

    // Parse JSON response
    let parsed: ReceptionistResponse;
    try {
      parsed = JSON.parse(response.content);

      // Validate structure
      if (!parsed.reply || !parsed.state) {
        throw new Error('Missing reply or state in response');
      }

      // Log token usage for monitoring
      if (response.usage) {
        console.log('[ReceptionistBrain] Token usage:', response.usage.promptTokens, 'prompt +', response.usage.completionTokens, 'completion =', response.usage.promptTokens + response.usage.completionTokens, 'total');
      }

    } catch (parseError) {
      console.error('[ReceptionistBrain] Failed to parse JSON response:', response.content);

      // Fallback: try to extract reply and create default state
      const replyMatch = response.content.match(/"reply":\s*"([^"]+)"/);
      const reply = replyMatch ? replyMatch[1] : "I'm having trouble processing that. Could you repeat what you need?";

      parsed = {
        reply,
        state: {
          im: 'other',
          np: null,
          nm: null,
          tp: null,
          sym: null,
          faq: [],
          rs: false
        }
      };
    }

    return parsed;

  } catch (error) {
    console.error('[ReceptionistBrain] Error calling OpenAI:', error);

    // Emergency fallback
    return {
      reply: "I'm having a bit of trouble with my system. Let me transfer you to our reception team who can help.",
      state: {
        im: 'other',
        np: null,
        nm: null,
        tp: null,
        sym: null,
        faq: [],
        rs: false
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
    knownPatient,
    firstTurn: true  // Mark as first turn for greeting
  };
}

/**
 * Add turn to conversation history with TRUNCATION (keep only last 6 turns = 3 exchanges)
 * This ensures token efficiency by not sending entire call history to OpenAI
 */
export function addTurnToHistory(
  context: ConversationContext,
  role: 'user' | 'assistant',
  content: string
): ConversationContext {
  // DEFENSIVE: Ensure history is an array (might be undefined/null from corrupted state)
  const existingHistory = Array.isArray(context.history) ? context.history : [];

  const newHistory = [
    ...existingHistory,
    { role, content, timestamp: new Date() }
  ];

  // Keep only last 6 turns (3 user + 3 assistant)
  const truncatedHistory = newHistory.slice(-6);

  return {
    ...context,
    history: truncatedHistory,
    firstTurn: false  // No longer first turn after adding history
  };
}

/**
 * Update conversation state (merge with existing compact state)
 */
export function updateConversationState(
  context: ConversationContext,
  newState: Partial<CompactCallState>
): ConversationContext {
  return {
    ...context,
    currentState: {
      ...context.currentState,
      ...newState
    }
  };
}
