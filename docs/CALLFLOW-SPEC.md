# Echo Desk Call Flow Specification v2.0

> **CANONICAL SOURCE OF TRUTH** - This file defines the actual call flow behavior.
> All other documentation must conform to this spec.
> If code differs from this spec, code must be fixed.
> Last updated: December 2024

## Overview

Echo Desk uses an **OpenAI-powered conversational AI** (not FSM) to handle voice calls.
The system is built on three principles:

1. **Linear progression** - Once a stage is complete, never go back
2. **Intent locking** - Once booking/cancel/reschedule intent is detected, never reset
3. **Loop prevention** - Maximum 2 asks per question, then deterministic fallback

---

## 1. Intents

The system recognizes five intents (set in `currentState.im`):

| Intent | Trigger Examples | Behavior |
|--------|------------------|----------|
| `book` | "make an appointment", "book me in", "come in today" | Full booking flow |
| `change` | "reschedule", "change my appointment", "move to Friday" | Lookup + reschedule flow |
| `cancel` | "cancel my appointment" | Lookup + cancel flow |
| `faq` | "how much does it cost?", "where are you located?" | Answer + offer booking |
| `other` | Unclear or out-of-scope | Clarify or handoff |

### Intent Lock Rule

**Once `im` is set to `book`, `change`, or `cancel`:**
- `intentLocked = true`
- AI cannot reset intent to `other` or `faq`
- System never asks "What can I help you with?" again
- This prevents mid-call resets

---

## 2. Booking Stages (Linear State Machine)

```
INTENT → NEW_OR_EXISTING → SHARED_PHONE → COLLECT_NAME → COLLECT_TIME →
OFFER_SLOTS → CONFIRM_SLOT → COLLECT_CONTACT → BOOKING_COMPLETE → CALL_ENDED
```

### Stage Definitions

| Stage | Purpose | Guards |
|-------|---------|--------|
| `INTENT` | Detect intent (book/change/cancel) | First utterance after greeting |
| `NEW_OR_EXISTING` | New patient or returning? | Only ask if unclear from context |
| `SHARED_PHONE` | "Booking for yourself or someone else?" | Only if possiblePatientId exists, never after slot selection |
| `COLLECT_NAME` | Get full name | Skip if already known and confirmed |
| `COLLECT_TIME` | Get day/time preference | "today afternoon", "tomorrow morning" |
| `OFFER_SLOTS` | Present 3 available times | From Cliniko availability |
| `CONFIRM_SLOT` | User selects slot (0, 1, or 2) | "option one", "the first one", "1" |
| `COLLECT_CONTACT` | Get email/phone for new patients | Skip if existing patient |
| `BOOKING_COMPLETE` | Appointment created in Cliniko | SMS confirmation sent |
| `CALL_ENDED` | Graceful close | "Thanks for calling!" |

### Stage Progression Rules

1. **No backward transitions** - Once past a stage, never re-enter it
2. **Stages can be skipped** - If info already known, jump forward
3. **Use `isPastStage()` to check** - Guards against re-asking questions

---

## 3. Shared Phone Handling

When caller's phone matches an existing Cliniko patient:

### Flow
```
1. Set possiblePatientId, possiblePatientName (NOT confirmedPatientId)
2. Ask: "Are you booking for yourself, or for someone else?"
3. If "myself" → Ask for name confirmation → Set confirmedPatientId if match
4. If "someone else" → Clear possiblePatientId → Proceed as new patient
5. Set sharedPhoneResolved = true
```

### Guards (Critical)
- **sharedPhoneResolved = true** → Never ask again
- **Past SHARED_PHONE stage** → Never ask again
- **Slot already selected** → Never ask again
- **Booking complete** → Never ask again

---

## 4. Identity Confirmation ("Are you X?")

When user provides a name that matches an existing patient:

### Flow
```
1. Store in nameDisambiguation: { existingName, spokenName }
2. Ask: "Just to confirm — are you [existingName]?"
3. If "yes" → Set confirmedPatientId, identityResolved = true
4. If "no" → Clear possiblePatientId, identityResolved = true, proceed as new
5. If unclear → Ask once more (max 2), then fallback to new patient
```

### Guards (Critical)
- **identityResolved = true** → Never ask "Are you X?" again
- **Maximum 2 asks** → Then proceed as new patient

---

## 5. Loop Prevention

### Question Ask Counts

Track per-question type (max 2 asks):

```typescript
type QuestionKey =
  | 'new_or_existing'
  | 'shared_phone_disambiguation'
  | 'identity_confirmation'
  | 'name_capture'
  | 'email_capture'
  | 'time_preference'
  | 'slot_selection'
  | 'phone_confirmation';
```

### Fallback After 2 Failures

| Question | Fallback |
|----------|----------|
| new_or_existing | Assume new patient |
| shared_phone_disambiguation | Clear possiblePatientId, proceed |
| identity_confirmation | Treat as new patient |
| name_capture | Offer SMS form link |
| time_preference | Offer "first available" |
| slot_selection | Confirm first slot |

---

## 6. Noise/No-Match Handling

### Low Confidence Detection
- Confidence < 0.55 → Potential background noise
- **BUT** whitelist common responses: "yes", "yep", "yeah", "no", "ok", etc.

