# Echo Desk Call Flow State Machine

> **⚠️ DEPRECATED - DO NOT USE**
>
> This document describes the OLD FSM-based call flow which has been replaced by the
> OpenAI conversation mode. The FSM approach (callFlowHandler.ts) is no longer the
> primary call handler.
>
> **For current call flow behavior, see: [/docs/CALLFLOW-SPEC.md](./CALLFLOW-SPEC.md)**
>
> The current implementation uses:
> - `server/ai/receptionistBrain.ts` - AI system prompt and state types
> - `server/services/openai-call-handler.ts` - Main conversation handler
> - `server/routes/voice.ts` - Twilio webhooks (openai-incoming, openai-continue)
>
> This file is kept for historical reference only.

---

## Overview (DEPRECATED)

The Echo Desk voice receptionist implements a finite state machine (FSM) to manage call flow. This ensures predictable, maintainable conversation logic with proper error handling and state transitions.

**Implementation**: `server/services/callFlowHandler.ts` (CallFlowHandler class) - **DEPRECATED**

## State Diagram

```
┌─────────────┐
│  GREETING   │ "Thanks for calling. Is this your first visit?"
└──────┬──────┘
       ↓
┌─────────────────────┐
│ PATIENT_TYPE_DETECT │ Parse "new" vs "returning" OR detect FAQ intent
└──────┬──────────────┘
       ├─ FAQ question detected ────────┐
       ├─ new ────────────────────┐     ↓
       ↓                           ↓   ┌──────────────────┐
┌──────────────────────┐  ┌────────────────────────┐   │ FAQ_ANSWERING    │
│ RETURNING_PATIENT    │  │ NEW_PATIENT_PHONE      │   │ Answer question  │
│ _LOOKUP              │  │ _CONFIRM               │   └────┬─────────────┘
└──────┬───────────────┘  └───────┬────────────────┘        │
       ├─ found                   ↓                          ├─ book appointment
       │                    ┌──────────────────┐             ├─ another FAQ
       ├─ not found ───────→│ SEND_FORM_LINK   │             ├─ done (hangup)
       ↓                    └───────┬──────────┘             ↓
┌────────────────────┐             ↓              ┌──────────────────┐
│ CHIEF_COMPLAINT    │      ┌──────────────────┐  │ FAQ_FOLLOWUP     │
│                    │      │ WAITING_FOR_FORM │  │ What else?       │
└──────┬─────────────┘      └───────┬──────────┘  └──────────────────┘
       ↓                            ↓
┌────────────────────┐      ┌──────────────────┐
│ APPOINTMENT_SEARCH │←─────│ FORM_RECEIVED    │
└──────┬─────────────┘      └──────────────────┘
       ↓
┌────────────────────┐
│ PRESENT_OPTIONS    │ Offer 3 slots
└──────┬─────────────┘
       ↓
┌────────────────────┐
│ CONFIRM_BOOKING    │ Create appointment in Cliniko
└──────┬─────────────┘
       ↓
┌────────────────────┐
│ CLOSING            │ "Anything else?" → "Bye!"
└────────────────────┘

       ↓ (on error)
┌────────────────────┐
│ ERROR_RECOVERY     │ Transfer to human
└────────────────────┘
```

## State Definitions

### GREETING

**Purpose**: Welcome caller and start conversation

**Entry Prompt**:
```
"Thanks for calling. Is this your first visit with us?"
```

**Expected Input**:
- Speech: "yes", "no", "new", "returning", "first visit", "been before"
- DTMF: 1 (yes/new), 2 (no/returning)

**Hints**: `"yes, no, new, returning, first visit"`

**Session Data Written**: None

**Session Data Read**: None

**Transitions**:
- → `PATIENT_TYPE_DETECT` (always)

**Implementation**: `handleGreeting()`

---

### PATIENT_TYPE_DETECT

**Purpose**: Determine if caller is new or returning patient, OR detect FAQ intent

**Entry Prompt**: (none - processes response from GREETING)

