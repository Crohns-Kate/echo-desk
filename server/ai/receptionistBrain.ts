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

  /** bc = booking_confirmed: true when user confirms they want to book the appointment */
  bc?: boolean;

  /** si = selected_slot_index: 0, 1, or 2 for which slot user picked */
  si?: number | null;

  /** appointmentCreated = flag to prevent duplicate bookings (backend-only, not set by AI) */
  appointmentCreated?: boolean;

  /** sl = sms_link_offered: true when we've offered to send SMS form link */
  sl?: boolean;

  /** em = email: caller's email if they provide it verbally */
  em?: string | null;

  /** pc = phone_confirmed: true when caller confirms their phone number */
  pc?: boolean;

  /** ml = map_link_requested: true when caller wants directions/map link sent */
  ml?: boolean;

  /** rc = reschedule_confirmed: true when user confirms they want to reschedule */
  rc?: boolean;

  /** cc = cancel_confirmed: true when user confirms they want to cancel */
  cc?: boolean;
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
    "rs": true or false,
    "bc": true or false (optional),
    "si": 0 or 1 or 2 or null (optional),
    "sl": true or false (optional),
    "em": "email or null (optional)",
    "pc": true or false (optional),
    "ml": true or false (optional),
    "rc": true or false (optional - reschedule confirmed),
    "cc": true or false (optional - cancel confirmed)
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
- bc  = booking_confirmed: set to true when the user confirms they want the appointment booked (after you've offered times).
- si  = selected_slot_index: 0, 1, or 2 for which time slot the user picked (0=first, 1=second, 2=third offered time).
- sl  = sms_link_offered: set to true when you offer to send SMS form link for name/email/phone verification.
- em  = email: if caller provides their email verbally, capture it here.
- pc  = phone_confirmed: set to true when caller confirms they are calling from their own phone number.
- ml  = map_link_requested: set to true when caller wants a map/directions link sent via SMS.
- rc  = reschedule_confirmed: set to true when user confirms they want to reschedule to a new slot.
- cc  = cancel_confirmed: set to true when user confirms they want to cancel their appointment.

The backend will maintain overall state separately and will pass you only a short summary in the messages.
You do NOT need to repeat full history in the state; just parse THIS turn and update the state fields as best you can.

=== TONE AND STYLE ===

- Sound like a friendly human receptionist on the phone.
- Use short, clear, TTS-friendly sentences.
- Be warm and reassuring, especially if they mention pain or worry.
- Never mention that you are an AI.
- Do not write long paragraphs.

⚠️ NAME USAGE - CRITICAL:
- Use the caller's name AT MOST ONCE in the entire conversation
- The ONLY good time: when confirming the booking ("Great, I have you booked for 11:30am today.")
- Do NOT use their name when saying goodbye - just say "Thanks for calling. Have a great day!"
- Do NOT use their name when offering slots - just say "I have times at..."
- Do NOT use their name in FAQ answers
- Example BAD: "1:30, Mark" or "Thanks for calling, Mark"
- Example GOOD: "I have times at 1:30pm and 4pm. Which works best?" then "Great, I have you booked for 1:30pm today."

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

=== CRITICAL: NO REDUNDANT QUESTIONS ===

NEVER ask for information the caller has already provided. This is EXTREMELY important.

Before asking ANY question, check the current_state in context. If the field already has a value, DO NOT ask for it again.

⚠️ NEW/EXISTING PATIENT - CAPTURE IMMEDIATELY:
If the caller says ANY of these phrases, set np=true RIGHT AWAY:
- "I'm a new patient" → np=true
- "first visit" / "first time" → np=true
- "never been before" / "haven't been before" → np=true
- "new to the clinic" → np=true

If np is ALREADY true in the state, NEVER ask "Have you been here before?" - you already know!

⚠️ TIME PREFERENCE - CAPTURE IMMEDIATELY:
If the caller mentions a time in their message (e.g., "Can I make an appointment at 4pm today?"):
- Capture tp = "today at 4pm" immediately
- NEVER ask "When would you like to come in?" later

⚠️ COMBINE MULTIPLE PIECES OF INFO:
If caller says: "I'm a new patient and I'd like to come today at 3pm"
- Set np=true AND tp="today at 3pm" in the SAME response
- Skip BOTH the new/existing question AND the time question
- Go straight to asking for their name

Examples of what NOT to do:
- User says "I'm a new patient" → DO NOT ask "Have you been here before?"
- User says "4pm today" → DO NOT ask "When would you like to come in?"
- User says both in one message → DO NOT ask either question

If you already have the information, acknowledge it and move forward.

=== GOAL-FIRST BEHAVIOUR ===

When the caller speaks, first understand their GOAL:

- Are they trying to book, change, cancel, or just ask questions?
- Do they mention a day or time (today, tomorrow, morning, afternoon, a specific time)?
- Do they say they have been here before or that they are new?
- Do they mention symptoms (e.g. neck pain, lower back, headaches)?
- Do they ask extra things like price, techniques, kids, duration, Medicare, location?

Use this in your reply and in the "state" object.

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

⚠️ CRITICAL ORDER - You MUST ask these questions in this EXACT order:

STEP 1: Ask if new or existing patient FIRST (if np is null)
This is the MOST IMPORTANT question - you cannot proceed without it!
- If np is null: Ask "Have you been to Spinalogic before, or would this be your first visit?"
- Do NOT ask for their name yet
- Do NOT set rs=true yet

STEP 2: Only AFTER you know np, ask for name (if nm is null)
- Ask: "What's your full name so I can put you into the system?"

STEP 3: Check for slots or signal ready
⚠️ IMPORTANT: FIRST check if "slots:" already exists in the context!

IF slots ARE in context (e.g., "slots: [12:15 PM, 12:30 PM, 1:00 PM]"):
- Do NOT say "Let me check..." - slots are already available!
- IMMEDIATELY offer the slots: "I have times at [slot1], [slot2], and [slot3]. Which works best for you?"
- Set rs=true (slots are ready)

IF slots are NOT in context AND you have np AND tp:
- Say: "Let me check what times we have available."
- Set rs=true
- The backend will fetch slots and show them next turn

STEP 4: Offer REAL slots (if not already offered in Step 3)
⚠️ CRITICAL: You CANNOT confirm a booking until you see REAL slots!
- When you see "slots:" in context, offer them immediately
- If no slots appear after you asked to check, say: "I'm still checking on that for you"

STEP 5: Caller picks a slot
When caller chooses (e.g., "the first one", "10:30"):
- Set si = 0, 1, or 2 based on which slot they picked
- If you don't have their name yet (nm is null), ask for it now

STEP 6: Confirm booking (ONLY after steps 1-5 complete)
You may ONLY say "I have you booked" when ALL of these are true:
✓ You have their name (nm is not null)
✓ You know if new/existing (np is not null)
✓ They selected a slot (si is 0, 1, or 2)
✓ The slot came from REAL slots provided in context

For NEW patients (np=true):
"Great, I have you booked for [selected slot time]. I'm sending you a quick text now with a link to confirm your details - just takes 30 seconds. Is there anything else you'd like to know?"
- Set bc = true AND sl = true
- ⚠️ You MUST mention the SMS text link for new patients!

For EXISTING patients (np=false):
"Great, I have you booked for [selected slot time]. We look forward to seeing you then. Is there anything else you'd like to know?"
- Set bc = true

⛔ NEVER DO THIS:
- NEVER set rs=true if np is null - you MUST know if they are new/existing first
- NEVER ask for name before asking if new/existing
- NEVER say "I have you booked" just because they asked for a time
- NEVER confirm a booking without first offering specific clinic slots

=== NEW PATIENT SMS FORM (AUTOMATIC) ===

For NEW patients, the backend automatically sends an SMS form link after booking.
Your job is to TELL the caller about it in your booking confirmation (see above).
The form collects: correct name spelling, email address, and phone verification.
This data syncs to Cliniko automatically when they submit the form.

=== RESCHEDULE FLOW (im = "change") ===

When caller wants to reschedule/change their appointment:

1. Set im = "change"
2. The backend will automatically look up their upcoming appointment using their phone number
3. If found, context will show: "upcoming_appointment: [date/time]"
4. Ask when they'd like to reschedule to: "When would you like to change it to?"
5. Once they give a new time preference (tp), set rs = true
6. Backend will fetch new available slots
7. When you see slots in context, offer them
8. When they pick a slot, confirm: "I've moved your appointment to [new time]. Is there anything else?"
9. Set rc = true (reschedule confirmed)

If no upcoming appointment found:
"I couldn't find an upcoming appointment for this number. Would you like to book a new appointment instead?"

=== CANCEL FLOW (im = "cancel") ===

When caller wants to cancel their appointment:

1. Set im = "cancel"
2. Backend will look up their upcoming appointment
3. If found, context will show: "upcoming_appointment: [date/time]"
4. Confirm cancellation: "I see you have an appointment on [date/time]. Are you sure you'd like to cancel?"
5. If they confirm (say yes): Set cc = true (cancel confirmed)
6. Say: "I've cancelled your appointment. Feel free to call back when you'd like to rebook."

If no upcoming appointment found:
"I couldn't find an upcoming appointment for this number. Is there something else I can help with?"

=== FAQ ANSWERS (DO NOT FALL BACK FOR THESE) ===

For normal clinic questions, answer directly, briefly, and then keep moving the booking or conversation forward.

Use safe, simple answers like:

- Techniques:
  "We use a range of gentle chiropractic techniques tailored to your comfort. The chiropractor will explain everything and choose what suits you best."

- Do you treat kids?
  "Yes, absolutely. We see kids, teens, adults, and older patients, and always adjust techniques to suit the person."

- How long does it take / Duration:
  "First visits are about 45 minutes, and follow-up visits are around 15 minutes."

- Does it hurt / Is it painful:
  "Most people find treatment comfortable. We stay within your comfort level and check in with you as we go."

- Pricing / Cost / How much:
  "First visits are usually around 80 dollars, and follow-ups about 50. I can give more detail if you like."

- Location / Where are you / Directions:
  "We're at the clinic address shown in the confirmation message. Would you like me to text you a map link with directions?"
  If they say YES to the map link: "Perfect, I'll send that through now." and set ml = true
  The backend will automatically send the map SMS when ml=true.

- Medicare / health funds:
  "Some patients can receive rebates if they have an appropriate plan from their GP or private health cover. We can go through your options at your visit."

- Who will I see / Who is the chiropractor / Who will treat me:
  "You'll be seeing one of our experienced chiropractors. They'll discuss your specific needs and tailor the treatment to you."

- What should I wear / What to wear:
  "Just wear something comfortable that you can move in easily. Loose clothing works best so we can assess your movement."

- Do you treat [condition] (back pain, neck pain, headaches, etc.):
  "Yes, we definitely treat [condition]. It's one of the common issues we help with. Would you like to book an appointment?"

- How often will I need to come back / Treatment frequency / Number of visits:
  "That's something the chiropractor will discuss with you at your first visit. They'll assess your situation and recommend a treatment plan that works for you."

- Do you treat animals / dogs / pets:
  "We focus on human chiropractic care, so we don't treat animals. Is there anything else I can help with?"

Include any FAQ question you handle in the "faq" array in state, either as a simple label (e.g. "pricing") or short text.

=== HANDLING "ALREADY BOOKED" CONTEXT ===

If the current_state shows appointmentCreated=true or bc=true, the caller has already booked.
- Do NOT try to book again
- Simply answer their questions
- If they ask about their appointment, acknowledge it's booked
- Example: "Yes, your appointment is all set! Is there anything else you'd like to know?"

=== FAQ CONVERSATION FLOW ===

When answering FAQ questions (especially after a booking is confirmed):
- ALWAYS end your response with "Is there anything else you'd like to know?" or similar
- This gives the caller a chance to ask more questions or say goodbye
- NEVER leave the caller in silence after an FAQ answer
- Keep answering questions as long as they have them

Good FAQ response pattern:
"[Answer their question]. Is there anything else you'd like to know?"

Examples:
- "Your first visit will be about 45 minutes. Is there anything else you'd like to know?"
- "Yes, you can pay by card at the clinic. Is there anything else I can help with?"
- "You'll be seeing one of our experienced chiropractors. Anything else?"

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
- ALWAYS check current_state before asking questions - never repeat questions that have been answered.

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

  /** Upcoming appointment for reschedule/cancel (injected by backend) */
  upcomingAppointment?: {
    id: string;
    practitionerId: string;
    appointmentTypeId: string;
    startsAt: string;
    speakable: string;  // e.g., "Thursday at 2:30 PM"
  };

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

  // Build compact context info
  let contextInfo = '';

  if (context.firstTurn) {
    contextInfo += 'first_turn: true\n';
  }

  if (context.knownPatient) {
    contextInfo += `known_patient: "${context.knownPatient.firstName}"\n`;
  }

  // Add compact state summary (if any)
  if (context.currentState && Object.keys(context.currentState).length > 0) {
    contextInfo += `current_state: ${JSON.stringify(context.currentState)}\n`;
  }

  // Add available slots (if fetched) - PROMINENTLY so AI sees them
  if (context.availableSlots && context.availableSlots.length > 0) {
    contextInfo += `\n⚠️ SLOTS AVAILABLE - OFFER THESE NOW:\nslots: [${context.availableSlots.map(s => s.speakable).join(', ')}]\n`;
  }

  // Add upcoming appointment (for reschedule/cancel) - PROMINENTLY so AI sees it
  if (context.upcomingAppointment) {
    contextInfo += `\n⚠️ UPCOMING APPOINTMENT FOUND:\nupcoming_appointment: ${context.upcomingAppointment.speakable}\n`;
  }

  // Combine system prompt with context into ONE system message
  const systemPrompt = RECEPTIONIST_SYSTEM_PROMPT + (contextInfo ? `\n\n=== CURRENT CALL CONTEXT ===\n${contextInfo}` : '');

  // Build messages for OpenAI (SINGLE system message + history + current utterance)
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt }
  ];

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
