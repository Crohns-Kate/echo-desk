# Fix Shared Phone Disambiguation and Hangup Detection Bugs

## Overview

This PR fixes two critical bugs that were breaking the call flow:
1. **Shared phone disambiguation bug**: `confirmedPatientId` was set but never used when creating appointments
2. **Hangup detection bug**: "No, first time" was treated as a goodbye, ending calls prematurely

## Bug Fixes

### 1. Fixed `confirmedPatientId` Not Being Used ✅

**Problem:**
- During shared phone disambiguation, `confirmedPatientId` was correctly set at line 752
- However, `createAppointmentForPatient` only accepted a phone number and internally called `getOrCreatePatient` which performed a new phone lookup
- When multiple patients share a phone number, this lookup could return a different patient than the one the user confirmed
- This defeated the purpose of the shared phone disambiguation feature

**Solution:**
- Added optional `patientId` parameter to `createAppointmentForPatient` function
- When `patientId` is provided, fetch patient directly by ID (bypassing phone lookup)
- Updated `openai-call-handler.ts` to pass `context.confirmedPatientId` when creating appointments
- Ensures the exact patient the user confirmed is used, even when multiple patients share the same phone

**Files Changed:**
- `server/services/cliniko.ts` - Added `patientId` parameter and direct patient lookup by ID
- `server/services/openai-call-handler.ts` - Pass `confirmedPatientId` to `createAppointmentForPatient`

### 2. Fixed Hangup Detection Treating "No" as Goodbye ✅

**Problem:**
- When user answered "No, first time" to "Have you been here before?", the system treated "no" as a goodbye phrase
- This caused the call to hang up immediately after asking for the name
- The hangup detection was not context-aware - it checked for "no" regardless of whether the AI was asking a question

**Solution:**
- Made hangup detection context-aware
- Split goodbye phrases into two categories:
  - **Always-goodbye phrases**: "that's all", "goodbye", "no thanks", etc. - always trigger hangup
  - **Conditional phrases**: "no", "nope", "nah" - only trigger hangup when AI is NOT expecting a reply
- When AI is asking a question (`expect_user_reply !== false`), "no" is treated as an answer, not a goodbye
- Prevents false positives like "No, first time" from ending calls

**Files Changed:**
- `server/services/openai-call-handler.ts` - Context-aware hangup detection logic

## Impact

### Before:
- ❌ Shared phone disambiguation didn't work - wrong patient could be used for appointments
- ❌ Calls ended prematurely when users answered "No, first time"
- ❌ Poor user experience and potential data corruption

### After:
- ✅ Shared phone disambiguation works correctly - confirmed patient ID is used for appointments
- ✅ Calls continue properly when users answer questions with "no"
- ✅ Better user experience and data integrity

## Testing

**Shared Phone Disambiguation:**
- User confirms identity during disambiguation → `confirmedPatientId` is set
- Appointment creation uses the confirmed patient ID directly
- Multiple patients with same phone → correct patient record used

**Hangup Detection:**
- "No, first time" when answering "Have you been here before?" → Call continues ✅
- "No" when AI says "Anything else?" → Call ends ✅
- "No thanks" → Always ends call ✅

## Related Issues

Fixes the bugs described in:
- Shared phone disambiguation not using confirmed patient ID
- Premature call termination when answering questions with "no"