**Expected Input**:
- "new", "first", "yes" → new patient
- "returning", "no", "been before" → returning patient
- FAQ question (e.g., "what are your hours?") → FAQ answering
- Unclear response → retry (max 2 attempts)

**FAQ Detection**:
- Uses `detectFaqIntent()` from `server/services/faq.ts`
- Checks for question keywords (hours, location, cost, services, etc.)
- If FAQ detected and speech length > 10 chars → transitions to `FAQ_ANSWERING`

**Session Data Written**:
- `ctx.retryCount` - incremented on unclear response

**Session Data Read**:
- `ctx.retryCount` - check if max retries reached

**Transitions**:
- Clear "new" → `NEW_PATIENT_PHONE_CONFIRM`
- Clear "returning" → `RETURNING_PATIENT_LOOKUP`
- Unclear + retryCount < 2 → stay in `PATIENT_TYPE_DETECT` (retry prompt)
- Unclear + retryCount >= 2 → `NEW_PATIENT_PHONE_CONFIRM` (assume new)

**Retry Prompt**:
```
"Sorry, I didn't catch that. Have you been here before? Say yes if you're a returning patient, or no if this is your first visit."
```

**Improved Features**:
- Conversational retry prompt variations
- FAQ intent detection before patient type determination
- Better handling of unclear responses

**Implementation**: `handlePatientTypeDetect(speechRaw, digits)`

---

### FAQ_ANSWERING

**Purpose**: Answer frequently asked questions about the clinic

**Entry Prompt**: (none - answers question immediately)

**Process**:
1. Search FAQ database using `searchFaqByQuery(speechRaw)`
2. If match found:
   - Format answer for TTS using `formatFaqAnswerForSpeech()`
   - Speak the answer
   - Ask "Is there anything else I can help you with? I can book an appointment if you need one."
3. If no match found:
   - Say "I can help you book an appointment. Let me get some details."
   - Transition to `PATIENT_TYPE_DETECT`

**Expected Input** (after answering):
- "book", "appointment", "yes", "schedule" → wants to book
- "no", "nothing", "that's all" → done
- Another question → answer another FAQ

**Session Data Written**: None

**Session Data Read**: None

**Transitions**:
- FAQ found → `FAQ_FOLLOWUP` (via gather action)
- FAQ not found → `PATIENT_TYPE_DETECT`
- No response → hangup with farewell

**Implementation**: `handleFAQ(speechRaw)`

**Supported FAQ Categories**:
- hours, location, parking, billing, services, preparation
- cancellation, first-visit, urgent, booking

---

### FAQ_FOLLOWUP

**Purpose**: Handle followup after answering an FAQ

**Entry Prompt**: (already spoken in FAQ_ANSWERING)

**Expected Input**:
- "book", "appointment", "yes" → book appointment
- "no", "nothing", "that's all" → done
- Another question → answer FAQ

**Session Data Written**: None

**Session Data Read**: None

**Transitions**:
- Wants to book → `PATIENT_TYPE_DETECT`
- Done → `CLOSING` (hangup)
- Another FAQ → `FAQ_ANSWERING`

**Implementation**: `handleFAQFollowup(speechRaw)`

---

### RETURNING_PATIENT_LOOKUP

**Purpose**: Search Cliniko for existing patient by phone number

**Entry Prompt**: (none - API operation)

**Expected Input**: None (automated)

**API Call**: `findPatientByPhoneRobust(ctx.callerPhone)`

**Session Data Written**:
- `ctx.patientId` - Cliniko patient ID (if found)
- `ctx.patientName` - Full name (if found)
- `ctx.patientFirstName` - First name (if found)
- `ctx.patientEmail` - Email (if found)

**Session Data Read**:
- `ctx.callerPhone` - Phone number from Twilio

**Transitions**:
- 1 patient found → `CHIEF_COMPLAINT` with greeting: `"Hi {firstName}! What brings you in today?"`
- 0 patients found → `NEW_PATIENT_PHONE_CONFIRM` with message: `"I don't see an account with this number. Let's get you set up as a new patient."`
- Multiple patients found → Disambiguation prompt (ask caller to confirm first name)
- API error → `ERROR_RECOVERY`

