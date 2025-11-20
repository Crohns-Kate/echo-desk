# Echo Desk Bug & QA Log

## Purpose

This document tracks known bugs, issues, and quality assurance findings for Echo Desk. Use this template for reporting and tracking bug resolutions.

---

## Recently Fixed

### [BUG-005] Name Overused in Conversation

**Severity**: Low
**Status**: Fixed
**Reported**: 2025-11-21
**Fixed**: 2025-11-21

**Description**:
Caller's name was repeated too frequently during the conversation, making it feel overwhelming and unnatural.

**Fix Applied**:
- Removed name from "Got it! Thanks {name}." → Now just "Got it! Thanks."
- Removed entire "Sorry to hear about your {complaint}" message
- Kept name usage only for:
  - Initial greeting: "Hi {name}! What brings you in?"
  - Final confirmation: "{name}, perfect! You're all set..."

**Related Files**:
- `server/services/callFlowHandler.ts:420` (handleFormReceived)
- `server/services/callFlowHandler.ts:453` (handleChiefComplaint)
- `server/services/callFlowHandler.ts:643` (handleConfirmBooking)

---

### [BUG-006] Appointment Date Logic Incorrect (Saturday/Today/Other Days)

**Severity**: High
**Status**: Fixed
**Reported**: 2025-11-21
**Fixed**: 2025-11-21

**Description**:
When caller said "I'd like an appointment for Saturday", the system:
- Booked it 8 days away instead of the upcoming Saturday
- Got confused when booking "today" and failed to find same-day appointments
- Didn't properly parse natural language dates

**Root Cause**:
- System collected chief complaint which included date preferences
- Intent classification extracted `day` field (e.g., "saturday", "today")
- But the appointment search ignored this and always searched next 14 days from now
- No date parsing logic to convert "saturday" → actual Saturday date

**Fix Applied**:
1. Created new `server/utils/date-parser.ts` module:
   - `parseNaturalDate()` - Converts "saturday", "today", "tomorrow" to date ranges
   - Handles "this saturday" vs "next saturday"
   - Finds next occurrence of weekday correctly
   - If it's Saturday morning, offers today; if afternoon, offers next week

2. Updated `server/services/callFlowHandler.ts`:
   - Added `preferredDay` field to CallContext
   - `handleChiefComplaint()` now extracts day using `classifyIntent()`
   - `handleAppointmentSearch()` uses `parseNaturalDate()` to get correct date range
   - Offers alternatives if requested day has no slots

3. Behavior Changes:
   - "Saturday" → Next upcoming Saturday (0-7 days away)
   - "Today" → Today's remaining hours (or error if no slots)
   - "Tomorrow" → Tomorrow all day
   - "This Saturday" → Upcoming Saturday
   - "Next Saturday" → Saturday after this one (8-14 days away)
   - If no day specified → Next 14 days (original behavior)

**Related Files**:
- `server/utils/date-parser.ts` (NEW)
- `server/services/callFlowHandler.ts:7-8` (imports)
- `server/services/callFlowHandler.ts:52` (preferredDay field)
- `server/services/callFlowHandler.ts:438-458` (handleChiefComplaint)
- `server/services/callFlowHandler.ts:463-534` (handleAppointmentSearch)

**Notes**:
- Date logic uses Australia/Brisbane timezone (AUST_TZ)
- Falls back gracefully if day can't be parsed
- Offers alternatives if preferred day has no availability

---

## Bug Template

```markdown
### [BUG-XXX] Title

**Severity**: Critical | High | Medium | Low
**Status**: Open | In Progress | Fixed | Won't Fix
**Reported**: YYYY-MM-DD
**Fixed**: YYYY-MM-DD (if applicable)

**Description**:
Clear description of the issue

**Steps to Reproduce**:
1. Step one
2. Step two
3. ...

**Expected Behavior**:
What should happen

**Actual Behavior**:
What actually happens

**Suspected Cause**:
Technical analysis of root cause

**Fix Applied** (if fixed):
Description of the fix

**Related Files**:
- `path/to/file.ts:123`
- `path/to/other-file.ts:456`

**Notes**:
Additional context or observations
```

---

## Critical Bugs (Historical)

### [BUG-001] New Patient Incorrectly Saved as Existing Patient (Michael Bishopp Issue)

**Severity**: Critical
**Status**: Fixed (Partially - monitoring required)
**Reported**: 2025-11-XX (inferred from code comments)
**Fixed**: 2025-11-XX (inferred from code comments)

**Description**:
When a new patient calls from the same phone number as an existing patient, the system was incorrectly creating an appointment for the existing patient (e.g., Michael Bishopp) instead of creating a new patient record for the actual caller.

