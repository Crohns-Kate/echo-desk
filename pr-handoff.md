# Implement Human Handoff Feature

This PR implements a comprehensive Human Handoff system for Echo Desk, allowing the AI to seamlessly transfer calls to human receptionists when needed.

## Features

### Handoff Triggers
- **Explicit Request**: Detects phrases like "I want to speak to a human", "transfer me", etc.
- **Profanity**: Detects frustration through profanity
- **Frustration Loop**: Triggers after 2+ consecutive no-match responses
- **Repeated "Hello"**: Detects confusion when caller says "hello" multiple times
- **Low Confidence**: Triggers when AI confidence < 0.5
- **Out of Scope**: When AI flags request as out-of-scope
- **Cliniko Error**: When Cliniko API errors occur during booking

### Handoff Modes

1. **Transfer Mode** (`transfer`)
   - Uses Twilio `<Dial>` to transfer to `handoffPhone`
   - 20-second timeout
   - Automatic fallback to callback if transfer fails/no answer

2. **Callback Mode** (`callback`) - **Default**
   - Captures callback preference from caller
   - Sends SMS confirmation
   - Creates alert for callback queue

3. **SMS-Only Mode** (`sms_only`)
   - Sends SMS notification immediately
   - Hangs up after message

### After-Hours Support
- Separate `afterHoursMode` configuration
- Automatically detects after-hours based on business hours
- Uses after-hours mode when outside business hours

## Database Changes

### Migration: `004_add_handoff_support.sql`
- Adds handoff fields to `call_logs` table:
  - `handoff_triggered` (boolean)
  - `handoff_reason` (text)
  - `handoff_mode` (text)
  - `handoff_status` (text)
  - `handoff_target` (text)
  - `handoff_notes` (text)
- Adds handoff configuration to `tenants` table:
  - `handoff_mode` (default: 'callback')
  - `handoff_phone` (E.164 format)
  - `after_hours_mode` (default: 'callback')
  - `handoff_sms_template` (with `{{clinic_name}}` placeholder)

## Implementation Details

### New Files
- `server/utils/handoff-detector.ts` - Handoff trigger detection logic
- `server/services/handoff.ts` - Handoff service (transfer, callback, SMS)
- `server/tests/handoff-detection.test.ts` - Comprehensive test suite
- `migrations/004_add_handoff_support.sql` - Database migration

### Updated Files
- `server/services/openai-call-handler.ts` - Integrated handoff detection (pre-AI and post-AI)
- `server/routes/voice.ts` - Added handoff callback routes:
  - `/api/voice/handoff-status` - Transfer status callback
  - `/api/voice/handoff-callback` - Fallback callback capture
  - `/api/voice/handoff-callback-capture` - Callback preference capture
- `client/src/pages/dashboard.tsx` - Added HANDOFF badge and callback queue
- `server/routes/app.ts` - Updated alerts API to support `reason` filter
- `server/storage.ts` - Updated `listAlerts()` to support reason filtering
- `shared/schema.ts` - Added handoff fields to schema

## Testing

### Automated Tests
```bash
node --import tsx server/tests/handoff-detection.test.ts
```

### Manual Test Steps

1. **Test Explicit Request:**
   - Call the system
   - Say "I want to speak to a human"
   - Should trigger handoff immediately

2. **Test Transfer Mode:**
   - Set tenant `handoffMode` to 'transfer'
   - Set `handoffPhone` to a test number
   - Trigger handoff
   - Should dial the handoff phone
   - If no answer, should fall back to callback

3. **Test Callback Mode:**
   - Set tenant `handoffMode` to 'callback' (default)
   - Trigger handoff
   - Should ask for callback preference
   - Should send SMS confirmation
   - Should appear in callback queue on dashboard

4. **Test Frustration Detection:**
   - Call the system
   - Give 2+ unclear responses
   - Should trigger handoff after 2nd no-match

5. **Test Dashboard:**
   - View dashboard after handoff
   - Should see HANDOFF badge on call
   - Should see callback requests in queue

## Configuration

### Tenant Settings (Optional - defaults provided)
- `handoffMode`: 'transfer' | 'callback' | 'sms_only' (default: 'callback')
- `handoffPhone`: Phone number for transfers (E.164 format)
- `afterHoursMode`: 'transfer' | 'callback' | 'sms_only' (default: 'callback')
- `handoffSmsTemplate`: SMS template with `{{clinic_name}}` placeholder

## Migration Required

**⚠️ IMPORTANT:** Run the database migration before deploying:
```bash
psql $DATABASE_URL -f migrations/004_add_handoff_support.sql
```

## Impact

- ✅ Seamless handoff when caller needs human assistance
- ✅ Automatic fallback if transfer fails
- ✅ Callback queue for tracking requests
- ✅ Dashboard visibility with HANDOFF badges
- ✅ Does NOT break existing booking flow
- ✅ Minimal changes to existing code paths

## Next Steps

1. Run database migration
2. Configure tenant settings (optional - defaults work)
3. Test with real calls
4. Monitor dashboard for handoff events