**Disambiguation Prompt** (if multiple patients):
```
"I see a few accounts with this number. Are you {name1} or {name2}? Or press 3 if neither."
```

**Implementation**: `handleReturningPatientLookup()`

---

### NEW_PATIENT_PHONE_CONFIRM

**Purpose**: Confirm phone number is correct for SMS intake form

**Entry Prompt**:
```
"Is the number ending in {lastThree} the best one to text you at? Press 1 for yes, 2 for no."
```

**Expected Input**:
- Speech: "yes", "no"
- DTMF: 1 (yes), 2 (no)

**Session Data Written**: None (yet)

**Session Data Read**:
- `ctx.callerPhone` - Extract last 3 digits for confirmation

**Transitions**:
- Confirmed (yes/1) → `SEND_FORM_LINK`
- Not confirmed (no/2) → Prompt for alternate phone number

**Alternate Phone Prompt**:
```
"Please enter the 10-digit mobile number we should text, followed by pound."
```
(Expects DTMF 10-digit phone, then transitions to `SEND_FORM_LINK`)

**Implementation**: `handleNewPatientPhoneConfirm()`, `handlePhoneConfirm(speechRaw, digits)`

---

### SEND_FORM_LINK

**Purpose**: Send new patient intake form via SMS

**Entry Prompt**:
```
"Perfect! I've sent you a text with a link. I'll wait right here while you fill it out - takes about 30 seconds."
```

**Expected Input**: None (automated)

**Actions**:
1. Generate unique token: `form_{callSid}_{timestamp}`
2. Send SMS via `sendNewPatientForm({ to, token, clinicName })`
3. Save token in `ctx.formToken`
4. Play hold music
5. Redirect to form polling

**Session Data Written**:
- `ctx.formToken` - Unique form token for this call

**Session Data Read**:
- `ctx.callerPhone` - Destination for SMS

**Transitions**:
- Success → `WAITING_FOR_FORM`
- SMS send error → `ERROR_RECOVERY`

**Hold Music**: `http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3`

**Implementation**: `handleSendFormLink()`

---

### WAITING_FOR_FORM

**Purpose**: Poll database for form completion (submitted via web)

**Entry Prompt**: (none - background polling)

**Expected Input**: None (automated polling)

**Poll Interval**: 3 seconds

**Timeout**: 120 seconds (2 minutes)

**Logic**:
1. Check `conversations.context.formData` in database
2. If found → `FORM_RECEIVED`
3. If not found + time < 120s → wait 3s and check again
4. If not found + time >= 120s → `ERROR_RECOVERY` with timeout message

**Timeout Message**:
```
"I haven't received the form yet. No worries - I'll call you back in 5 minutes when you're ready, or you can call us anytime."
```
(Then hang up)

**Session Data Written**: None

**Session Data Read**:
- `ctx.formToken` - Used to track time elapsed
- `ctx.conversationId` - Used to fetch updated context

**Transitions**:
- Form submitted → `FORM_RECEIVED`
- Timeout (120s) → `ERROR_RECOVERY` → hangup
- Database error → `ERROR_RECOVERY`

**Implementation**: `handleCheckFormStatus()`

**Note**: Form is submitted via `POST /api/form/:token` which updates the conversation context with `formData: { firstName, lastName, email, phone }`

---

### FORM_RECEIVED

**Purpose**: Acknowledge form completion and transition to appointment booking

**Entry Prompt**:
```
"Got it! Thanks {firstName}. What brings you in today?"
```

**Expected Input**:
- Speech: Chief complaint / reason for visit

**Session Data Written**: None (formData already in context)

**Session Data Read**:
- `ctx.formData.firstName` - To personalize greeting
- `ctx.formData.lastName` - Stored for Cliniko
- `ctx.formData.email` - Stored for Cliniko
- `ctx.formData.phone` - Stored for Cliniko

**Transitions**:
- Always → `CHIEF_COMPLAINT` (with Gather for speech input)

**Implementation**: `handleFormReceived()`

---

### CHIEF_COMPLAINT

**Purpose**: Collect reason for visit / chief complaint

