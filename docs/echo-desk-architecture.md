# Echo Desk Architecture

## Overview

Echo Desk is an AI-powered voice receptionist system built for chiropractic clinics and service businesses. It handles inbound phone calls, identifies patients, collects information, and books appointments via Cliniko integration.

## Technology Stack

### Backend
- **Runtime**: Node.js with TypeScript
- **Web Framework**: Express
- **Database**: PostgreSQL (Drizzle ORM)
  - Schema: `shared/schema.ts`
  - Storage layer: `server/storage.ts`
- **Real-time**: WebSockets (ws library)
- **Voice**: Twilio Voice API
- **SMS**: Twilio Messaging API
- **Practice Management**: Cliniko API
- **Transcription**: AssemblyAI (optional)
- **Date/Time**: dayjs with timezone support
- **Timezone**: Australia/Brisbane (AUST_TZ)

### Frontend
- **Framework**: React with TypeScript
- **Routing**: Wouter
- **UI Components**: Radix UI + Tailwind CSS
- **State**: TanStack React Query
- **Build**: Vite

## Core Architecture

### Routes & Endpoints

#### Voice Routes (server/routes/voice.ts)
- `POST /api/voice/incoming` - Handles initial inbound call
- `POST /api/voice/handle-flow` - Processes call flow steps (FSM handler)
- `POST /api/voice/recording-status` - Recording status callback from Twilio

#### Dashboard Routes (server/routes/app.ts)
- `GET /api/calls` - List recent calls with pagination
- `GET /api/stats` - Dashboard statistics (active calls, alerts, bookings)
- `GET /api/alerts` - List active alerts
- `PATCH /api/alerts/:id/dismiss` - Dismiss an alert
- `GET /api/recordings/:sid/stream` - Stream call recording (requires RECORDING_TOKEN)

#### Form Routes (server/routes/forms.ts)
- `GET /api/form/:token` - New patient intake form
- `POST /api/form/:token` - Submit new patient form

#### Diagnostic Routes (server/routes/app.ts)
- `GET /__cliniko/health` - Cliniko API health check
- `GET /__cliniko/avail` - Test Cliniko availability query
- `GET /__tz/now` - Current time in configured timezone

#### WebSocket
- `WS /ws` - Real-time dashboard updates (requires WS_TOKEN)
  - Events: `call:started`, `call:updated`, `alert:created`

### Call Flow State Machine

The voice flow is managed by `CallFlowHandler` class in `server/services/callFlowHandler.ts`.

**States** (see CallState enum):
```typescript
GREETING                     // Initial greeting
PATIENT_TYPE_DETECT          // New vs returning patient
RETURNING_PATIENT_LOOKUP     // Lookup in Cliniko by phone
NEW_PATIENT_PHONE_CONFIRM    // Confirm phone number for SMS
SEND_FORM_LINK              // Send intake form via SMS
WAITING_FOR_FORM            // Poll for form completion
FORM_RECEIVED               // Form completed, continue
CHIEF_COMPLAINT             // Ask what they need
APPOINTMENT_SEARCH          // Query Cliniko availability
PRESENT_OPTIONS             // Offer 3 appointment slots
CONFIRM_BOOKING             // Book selected slot
CLOSING                     // Goodbye message
ERROR_RECOVERY              // Handle errors gracefully
```

See `docs/echo-desk-fsm.md` for detailed state transitions.

### Cliniko Integration

#### Service Layer
- `server/services/cliniko.ts` - High-level service functions
- `server/integrations/cliniko.ts` - Low-level API client with sanitization

#### Key Functions
- `findPatientByPhoneRobust(phone)` - Lookup patient by E.164 phone
- `getOrCreatePatient({ phone, fullName?, email? })` - Find or create patient record
- `getAvailability({ fromISO, toISO, timezone, practitionerId, appointmentTypeId })` - Fetch available slots
- `createAppointmentForPatient(phone, { startsAt, practitionerId, appointmentTypeId, notes, fullName?, email? })` - Book appointment