### Flow
```
1. If whitelisted response (even low confidence) → Process normally
2. If NOT whitelisted + low confidence → Increment noiseCount
3. noiseCount = 1 → "Sorry, I'm getting a bit of background noise. Could you say that again?"
4. noiseCount >= 2 → Send SMS booking link + offer callback
5. NEVER reset intent or stage on no-match
```

---

## 7. Reschedule Flow

### Prerequisites
- `im = 'change'`
- Patient found in Cliniko
- Upcoming appointment exists

### Flow
```
1. Look up patient by phone (findPatientByPhoneRobust)
2. Get next upcoming appointment (getNextUpcomingAppointment)
3. Tell user: "I see you have an appointment on [date/time]"
4. Ask for new preferred time
5. Offer available slots
6. On confirmation: rescheduleAppointment() in Cliniko
7. Send SMS confirmation
8. Set rc = true (reschedule confirmed)
9. Graceful close
```

### TwiML Safety
- If expect_user_reply = false but not complete → Add safety Gather
- rc = true in state → Close call gracefully

---

## 8. Cancel Flow

### Prerequisites
- `im = 'cancel'`
- Patient found in Cliniko
- Upcoming appointment exists

### Flow
```
1. Look up patient and upcoming appointment
2. Confirm: "I see you have an appointment on [date/time]. Are you sure you'd like to cancel?"
3. On "yes": cancelAppointment() in Cliniko
4. Confirm: "I've cancelled your appointment. Feel free to call back to rebook."
5. Set cc = true (cancel confirmed)
6. Graceful close
```

### TwiML Safety
- cc = true in state → Close call gracefully

---

## 9. "Send Me a Link" Handling

Context-aware routing:

| Context | Utterance | Action |
|---------|-----------|--------|
| Booking flow active | "send me a link" | Send booking link SMS |
| No booking context | "send me directions" | Send map link SMS |
| Explicit directions | "where are you located" | Send map link SMS |

### Detection
```typescript
const inBookingContext = im === 'book' || intentLocked || availableSlots || bookingStage;
const wantsDirections = utterance.includes('direction') || utterance.includes('map');

if (wantsSmsLink && inBookingContext && !wantsDirections) {
  // Send booking link
} else if (wantsDirections) {
  // Send map link
}
```

---

## 10. TwiML Safety Rules

### Never Return Dead-End TwiML

Every response MUST have one of:
1. `<Gather>` - Continue conversation
2. `<Hangup>` - Only after explicit close (cc=true, rc=true, booking complete + "no")
3. `<Redirect>` - Retry on error

### When expect_user_reply = false

Check for explicit close conditions:
- Cancel complete (cc = true)
- Reschedule complete (rc = true)
- Booking complete + caller said "no" to "anything else?"

If none of above → Add safety Gather to continue conversation.

---

## 11. Key Files

| File | Purpose |
|------|---------|
| `server/ai/receptionistBrain.ts` | AI system prompt, state types, stage helpers |
| `server/services/openai-call-handler.ts` | Main conversation handler, TwiML generation |
| `server/routes/voice.ts` | Twilio webhooks: openai-incoming, openai-continue |
| `server/services/cliniko.ts` | Cliniko API: availability, booking, cancel, reschedule |

---

## 12. Debug Logging

Every turn logs:
```
[OpenAICallHandler] ═══════════════════════════════════════════
[OpenAICallHandler] 📞 TURN START - callSid: xxx
[OpenAICallHandler] 📊 State: intent=book, stage=collect_name
[OpenAICallHandler] 🔒 Locks: intentLocked=true, sharedPhoneResolved=false
[OpenAICallHandler] 📝 Patient: possible=John Smith, confirmed=none
[OpenAICallHandler] 📋 Counters: noiseCount=0, emptyCount=0
[OpenAICallHandler] ═══════════════════════════════════════════
```

---

## 13. Test Scenarios

### A) Booking - Existing Patient
```
"Make an appointment" → "been before" → name → "tomorrow morning" → slot → confirm
✅ Intent locked
✅ Shared phone asked once (if applicable)
✅ Identity confirmed once
✅ No loops
```

### B) Booking - New Patient
```
"First time" → name → time → slot → email → confirm
✅ Skip shared phone (no existing patient)
✅ Collect contact info
```

### C) Booking - Shared Phone (Child)
```
Phone matches existing patient →
"Booking for yourself or someone else?" → "my child" →
"What's your child's name?" → proceed as new patient
✅ sharedPhoneResolved = true
✅ Never asks "Are you [parent name]?"
```

### D) Cancel
```
"Cancel my appointment" → "Are you sure?" → "Yes" → cancelled
✅ cc = true → graceful close
```

### E) Reschedule
```
"Reschedule my appointment" → "I see you have..." → new time → slot → confirmed
✅ rc = true → graceful close
✅ No dead air after "Let me find..."
```

### F) Noise Handling
```
Low confidence "Yep" → Process normally (whitelisted)
Low confidence gibberish → "Background noise" → Ask again
Two gibberish → SMS fallback
✅ Never resets intent or stage
```

---

## Changelog

- **v2.0** (Dec 2024): Complete rewrite based on actual codebase
  - Added BookingStage enum
  - Added intent locking
  - Added loop prevention (max 2 asks)
  - Added TwiML safety nets
  - Fixed reschedule/cancel dead-ends
  - Added noise detection whitelist
