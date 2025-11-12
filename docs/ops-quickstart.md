# Operations Quick Start

## Environment Variables

### Required
```bash
# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+61xxxxxxxxx

# Database
DATABASE_URL=postgres://user:pass@host/db

# Cliniko
CLINIKO_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
CLINIKO_BASE_URL=https://api.au4.cliniko.com/v1
CLINIKO_BUSINESS_ID=your-business-id
CLINIKO_PRACTITIONER_ID=your-practitioner-id
CLINIKO_APPT_TYPE_ID=your-appointment-type-id
```

### Optional
```bash
# Timezone (default: Australia/Brisbane)
TZ=Australia/Brisbane

# TTS Voice (default: Polly.Matthew)
TTS_VOICE=Polly.Matthew
# Options: Polly.Nicole-Neural, Polly.Olivia-Neural

# WebSocket Token (required for /ws)
WS_TOKEN=your-secure-ws-token-here

# Recording Token (required for /api/recordings/*)
RECORDING_TOKEN=your-secure-random-token-here

# Base URL for webhooks
PUBLIC_BASE_URL=https://your-app.replit.app
```

## Webhook Setup

### Twilio Voice Webhook
Configure in Twilio Console → Phone Numbers → Your Number:

**Voice Configuration:**
- **A CALL COMES IN:** `https://your-app.replit.app/api/voice/incoming`
- **METHOD:** POST
- **FALLBACK:** `https://your-app.replit.app/api/voice/incoming`

## Diagnostic Endpoints

### Health Checks
```bash
# Basic health
curl http://localhost:5000/health

# Cliniko API health
curl http://localhost:5000/__cliniko/health

# Timezone verification
curl http://localhost:5000/__tz/now
```

### Dashboard
```bash
# View all calls
open http://localhost:5000/__cliniko/dashboard

# Filter by intent
open "http://localhost:5000/__cliniko/dashboard?intent=booking"
```

### Availability
```bash
# Check tomorrow morning slots
curl "http://localhost:5000/__cliniko/avail?day=tomorrow&part=morning"

# Check Monday afternoon slots
curl "http://localhost:5000/__cliniko/avail?day=monday&part=afternoon"
```

### Stats
```bash
# Get aggregated stats
curl http://localhost:5000/api/stats
# Returns: { callsToday, calls7d, bookings, cancels, errors, pendingAlerts }
```

### Alerts
```bash
# List all alerts
curl http://localhost:5000/api/alerts

# Dismiss an alert
curl -X PATCH http://localhost:5000/api/alerts/1/dismiss
```

## Testing Voice Flow

### Simulate Call Steps
```bash
BASE="http://localhost:5000"

# Step 1: Incoming call (creates log)
curl -X POST "$BASE/api/voice/incoming" \
  -d "CallSid=CAtest123" \
  -d "From=%2B61412345678" \
  -d "To=%2B61400000000"

# Step 2: Confirm booking intent
curl -X POST "$BASE/api/voice/handle?route=book-day&callSid=CAtest123" \
  -d "SpeechResult=yes book appointment" \
  -d "From=%2B61412345678"

# Step 3: Request availability (may create alert on error)
curl -X POST "$BASE/api/voice/handle?route=book-part&callSid=CAtest123" \
  -d "SpeechResult=tomorrow" \
  -d "From=%2B61412345678"

# Check logs
curl http://localhost:5000/api/calls

# Check alerts
curl http://localhost:5000/api/alerts
```

## Common Gotchas

### 1. Cliniko Date Range Errors
**Symptom:** `Invalid time frame definition. Please check from/to param limitations.`

**Cause:** Date calculations in different timezones can produce dates in the past.

**Fix:** Ensure `TZ=Australia/Brisbane` is set and dates are >= today in local timezone.

### 2. No Availability Returned
**Symptom:** API returns 0 slots but Cliniko shows availability.

**Causes:**
- Practitioner not set to `show_in_online_bookings: true`
- Appointment type not set to `show_in_online_bookings: true`
- Business hours don't match requested time window

**Fix:**
```bash
# Check practitioner settings
curl -H "Authorization: Basic $(echo -n 'YOUR_API_KEY:' | base64)" \
  https://api.au4.cliniko.com/v1/practitioners/YOUR_PRACTITIONER_ID

# Verify appointment type
curl -H "Authorization: Basic $(echo -n 'YOUR_API_KEY:' | base64)" \
  https://api.au4.cliniko.com/v1/appointment_types/YOUR_APPT_TYPE_ID
```

### 3. SMS Not Sending
**Symptom:** Calls succeed but no SMS received.

**Cause:** Missing or invalid Twilio credentials.

**Behavior:** Non-blocking - call continues even if SMS fails (logs warning).

**Fix:** Verify `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER`.

### 4. WebSocket Connection Rejected
**Symptom:** WS connection immediately closes with 401.

**Cause:** `WS_TOKEN` mismatch or missing from connection URL.

**Fix:**
```bash
# Connect with token
wscat -c "ws://localhost:5000/ws?ws_token=YOUR_WS_TOKEN"
```

### 5. Voice Sounds Wrong
**Symptom:** TTS uses wrong voice or accent.

**Cause:** `TTS_VOICE` env var not set or invalid.

**Fix:**
```bash
# Use Australian Neural voices
TTS_VOICE=Polly.Nicole-Neural  # Female
TTS_VOICE=Polly.Olivia-Neural  # Female
TTS_VOICE=Polly.Matthew         # Male (default)
```

### 6. Phantom Appointment Success
**Symptom:** Call says "booked" but no appointment in Cliniko.

**Status:** FIXED in Sprint 1 - phantom mocks removed.

**Verification:** Errors now create alerts and fail gracefully.

## Monitoring

### Real-time Logs
```bash
# Follow server logs
npm run dev

# Filter for errors
npm run dev 2>&1 | grep -i error

# Filter for booking events
npm run dev 2>&1 | grep -i booking
```

### Database Queries
```bash
# Recent calls with errors
psql $DATABASE_URL -c "SELECT created_at, call_sid, intent, summary
  FROM call_logs
  WHERE summary LIKE '%error%' OR summary LIKE '%failed%'
  ORDER BY created_at DESC LIMIT 10;"

# Open alerts
psql $DATABASE_URL -c "SELECT * FROM alerts WHERE status = 'open' ORDER BY created_at DESC;"

# Booking success rate
psql $DATABASE_URL -c "SELECT
  COUNT(*) FILTER (WHERE intent LIKE '%book%') as bookings,
  COUNT(*) FILTER (WHERE reason = 'booking_failed') as failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE intent LIKE '%book%') /
    NULLIF(COUNT(*) FILTER (WHERE intent LIKE '%book%') +
    COUNT(*) FILTER (WHERE reason = 'booking_failed'), 0), 2) as success_rate
FROM call_logs LEFT JOIN alerts ON call_logs.call_sid = alerts.payload->>'callSid';"
```

## Performance Tips

1. **Use Stats Endpoint:** `/api/stats` uses SQL aggregates (fast)
2. **Filter Dashboard:** Use `?intent=booking` instead of loading all calls
3. **Limit Alert Queries:** Open alerts only: `WHERE status = 'open'`
4. **Index Columns:** Ensure `created_at`, `intent`, `status` are indexed

## Security Checklist

- [ ] `WS_TOKEN` set to strong random value
- [ ] `RECORDING_TOKEN` set to strong random value
- [ ] Twilio webhook signature validation enabled (auto)
- [ ] Database URL uses SSL/TLS
- [ ] No secrets in git history (use `.env`, not `.env.example`)