**Steps to Reproduce**:
1. Existing patient "Michael Bishopp" has phone number +61412345678 in Cliniko
2. New patient "John Smith" calls from the same number +61412345678 (shared phone, family member, etc.)
3. Caller says "yes" to "Is this your first visit?"
4. Caller fills out new patient form with name "John Smith"
5. System books appointment
6. **Bug**: Appointment is created for "Michael Bishopp" instead of "John Smith"

**Expected Behavior**:
- System should create a new patient record in Cliniko for "John Smith"
- Appointment should be linked to "John Smith", not "Michael Bishopp"
- Phone number lookup should be a **hint**, not absolute truth
- Caller's stated identity (via form) should be **source of truth**

**Actual Behavior**:
- System found existing patient via `findPatientByPhoneRobust(phone)`
- System reused `existingPatientId` from phone lookup
- System ignored the new patient form data
- Appointment created for wrong patient

**Suspected Cause**:
1. Phone number lookup was performed and cached in session context
2. Session context persisted `patientId` from the lookup
3. Booking logic checked for `patientId` existence, not "is this a new patient flow?"
4. `createAppointmentForPatient()` used the cached `patientId` instead of creating new patient

**Root Cause Code** (server/routes/voice.ts):
```typescript
// Line ~3690
if (ctx.patientId && !ctx.formData) {
  // Returning patient - use existing ID
  // BUG: This condition is wrong! Should be:
  // if (returningPatientFlow) { ... }
}
```

**Fix Applied**:
1. Added explicit bug detection logging in `server/routes/voice.ts:3690`:
   ```typescript
   console.error("[BOOK-CHOOSE] ❌ BUG DETECTED: New patient flow is reusing existingPatientId!");
   ```
2. Added defensive reset: `ctx.patientId = null` in new patient flow
3. Changed appointment creation logic to:
   - New patient: Use `ctx.formData.phone` + create patient
   - Returning patient: Use `ctx.callerPhone` + lookup patient
4. Separated appointment type selection:
   - New patient: Use `CLINIKO_NEW_PATIENT_APPT_TYPE_ID`
   - Returning patient: Use `CLINIKO_APPT_TYPE_ID`

**Related Files**:
- `server/routes/voice.ts:3690` - Bug detection logging
- `server/routes/voice.ts:3853` - Appointment type bug detection
- `server/services/callFlowHandler.ts:581-676` - Booking confirmation handler
- `server/services/cliniko.ts:297-346` - `createAppointmentForPatient()`

**Testing Required**:
- [ ] Manual test: Call from existing patient's phone, say "new patient"
- [ ] Verify new patient record is created in Cliniko
- [ ] Verify appointment is linked to new patient, not existing
- [ ] Add automated test for this scenario

**Notes**:
- This is a **data integrity** issue with potential legal/HIPAA implications
- Phone number should be treated as a **convenience hint**, not identity proof
- Consider adding voice confirmation: "Before I book, you said your name is {name}, is that correct?"
- Consider adding DOB verification for returning patients: "Can you confirm your date of birth?"

---

## Open Bugs

### [BUG-002] Recording Start Race Condition

**Severity**: Medium
**Status**: Open
**Reported**: 2025-11-20 (inferred from recent fix attempt)

**Description**:
Call recordings sometimes fail to start because the recording API is called before the call reaches "in-progress" state, resulting in "not eligible for recording" errors.

**Steps to Reproduce**:
1. Inbound call arrives at `/api/voice/incoming`
2. TwiML response includes recording instruction
3. Twilio attempts to start recording immediately
4. Call state is still "ringing" or "connecting"
5. Recording fails with "Call is not eligible for recording"

**Expected Behavior**:
- Recording should start only when call is in "in-progress" state
- Recording should retry if first attempt fails
- Recording URL should be saved to database when available

**Actual Behavior**:
- Recording attempt fails intermittently (race condition)
- No retry logic
- Some calls have no recording even though `CALL_RECORDING_ENABLED=true`

**Suspected Cause**:
- Timing issue: TwiML `<Start><Stream>` or recording instruction sent too early
- Need to delay recording start by 2-3 seconds
- OR need to use recording status callback to detect failure and retry

**Fix Applied**:
- Recent attempt added 2-second `setTimeout` delay before starting recording (see git history)
- Status: Monitoring to see if this resolves the issue

**Related Files**:
- `server/routes/voice.ts` - Recording start logic
- `/api/voice/recording-status` - Recording status callback

**Testing Required**:
- [ ] Monitor next 100 calls for recording success rate
- [ ] Add alert if recording fails
- [ ] Add recording retry logic (attempt up to 3 times)

**Notes**:
- Twilio docs recommend using `<Record>` verb instead of Recordings API for better reliability
- Consider switching to `<Record>` + recording status webhooks

---

### [BUG-003] Form Submission Timeout Edge Case