#### Appointment Types
- **Standard Appointment** (`CLINIKO_APPT_TYPE_ID`) - For returning patients
- **New Patient Appointment** (`CLINIKO_NEW_PATIENT_APPT_TYPE_ID`) - Longer duration for new patients

### Database Schema

Tables managed via Drizzle ORM (PostgreSQL):

#### tenants
```sql
id, slug, clinic_name, greeting, timezone, created_at
```
Multi-tenant structure (currently single tenant: "default")

#### conversations
```sql
id, tenant_id, lead_id, is_voice, state, context (JSONB), created_at
```
Stores ongoing call context as JSON (CallContext from FSM)

#### call_logs
```sql
id, tenant_id, conversation_id, call_sid, from_number, to_number,
intent, summary, recording_sid, recording_url, recording_status,
transcript, duration, created_at
```

#### alerts
```sql
id, tenant_id, conversation_id, reason, payload (JSONB), status, created_at
```
Reasons: `cliniko_error`, `booking_failed`, `no_availability`, `human_request`, `sms_error`

#### phone_map
```sql
id, phone (unique), full_name, email, patient_id, updated_at
```
Caches caller identity (E.164 phone → Cliniko patient ID)

#### appointments
```sql
id, phone, patient_id, cliniko_appointment_id, starts_at, status, created_at, updated_at
```
Local copy for reschedule/cancel lookups

### Environment Variables

See `.env.example` for full list. Key variables:

#### Twilio
```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER      # E.164 format, e.g., +61xxxxxxxxx
```

#### Cliniko
```
CLINIKO_API_KEY
CLINIKO_REGION           # e.g., au4
CLINIKO_BUSINESS_ID
CLINIKO_PRACTITIONER_ID
CLINIKO_APPT_TYPE_ID              # Standard appointment
CLINIKO_NEW_PATIENT_APPT_TYPE_ID  # New patient appointment
```

#### Database
```
DATABASE_URL             # Postgres connection string
```

#### Feature Flags
```
CALL_RECORDING_ENABLED=true
TRANSCRIPTION_ENABLED=true
IDENTITY_CAPTURE=true
INTENT_ENGINE=true
```

#### Voice
```
TTS_VOICE=Polly.Matthew  # Or Polly.Nicole-Neural, Polly.Olivia-Neural
```

#### Security
```
RECORDING_TOKEN          # Required for /api/recordings/* access
WS_TOKEN                # Required for /ws WebSocket connection
```

#### Timezone
```
TZ=Australia/Brisbane
```

### Voice & TTS

#### Allowed Voices
- `Polly.Matthew` (default, Australian male)
- `Polly.Nicole-Neural` (Australian female)
- `Polly.Olivia-Neural` (Australian female)
- `Polly.Amy-Neural` (British female, optional)

#### Text Sanitization
All spoken text MUST pass through sanitization before `<Say>`:
- `saySafe()` - from `server/utils/voice-constants.ts`
- `sanitizeForSay()` - removes emojis, smart quotes, illegal XML characters
- `ttsClean()` - additional cleanup

#### Time Formatting
- Use `labelForSpeech()` for speaking times
- Always use `AUST_TZ` constant from `server/time.ts`
- Example: "9:30am tomorrow" instead of ISO strings

### Security

#### Twilio Webhook Validation
- All `/api/voice/*` routes wrapped in `validateTwilioRequest` middleware
- Bypassed if `APP_MODE=TEST`
- Implementation: `server/middlewares/twilioAuth.ts`

#### Recording Access Control
- `/api/recordings/:sid/*` requires query param `?token=RECORDING_TOKEN`
- Prevents public access to call recordings

#### WebSocket Auth
- `/ws` connection requires query param `?token=WS_TOKEN`

### State Management

#### Call Context Persistence
- Stored in `conversations.context` as JSONB
- `CallFlowHandler.loadContext()` - Restore state on each Twilio webhook
- `CallFlowHandler.saveContext()` - Persist after each state change