**Entry Prompt**:
- Returning patient: (already spoken in `RETURNING_PATIENT_LOOKUP`)
- New patient: (already spoken in `FORM_RECEIVED`)
- Prompt: `"What brings you in today?"`

**Expected Input**:
- Speech: Free-form description ("back pain", "neck issue", "headaches", etc.)

**Timeout**: 5 seconds

**Session Data Written**:
- `ctx.complaint` - Lowercased, trimmed speech input

**Session Data Read**: None

**Transitions**:
- Any response → `APPOINTMENT_SEARCH`

**Implementation**: `handleChiefComplaint(speechRaw)`

**Note**: Complaint is stored but not currently used for slot filtering (future enhancement: suggest appropriate appointment type based on complaint)

---

### APPOINTMENT_SEARCH

**Purpose**: Query Cliniko for available appointment slots

**Entry Prompt**:
```
"Sorry to hear about your {complaint}. Let me find the next available appointment."
```

**Expected Input**: None (automated)

**API Call**:
```typescript
getAvailability({
  fromISO: now.toISOString(),
  toISO: twoWeeksLater.toISOString(),
  timezone: AUST_TZ
})
```

**Query Window**: Next 14 days from current time

**Session Data Written**:
- `ctx.appointmentSlots` - Array of top 3 slots:
  ```typescript
  [{
    startISO: "2025-11-21T09:00:00.000Z",
    speakable: "9:00am tomorrow",
    practitionerId: env.CLINIKO_PRACTITIONER_ID,
    appointmentTypeId: env.CLINIKO_APPT_TYPE_ID
  }, ...]
  ```

**Session Data Read**:
- `ctx.complaint` - For personalized message

**Transitions**:
- Slots found (>=1) → `PRESENT_OPTIONS`
- No slots found → `ERROR_RECOVERY` with message:
  ```
  "I don't have any openings in the next two weeks. Would you like me to add you to our waitlist? Let me transfer you to our reception."
  ```
- API error → `ERROR_RECOVERY`

**Slot Formatting**:
- Uses `formatSpeakableTime()` helper
- Examples: "9:00am today", "2:30pm tomorrow", "10:00am Monday, November 25th"

**Implementation**: `handleAppointmentSearch()`

---

### PRESENT_OPTIONS

**Purpose**: Offer caller 3 appointment time options

**Entry Prompt**:
```
"I have {count} options available. Option 1: {slot1}. Option 2: {slot2}. Option 3: {slot3}. Which works best? Press 1, 2, or 3."
```

**Expected Input**:
- Speech: "one", "two", "three", "first", "second", "third", "option one", etc.
- DTMF: 1, 2, 3

**Hints**: `"one, two, three, option one, option two, option three"`

**Timeout**: 10 seconds

**Session Data Written**: None (yet)

**Session Data Read**:
- `ctx.appointmentSlots` - To format the options list

**Transitions**:
- Valid choice (1-3) → `CONFIRM_BOOKING` with `ctx.selectedSlotIndex` set
- Invalid choice + retryCount < 2 → stay in `PRESENT_OPTIONS` (retry)
- Invalid choice + retryCount >= 2 → `ERROR_RECOVERY`

**Retry Prompt**:
```
"Sorry, I didn't catch that. [repeats options]"
```

**Implementation**: `handlePresentOptions()`, `handleChooseSlot(speechRaw, digits)`

---

### CONFIRM_BOOKING

**Purpose**: Create appointment in Cliniko and confirm to caller

**Entry Prompt**:
```
"{firstName}, perfect! You're all set for {slot.speakable} with Dr. Michael. I'll text you a confirmation now."
```

**Expected Input**: None (automated)

**API Call**:
```typescript
createAppointmentForPatient(phoneToUse, {
  startsAt: slot.startISO,
  practitionerId: env.CLINIKO_PRACTITIONER_ID,
  appointmentTypeId: appointmentTypeId,  // NEW_PATIENT or standard
  notes: "...",
  fullName: fullName,
  email: email
})
```