**Severity**: Low
**Status**: Open
**Reported**: 2025-11-20

**Description**:
If a caller submits the new patient form exactly at the 2-minute timeout boundary, they may experience a race condition where:
- Form is submitted successfully (200 OK)
- But call has already ended with timeout message
- Caller receives confirmation SMS but doesn't get appointment

**Steps to Reproduce**:
1. New patient receives form link
2. Wait 119 seconds
3. Submit form at exactly 120 seconds
4. Race condition between form submission and timeout redirect

**Expected Behavior**:
- Form submission should extend the timeout
- If form received, cancel timeout redirect
- Continue with appointment booking

**Actual Behavior**:
- Call may end with "I haven't received the form yet"
- Form data is saved to database
- But call has already hung up

**Suspected Cause**:
- `WAITING_FOR_FORM` state polls every 3 seconds
- Timeout is checked at each poll
- No cancellation token when form is submitted
- Race condition if submission happens between polls

**Fix Needed**:
1. Add "form received" flag that cancels timeout
2. Extend timeout to 3 minutes (more generous)
3. Add "Still working on the form? I can wait" message at 90 seconds
4. Add callback mechanism: "Take your time, I'll call you back when you're done"

**Related Files**:
- `server/services/callFlowHandler.ts:363-406` - `handleCheckFormStatus()`
- `server/routes/forms.ts` - Form submission endpoint

**Testing Required**:
- [ ] Test with exact 2-minute boundary
- [ ] Test with form submitted during call
- [ ] Test callback mechanism

**Notes**:
- Low priority since most users complete form in <60 seconds
- But poor UX when it happens

---

### [BUG-004] Multiple Patient Disambiguation Not Fully Implemented

**Severity**: Medium
**Status**: Open
**Reported**: 2025-11-20

**Description**:
When multiple patients share the same phone number, the system prompts to disambiguate ("Are you John or Jane?") but the handler for parsing the response is not fully implemented.

**Steps to Reproduce**:
1. Have 2+ patients with same phone in Cliniko (e.g., family members)
2. Call from that phone number
3. Say "returning patient"
4. System finds multiple patients
5. System asks: "I see a few accounts with this number. Are you {name1} or {name2}? Or press 3 if neither."
6. Caller responds with name or presses 3
7. **Bug**: Handler does not properly route to next state

**Expected Behavior**:
- Parse caller's response
- Match to one of the patients by name
- Set `ctx.patientId` to the selected patient
- Continue to `CHIEF_COMPLAINT`
- If "neither" or press 3 → treat as new patient

**Actual Behavior**:
- Disambiguation prompt is shown
- Response handler is missing or incomplete
- Call flow may error or hang

**Suspected Cause**:
- `handleReturningPatientLookup()` creates Gather for disambiguation
- But there's no `step=disambiguate_patient` handler in `/api/voice/handle-flow`
- Need to add dedicated handler

**Fix Needed**:
1. Add `handleDisambiguatePatient(speechRaw, digits)` method
2. Parse response:
   - Match speech to patient first name (fuzzy match or exact)
   - DTMF 1 = first patient, 2 = second patient, 3 = neither
3. Update `ctx.patientId` and transition to `CHIEF_COMPLAINT`
4. If no match or "3", transition to `NEW_PATIENT_PHONE_CONFIRM`

**Related Files**:
- `server/services/callFlowHandler.ts:219-271` - `handleReturningPatientLookup()`
- `server/routes/voice.ts` - Missing handler for `step=disambiguate_patient`

**Testing Required**:
- [ ] Create test scenario with 2 patients sharing phone
- [ ] Test name selection (speech)
- [ ] Test DTMF selection (1, 2, 3)
- [ ] Test edge case: 3+ patients (currently only shows first 2)

**Notes**:
- Medium priority - affects families sharing phones
- Important for data integrity (same as BUG-001)

---

## Fixed Bugs (Archive)

### [BUG-FIXED-001] Appointment Type Not Found Error

**Severity**: High
**Status**: Fixed
**Reported**: 2025-11-XX
**Fixed**: 2025-11-XX

**Description**:
If the configured `CLINIKO_APPT_TYPE_ID` or `CLINIKO_NEW_PATIENT_APPT_TYPE_ID` did not exist in Cliniko or was not visible for online booking, the system would crash with "Appointment type not found" error.

**Fix Applied**:
- Added fallback logic in `getAvailability()` (server/services/cliniko.ts:192-246)
- If specified appointment type not found, use first available type
- Log warning to alert admin
- Prevents total failure, allows booking to continue

**Related Files**:
- `server/services/cliniko.ts:118-295` - `getAvailability()` with fallback

**Notes**:
- Still need admin UI to validate appointment type IDs on startup
- Add health check endpoint to verify Cliniko configuration

---

