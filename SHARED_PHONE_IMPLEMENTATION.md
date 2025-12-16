# Shared Phone Number Handling Implementation

## Overview

This implementation handles the common scenario where multiple people share the same phone number (e.g., a mother booking appointments for her child). Previously, the system assumed phone number = identity, which could cause data corruption or incorrect patient records.

## Key Changes

### 1. Identity Separation: Phone ≠ Identity

**Before:** When a caller ID matched an existing patient, the system automatically assumed the caller was that patient.

**After:** The system now distinguishes between:
- `possiblePatientId`: A patient found by phone lookup (not confirmed)
- `confirmedPatientId`: A patient whose identity has been verified by the caller

### 2. Shared Phone Disambiguation Flow

When a possible patient is found by phone:

1. **Ask for clarification:**
   - "I see this number in our system — are you booking for yourself, or for someone else, like a child or family member?"

2. **Branch based on answer:**

   **If "myself":**
   - Ask for full name
   - Compare provided name with possible patient name
   - If match (similarity ≥ 0.7): Set `confirmedPatientId` and proceed as existing patient
   - If no match: Clear `possiblePatientId` and treat as new patient

   **If "someone else":**
   - Clear `possiblePatientId` (it's not the caller)
   - Ask for the patient's full name
   - Treat as new patient unless a clear match is found in the system

### 3. Handoff Prevention

**Critical:** Shared phone disambiguation scenarios **NEVER** trigger human handoff, even if the user shows confusion or frustration. This ensures the flow completes naturally without unnecessary escalation.

### 4. Booking Logic Updates

- Only uses `confirmedPatientId` when creating appointments
- Skips name mismatch checks if identity is already confirmed
- Prevents data corruption by ensuring correct patient record is used

## Files Changed

1. **server/ai/receptionistBrain.ts**
   - Added `possiblePatientId`, `possiblePatientName`, `confirmedPatientId` to `ConversationContext`
   - Added `sharedPhoneDisambiguation` state tracking

2. **server/services/openai-call-handler.ts**
   - Updated `getOrCreateContext` to store `possiblePatientId` instead of assuming identity
   - Added shared phone disambiguation logic (section 3a-0)
   - Updated handoff detection to skip during shared phone disambiguation
   - Updated booking logic to use `confirmedPatientId` when available

3. **server/tests/shared-phone-handling.test.ts**
   - Comprehensive test suite covering all scenarios

## Test Scenarios

### Scenario 1: Mother books for child
- Same number → "booking for my child" → new patient created
- ✅ Child gets their own patient record
- ✅ No data corruption to mother's record

### Scenario 2: Existing patient confirms identity
- Same number → "for myself" + name match → existing patient
- ✅ Uses existing patient record
- ✅ No duplicate patient creation

### Scenario 3: Name mismatch
- Same number → name mismatch → new patient
- ✅ Different person gets new record
- ✅ Prevents overwriting existing patient data

## Why This Matters Commercially

### 1. **Data Integrity**
- **Problem:** Without this, a mother booking for her child could overwrite her own patient record with the child's information
- **Solution:** Each person gets their own patient record, maintaining accurate medical history

### 2. **Customer Experience**
- **Problem:** Users were confused when the system assumed their identity incorrectly
- **Solution:** Natural, non-accusatory language ("are you booking for yourself, or for someone else?") makes the flow clear

### 3. **Compliance & Medical Records**
- **Problem:** Incorrect patient records violate medical record keeping standards
- **Solution:** Ensures each appointment is linked to the correct patient record

### 4. **Reduced Support Burden**
- **Problem:** Data corruption required manual cleanup and customer service intervention
- **Solution:** Prevents issues at the source, reducing support tickets

### 5. **Scalability**
- **Problem:** Shared phone numbers are common (families, caregivers, etc.)
- **Solution:** System now handles this automatically without human intervention

## Language & Tone

The implementation uses natural, non-accusatory language:
- ✅ "I see this number in our system — are you booking for yourself, or for someone else, like a child or family member?"
- ✅ "Thanks for confirming. What's your full name?"
- ✅ "No worries. What's the full name of the person you're booking for?"

This approach:
- Doesn't assume guilt or wrongdoing
- Makes the question feel helpful, not suspicious
- Handles the scenario gracefully

## Technical Notes

- Uses name similarity matching (Jaccard similarity) to compare names
- Similarity threshold: 0.7 (70% match) to confirm identity
- Handoff detection is explicitly disabled during shared phone disambiguation
- `confirmedPatientId` is only set after explicit user confirmation
- Backward compatible with existing `knownPatient` field

## Future Enhancements

Potential improvements:
- Age/DOB collection for "someone else" bookings to improve matching
- Relationship tracking (e.g., "parent", "guardian")
- Multi-patient phone number management in UI

