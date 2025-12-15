# Fix Production Call Flow Issues

This PR addresses critical production issues found in recent calls to improve call flow correctness, patient data protection, and user experience.

## A) TwiML / Conversation Flow Correctness (Critical)

**Problem**: Agent says something (confirmation/info) but TwiML still returns a `<Gather>`, causing silence → "I didn't catch that".

**Solution**:
- Added `expect_user_reply` field to `ReceptionistResponse` interface and OpenAI schema
- TwiML builder only includes `<Gather>` when `expect_user_reply=true` (asking a question)
- Informational messages (booking confirmed, address provided) return `<Say>` only (no Gather)
- Post-booking: Always asks "Before you go do you need the price, directions, or our website?" with `expect_user_reply=true`
- **Critical rule**: Never include both `<Gather>` and `<Hangup/>` in the same response

## B) Cliniko Patient Identity Protection (Critical)

**Problem**: When an incoming call uses a phone number that already exists, the system overwrites the existing patient's name (which updates all past/future appointments).

**Solution**:
- Added `nameDisambiguation` to `ConversationContext` to track name mismatches
- Created `name-matcher.ts` with `shouldDisambiguateName()` and `calculateNameSimilarity()` functions
- Before booking: Checks for existing patient by phone
- If name mismatch detected: Asks "This number is already on file — are you [existing name]?"
- If yes: Uses existing patient without updating name (preserves `bc` and `si` booking state)
- If no: Triggers handoff (doesn't overwrite)
- Improved "no" detection to catch phrases like "No, I'm doing it for somebody else"
- **Fixed yes/no detection asymmetry**: Normalized utterances and split detection logic to prevent false positives where confirmations with extra context (e.g., "Yes, I'm calling for an appointment") were incorrectly treated as rejections
- Handoff properly ends call after message (no booking attempted)
- `checkAndUpdatePatient()` already prevents name updates (existing protection)

## C) Time Formatting / Rounding (UX)

**Problem**: Awkward times like "9:49" are spoken, making the call feel unnatural.

**Solution**:
- Created `time-formatter.ts` with:
  - `roundToNearest5Minutes()` - rounds times to nearest 5 minutes
  - `formatSpokenTime()` - natural speech format ("nine forty-five a m")
  - `formatSlotTime()` - rounded display format ("9:45 AM")
- Updated slot creation to use rounded times
- Added `spokenTime` to `EnrichedSlot` interface for natural speech
- Slot offering now uses natural spoken times when available

## D) Language Improvements (UX + Safety)

**Problem**: Robotic fillers, awkward pricing responses, and definitive medical claims.

**Solution**:
- **Removed fillers**: "Just a moment", "Bear with me", "One second" only for actual API calls
- **Pricing response**: Changed from "Does that sound okay?" to "The team can confirm the exact amount when you arrive."
- **Clinical FAQ**: "we often see" instead of "we definitely treat"
- **Post-booking UX**: Always asks "Before you go — do you need the price, directions, or our website?"

## E) Tests

Created comprehensive test suite (`callflow-production-fixes.test.ts`) covering:
- `expect_user_reply` logic
- TwiML Gather rules
- Patient name disambiguation
- Time rounding and formatting
- Language improvements
- Post-booking UX

## Files Changed

- `server/ai/receptionistBrain.ts` - Added `expect_user_reply`, `postBookingPrompted`, `preservedBc/Si` fields
- `server/services/openai-call-handler.ts` - TwiML builder logic, name disambiguation, post-booking UX, improved "no" detection, handoff flow
- `server/services/cliniko.ts` - Time formatting in slot creation
- `server/utils/time-formatter.ts` - New utility for time rounding and natural formatting
- `server/utils/name-matcher.ts` - New utility for name similarity checking
- `server/tests/callflow-production-fixes.test.ts` - Comprehensive test suite
- `ECHO_DESK_FIXES_VERIFICATION.md` - Verification document confirming all requirements met

## Testing

Run the test suite:
```bash
node --import tsx server/tests/callflow-production-fixes.test.ts
```

## Impact

- ✅ No more "I didn't catch that" after informational messages
- ✅ Patient data corruption prevented via name disambiguation
- ✅ Natural, rounded times improve call experience
- ✅ Reduced robotic fillers and improved language
- ✅ Better post-booking experience with helpful offers
- ✅ Improved handling of third-party bookings ("booking for someone else")
- ✅ Booking state preserved during name disambiguation flow