## Known Issues (Not Bugs)

### [ISSUE-001] Voice Quality Varies by Caller's Phone

**Severity**: Low
**Status**: Won't Fix (external limitation)

**Description**:
Speech recognition accuracy varies significantly based on:
- Caller's phone quality (landline vs mobile vs VoIP)
- Background noise
- Caller's accent
- Connection quality

**Mitigation**:
- Use speech hints to improve recognition
- Add retry logic with rephrased prompts
- Offer DTMF fallback for critical inputs
- Use LLM to interpret ambiguous responses

---

### [ISSUE-002] SMS Delivery Delays

**Severity**: Low
**Status**: Won't Fix (external limitation)

**Description**:
SMS delivery is not instant. Some carriers have delays of 5-30 seconds.
This affects the "I've sent you a text" experience - caller may not receive it immediately.

**Mitigation**:
- Set expectation: "Check your phone in a few seconds"
- Extend form waiting timeout to 3 minutes
- Add retry logic for SMS (if first fails, try again)

---

## Quality Assurance Checklist

### Pre-Deployment Testing

Before deploying any changes to production, test:

- [ ] **Happy Path - New Patient**
  1. Call from new number
  2. Say "new patient" or "yes"
  3. Confirm phone number
  4. Fill out form within 2 minutes
  5. State chief complaint
  6. Select appointment slot
  7. Verify booking created in Cliniko with correct name
  8. Verify SMS confirmation received

- [ ] **Happy Path - Returning Patient**
  1. Call from existing patient's number
  2. Say "returning" or "no"
  3. Verify patient recognized by name
  4. State chief complaint
  5. Select appointment slot
  6. Verify booking created in Cliniko for correct patient
  7. Verify SMS confirmation received

- [ ] **Error Handling - No Availability**
  1. Call during test period with no slots
  2. Verify graceful error message
  3. Verify alert created
  4. Verify call ends gracefully

- [ ] **Error Handling - Cliniko Down**
  1. Temporarily disable Cliniko API key
  2. Call and attempt to book
  3. Verify error message
  4. Verify alert created
  5. Verify call ends gracefully

- [ ] **Edge Case - Form Timeout**
  1. Call as new patient
  2. Receive form link
  3. Wait 2+ minutes without submitting
  4. Verify timeout message
  5. Verify call ends gracefully

- [ ] **Edge Case - Unclear Responses**
  1. Call and give ambiguous responses
  2. Verify retry prompts
  3. Verify defaults applied after 2 retries

- [ ] **Edge Case - Multiple Patients**
  1. Call from number with 2+ patients in Cliniko
  2. Say "returning"
  3. Verify disambiguation prompt
  4. Test name selection
  5. Verify correct patient selected

- [ ] **Security - Recording Access**
  1. Attempt to access `/api/recordings/:sid/stream` without token
  2. Verify 403 Forbidden
  3. Access with valid `RECORDING_TOKEN`
  4. Verify 200 OK with audio

- [ ] **Security - Twilio Signature**
  1. Attempt to POST to `/api/voice/incoming` without valid Twilio signature
  2. Verify 403 Forbidden (if not APP_MODE=TEST)

---

## Reporting New Bugs

**Where to Report**:
- GitHub Issues: https://github.com/anthropics/claude-code/issues (placeholder)
- Internal Slack: #echo-desk-bugs (if applicable)
- Email: bugs@echo-desk.com (if applicable)

**What to Include**:
1. Call SID (if applicable)
2. Phone number (if not PII concern)
3. Timestamp
4. Steps to reproduce
5. Expected vs actual behavior
6. Screenshots or recordings (if applicable)
7. Error messages from logs
8. Browser/environment info (for dashboard bugs)

**Priority Definitions**:
- **Critical**: Data corruption, security vulnerability, complete system failure
- **High**: Major feature broken, affects many users, no workaround
- **Medium**: Feature partially broken, affects some users, workaround available
- **Low**: Minor issue, cosmetic, edge case, or has easy workaround

---

## Monitoring & Alerts

### Automated Alerts
- Cliniko API failures
- Recording failures
- SMS send failures
- Database errors
- Webhook signature validation failures

### Manual Monitoring
- Weekly review of call logs for errors
- Weekly review of quality scores
- Weekly review of alerts dashboard
- Monthly review of this bug log

### Metrics to Watch
- Booking success rate (target: >95%)
- Error rate (target: <5%)
- Recording capture rate (target: >95%)
- SMS delivery rate (target: >98%)
- Average call duration (baseline: 2-3 minutes)

---

## Notes

- This document should be updated after every bug fix or discovery
- Archive fixed bugs to "Fixed Bugs" section (don't delete - useful for regression testing)
- Review open bugs monthly - prioritize or close stale issues
- Use this log to identify patterns and systemic issues