#### Session Management
- Keyed by `callSid` (Twilio Call SID)
- Multi-turn conversations maintained across HTTP requests via DB persistence

### Observability

#### Call Logging
Every call creates:
- `call_logs` entry with callSid, from/to, intent, summary
- Updated with recording URL when available

#### Alerts
Automatically created for:
- Cliniko API failures
- No availability found
- Booking failures
- SMS send errors
- Human transfer requests

#### WebSocket Events
Real-time dashboard updates:
- `emitCallStarted({ callSid, fromNumber, intent })` - in `server/services/websocket.ts`
- `emitCallUpdated({ callSid, summary, recordingUrl })`
- `emitAlertCreated({ reason, payload })`

### Error Handling

#### Graceful Degradation
- If Cliniko unavailable → create alert, transfer to human
- If no availability → create alert, offer waitlist
- If SMS fails → log warning, continue call (non-blocking)
- If TTS fails → retry with FALLBACK_VOICE, strip aggressive characters

#### Retry Logic
- Patient type detection: 2 retries before assuming new patient
- Slot selection: 2 retries before transferring to human
- Form waiting: 2-minute timeout before ending call

### Multi-Tenant Design (Prepared for Future)

Current: Single tenant ("default")

Future-ready structure:
- `tenants` table with slug, clinic name, greeting, timezone
- Foreign keys: `call_logs.tenant_id`, `alerts.tenant_id`, `conversations.tenant_id`
- Per-tenant Cliniko credentials (future env var structure)
- Per-tenant voice flows (future routing)

### Deployment Considerations

#### Supported Platforms
1. **Replit** (dev only) - unstable, limited CPU, not for production
2. **Render.com / Fly.io** (recommended) - Node server, WebSocket support
3. **Requirements**:
   - HTTPS endpoint for Twilio webhooks
   - Low latency (<5 second response time)
   - WebSocket support for dashboard

#### Database
- PostgreSQL required (Neon, Supabase, or self-hosted)
- Drizzle ORM migrations via `npm run db:push`

#### Environment
- Must set all required env vars (see `.env.example`)
- Timezone must match clinic location

### Code Organization

```
server/
  routes/
    voice.ts         # Twilio voice webhooks
    app.ts           # Dashboard API + diagnostics
    forms.ts         # New patient intake forms
  services/
    callFlowHandler.ts       # FSM implementation
    cliniko.ts              # Cliniko high-level service
    sms.ts                  # Twilio SMS
    websocket.ts            # Real-time dashboard events
    transcription.ts        # AssemblyAI integration
    intent.ts               # Intent classification
    communication-quality.ts # QA scoring (future)
  integrations/
    cliniko.ts              # Cliniko API client (low-level)
  middlewares/
    twilioAuth.ts           # Webhook validation
  utils/
    voice-constants.ts      # saySafe(), VOICE_NAME
    tz.ts                   # Timezone helpers
    env.ts                  # Environment variable validation
  storage.ts                # Database abstraction layer
  db.ts                     # Drizzle connection
  index.ts                  # Express app entry point

shared/
  schema.ts                 # Drizzle schema definitions

client/
  src/
    pages/                  # Dashboard pages
    components/             # React components
```

## Critical Constraints

From `claude.md`:

1. **Never break TwiML structure** - All voice responses must be valid XML
2. **Always sanitize text for `<Say>`** - Use `saySafe()`, never raw strings
3. **Always use timezone helpers** - Use `AUST_TZ`, `labelForSpeech()`
4. **Never hardcode voice names** - Use `VOICE_NAME`, `FALLBACK_VOICE` env vars
5. **All Gather must have timeout, speechTimeout, actionOnEmptyResult**
6. **Recording callback must always update recordingSid, recordingUrl, status**
7. **Schema changes require migration files**
8. **Twilio signature validation required** (unless `APP_MODE=TEST`)

## Next Steps

See `docs/echo-desk-roadmap.md` for planned features and timeline.
