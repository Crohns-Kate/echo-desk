# Fix Disambiguation Noise and Intent Classification Issues

This PR fixes critical issues with speech recognition, intent classification, and name disambiguation that were causing failures in the voice call flow.

## Key Fixes

### 1. Contraction Normalization Bug (NEW - Just Fixed)
**Problem**: The `classifyYesNo` function was replacing apostrophes with spaces, converting "That's me" into "that s me". However, regex patterns like `/\bthat'?s\s+me\b/` expect "thats" or "that's" as a single word, not "that s" with a space. This caused contractions like "That's me", "It's me", and "I'm" to return `'unclear'` instead of `'yes'`, breaking name disambiguation.

**Solution**: 
- Updated normalization to remove apostrophes entirely instead of replacing with spaces
- Now "That's me" → "thats me" (matches the pattern correctly)
- All contraction-based affirmative responses now work properly

### 2. Intent Classification Improvements
**Problem**: LLM was sometimes hallucinating "shop appointment" intent when users clearly wanted to book medical appointments.

**Solution**:
- Added deterministic booking intent overrides BEFORE LLM classification
- Prevents "shop appointment" hallucinations when user clearly wants to book
- Better handling of booking keywords vs shop/store keywords
- Override logic also applied after LLM classification as a safety net

### 3. Name Disambiguation Enhancements
**Problem**: Multi-patient scenarios and name mismatches weren't handled well, leading to data corruption risks.

**Solution**:
- Improved name matching with similarity detection (`name-matcher.ts`)
- Better handling of multi-patient scenarios with disambiguation prompts
- Enhanced identity confirmation logic with NO-wins precedence
- Fixed false positives where confirmations with context were treated as rejections

### 4. Handoff Support
**Problem**: No proper tracking or routing for handoff scenarios.

**Solution**:
- Added handoff tracking fields to call logs
- Support for transfer, callback, and SMS-only modes
- Handoff detection and routing improvements
- Database migrations for handoff configuration

### 5. Time Formatting Improvements
**Problem**: Awkward times like "9:49" were spoken, making calls feel unnatural.

**Solution**:
- Added natural spoken time formatting with 5-minute rounding
- Better UX for appointment slot presentation
- `formatSpokenTime()` for natural speech ("nine forty-five p m")
- `formatSlotTime()` for rounded display ("9:45 AM")

### 6. SSML and TwiML Fixes
- Fixed SSML escaping issues in TwiML responses
- Added `getTwimlXml()` helper to properly unescape SSML for Polly voices
- Test endpoints for SSML verification

## Files Changed

- `server/utils/speech-helpers.ts` - **Contraction normalization fix** (NEW)
- `server/ai/intentRouter.ts` - Intent classification improvements
- `server/utils/name-matcher.ts` - Name matching utilities
- `server/utils/time-formatter.ts` - Time formatting utilities
- `server/services/handoff.ts` - Handoff service improvements
- `server/utils/twiml-helper.ts` - SSML/TwiML helper
- `server/routes/test-ssml.ts` - SSML test endpoints
- `migrations/004_add_handoff_support.sql` - Database schema updates
- Multiple test files updated

## Testing

- All existing tests pass
- New tests added for disambiguation scenarios
- SSML verification tests included
- Contraction normalization verified

## Impact

- ✅ Contractions like "That's me" now correctly return 'yes' instead of 'unclear'
- ✅ Intent classification more reliable with deterministic overrides
- ✅ Better name disambiguation prevents data corruption
- ✅ Handoff scenarios properly tracked and routed
- ✅ Natural time formatting improves call experience
- ✅ SSML properly rendered in TwiML responses

## Related Issues

Fixes issues with:
- Name disambiguation failures for common affirmative responses
- Intent misclassification (shop vs booking)
- Patient data corruption risks
- Unnatural time formatting in voice calls
- SSML escaping in TwiML responses