**Appointment Type Logic**:
- New patient (no `ctx.patientId` + has `ctx.formData`) → `CLINIKO_NEW_PATIENT_APPT_TYPE_ID`
- Returning patient (`ctx.patientId` exists) → `CLINIKO_APPT_TYPE_ID`

**Phone Logic**:
- New patient with form data → use `ctx.formData.phone` (may differ from caller ID)
- Returning patient → use `ctx.callerPhone`

**Session Data Written**:
- `ctx.patientId` - Cliniko patient ID (from appointment response)

**Session Data Read**:
- `ctx.selectedSlotIndex` - Which slot was chosen
- `ctx.appointmentSlots[selectedSlotIndex]` - The selected slot
- `ctx.formData` - New patient details (if applicable)
- `ctx.patientFirstName` - For confirmation message
- `ctx.callerPhone` - For SMS confirmation

**Actions**:
1. Create appointment in Cliniko
2. Send SMS confirmation via `sendAppointmentConfirmation()`
3. Log appointment in local database (for reschedule/cancel later)

**SMS Confirmation** (non-blocking - errors logged but don't stop flow):
```
Your appointment is confirmed for {speakable} at {clinicName}. See you soon!
```

**Transitions**:
- Success → `CLOSING`
- Booking API error → `ERROR_RECOVERY` with message:
  ```
  "I'm having trouble creating the appointment. Let me transfer you to our reception."
  ```

**Implementation**: `handleConfirmBooking()`

---

### CLOSING

**Purpose**: Graceful call ending with option for additional help

**Entry Prompt**:
```
"Anything else I can help with?"
```

**Expected Input**:
- Speech: "no", "nothing", "that's all", or silence
- Any other response → (future: route to appropriate handler)

**Timeout**: 3 seconds

**Default Action** (if no response or "no"):
```
"Perfect! See you soon. Bye!"
```
(Then hangup)

**Session Data Written**: None

**Session Data Read**: None

**Transitions**:
- Always → hangup after default message
- (Future: could transition to FAQ handler, reschedule, cancel, etc.)

**Implementation**: `handleClosing()`

---

### ERROR_RECOVERY

**Purpose**: Handle errors gracefully, create alerts, transfer to human

**Entry Prompt**: (varies based on error context)

Common messages:
```
"I'm having trouble looking up your account. Let me transfer you to our reception."
"I'm having trouble finding available times. Let me transfer you to our reception."
"I'm having trouble creating the appointment. Let me transfer you to our reception."
```

**Expected Input**: None

**Actions**:
1. Create alert in database with reason and payload
2. Speak error message
3. Hangup (or transfer to human if configured)

**Alert Reasons**:
- `cliniko_error` - Cliniko API failure
- `booking_failed` - Appointment creation failed
- `no_availability` - No slots found
- `sms_error` - SMS send failure
- `human_request` - Caller explicitly requested human

**Session Data Written**: None

**Session Data Read**: (varies based on context)

**Transitions**:
- → `GREETING` (retry flow - not currently implemented)
- → `CLOSING` (end call gracefully - not currently implemented)
- → hangup (current behavior)

**Implementation**: Inline in various handlers (no dedicated `handleErrorRecovery()`)

---

## State Transition Rules

Valid transitions are enforced in `VALID_TRANSITIONS` constant:

```typescript
const VALID_TRANSITIONS: Record<CallState, CallState[]> = {
  [CallState.GREETING]: [CallState.PATIENT_TYPE_DETECT],
  [CallState.PATIENT_TYPE_DETECT]: [CallState.RETURNING_PATIENT_LOOKUP, CallState.NEW_PATIENT_PHONE_CONFIRM],
  [CallState.RETURNING_PATIENT_LOOKUP]: [CallState.CHIEF_COMPLAINT, CallState.NEW_PATIENT_PHONE_CONFIRM],
  [CallState.NEW_PATIENT_PHONE_CONFIRM]: [CallState.SEND_FORM_LINK],
  [CallState.SEND_FORM_LINK]: [CallState.WAITING_FOR_FORM],
  [CallState.WAITING_FOR_FORM]: [CallState.FORM_RECEIVED, CallState.ERROR_RECOVERY],
  [CallState.FORM_RECEIVED]: [CallState.CHIEF_COMPLAINT],
  [CallState.CHIEF_COMPLAINT]: [CallState.APPOINTMENT_SEARCH],
  [CallState.APPOINTMENT_SEARCH]: [CallState.PRESENT_OPTIONS, CallState.ERROR_RECOVERY],
  [CallState.PRESENT_OPTIONS]: [CallState.CONFIRM_BOOKING, CallState.APPOINTMENT_SEARCH],
  [CallState.CONFIRM_BOOKING]: [CallState.CLOSING],
  [CallState.CLOSING]: [],
  [CallState.ERROR_RECOVERY]: [CallState.GREETING, CallState.CLOSING]
};
```

Invalid transitions are logged as warnings but currently allowed (defensive programming).

## Session Context Schema

The `CallContext` interface tracks state across HTTP requests:

```typescript
interface CallContext {
  state: CallState;                    // Current FSM state
  callSid: string;                     // Twilio Call SID (session key)
  callerPhone: string;                 // E.164 format caller ID
  patientId?: string;                  // Cliniko patient ID (if found)
  patientName?: string;                // Full name from Cliniko
  patientFirstName?: string;           // First name from Cliniko
  patientEmail?: string;               // Email from Cliniko
  formToken?: string;                  // Unique token for new patient form
  formData?: {                         // Submitted via web form
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  complaint?: string;                  // Chief complaint (free text)
  appointmentSlots?: Array<{           // Available slots from Cliniko
    startISO: string;
    speakable: string;
    practitionerId?: string;
    appointmentTypeId?: string;
  }>;
  selectedSlotIndex?: number;          // Index of chosen slot (0-2)
  retryCount: number;                  // Retry counter for disambiguation
  conversationId?: number;             // FK to conversations table
}
```

Stored as JSONB in `conversations.context`.

## Persistence & Recovery

**Save Points**:
- After every state transition (`await this.saveContext()`)
- Ensures context survives across Twilio webhook calls

**Load Points**:
- At start of every webhook handler (`await handler.loadContext()`)
- Restores full context from database using `callSid`

**Implementation**:
- `CallFlowHandler.saveContext()` → `storage.updateConversation(conversationId, { context: this.ctx })`
- `CallFlowHandler.loadContext()` → `storage.getConversationById(conversationId)`

## Error Handling Rules

1. **Cliniko API errors** → Create alert, transition to `ERROR_RECOVERY`, transfer to human
2. **No availability** → Create alert, transition to `ERROR_RECOVERY`, offer waitlist
3. **SMS errors** → Log warning, continue call (non-blocking)
4. **Form timeout** → `ERROR_RECOVERY`, offer callback
5. **Unclear responses** → Retry up to 2 times, then assume default or error
6. **Database errors** → Log error, continue best-effort (context loss may occur)

## Future Enhancements

### Planned State Additions
- `FAQ_HANDLER` - Answer common questions using knowledge base
- `RESCHEDULE_SEARCH` - Find existing appointment and offer new times
- `CANCEL_CONFIRM` - Confirm cancellation of existing appointment
- `MULTIPLE_PATIENT_DISAMBIGUATE` - Handle multiple patients with same phone (currently inline)
- `ALTERNATE_PHONE_COLLECT` - Dedicated state for collecting different phone number (currently inline)

### Planned Context Additions
- `ctx.faqIntent` - Detected FAQ category
- `ctx.existingAppointmentId` - For reschedule/cancel flows
- `ctx.sentimentScore` - Real-time sentiment tracking
- `ctx.qualityScore` - Conversation quality metrics

### Planned Transitions
- `CLOSING` → `FAQ_HANDLER` (if caller has question)
- `CHIEF_COMPLAINT` → `FAQ_HANDLER` (if matches FAQ pattern)
- `GREETING` → `RESCHEDULE_SEARCH` (if caller says "reschedule")
- `GREETING` → `CANCEL_CONFIRM` (if caller says "cancel")

See `docs/echo-desk-roadmap.md` for timeline.
