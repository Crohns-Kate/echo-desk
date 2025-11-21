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
- `POST /api/voice/transcription-status` - Transcription status callback from Twilio

#### SMS Routes (server/routes/sms.ts)
- `POST /api/sms/inbound` - Handles inbound SMS for email address updates
  - Validates email format with regex
  - Updates conversation context
  - Syncs to Cliniko patient record (for existing patients only)
  - Sends confirmation SMS to user
  - Includes safeguards to prevent data corruption for new patients

#### Dashboard Routes (server/routes/app.ts)
- `GET /api/calls` - List recent calls with pagination
- `GET /api/stats` - Dashboard statistics (active calls, alerts, bookings)
- `GET /api/alerts` - List active alerts
- `PATCH /api/alerts/:id/dismiss` - Dismiss an alert
- `GET /api/recordings/:sid/stream` - Stream call recording (requires RECORDING_TOKEN)
- `GET /api/qa/reports` - List all QA reports with scores
- `GET /api/qa/report/:callId` - Get detailed QA report for specific call

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
FAQ_ANSWERING                // Answer frequently asked questions
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

### FAQ Knowledge Brain

#### Overview
The FAQ system provides instant answers to common patient questions about clinic hours, location, services, pricing, and policies. It uses keyword-based matching with natural language understanding.

#### Components
- **FAQ Service**: `server/services/faq.ts`
  - `searchFaqByQuery(query)` - Searches FAQs using keyword matching
  - `detectFaqIntent(speech)` - Detects if user is asking an FAQ question
  - `formatFaqAnswerForSpeech(answer)` - Formats answers for TTS
- **Database**: `faqs` table (category, question, answer, keywords, priority)
- **Seed Script**: `server/scripts/seed-faqs.ts` - Populates default FAQs
- **FSM Integration**: FAQ detection in `CallFlowHandler.handlePatientTypeDetect()`

#### FAQ Categories
- **hours**: Operating hours and availability
- **location**: Clinic address and directions
- **parking**: Parking information
- **billing**: Costs, payment methods, insurance
- **services**: Treatments and specializations
- **preparation**: What to bring to appointments
- **cancellation**: Cancellation policies and fees
- **first-visit**: New patient process
- **urgent**: Emergency/same-day appointments
- **booking**: Online booking options

#### Flow
1. User asks a question during call (e.g., "What are your hours?")
2. `detectFaqIntent()` identifies the question category
3. `searchFaqByQuery()` finds best matching FAQ by keywords
4. Answer is formatted for natural speech and spoken to caller
5. System asks if they need anything else (book appointment, more questions, or end call)

### QA Engine (Quality Assurance)

#### Overview
The QA Engine automatically analyzes completed calls to assess quality and identify areas for improvement. It runs automatically after each call transcription completes.

#### Components
- **Engine**: `server/services/qa-engine.ts`
- **API Routes**: `server/routes/app.ts:138-207`
- **Database Storage**: `qa_reports` table
- **Frontend Display**:
  - Call list view: `client/src/pages/calls.tsx` (shows overall score badge)
  - Call detail view: `client/src/pages/call-detail.tsx` (shows full breakdown + issues)

#### Scoring Dimensions (0-10 scale)
1. **Identity Detection Score** - How well the system identified and verified the caller
   - Did it correctly determine new vs returning patient?
   - Was patient lookup successful?
   - Were there disambiguation issues?

2. **Patient Classification Score** - Accuracy of new vs returning classification
   - Was the classification correct based on the transcript?
   - Were there misclassifications or confusion?

3. **Email Capture Score** - Effectiveness of email collection
   - Was email collected successfully (via form or verification)?
   - Was it validated properly?
   - N/A if email not needed for this call type

4. **Appointment Type Score** - Correct appointment duration selection
   - New patient appointments vs standard appointments
   - Match between patient type and appointment type
   - N/A if no appointment booked but process was correct

5. **Prompt Clarity Score** - Quality of AI prompts and responses
   - Were questions clear and easy to understand?
   - Did the caller understand what was being asked?
   - Were there excessive repetitions or confusions?

6. **Overall Score** - Weighted average of all dimensions

#### Issue Detection
For each detected issue, the QA Engine captures:
- **Issue**: Brief title (e.g., "Failed to recognize returning patient")
- **Cause**: Root cause analysis (e.g., "Phone number lookup returned no results")
- **Location in Transcript**: Quoted excerpt showing where the issue occurred
- **Recommended Fix**: Specific actionable improvement (e.g., "Add fuzzy phone matching")

#### Analysis Methods

**LLM-Powered Analysis** (Primary):
- Uses OpenAI GPT-4o-mini for intelligent analysis
- Requires `OPENAI_API_KEY` environment variable
- Provides detailed, context-aware scoring
- Temperature: 0.2 for consistency
- Response format: Structured JSON

**Rule-Based Analysis** (Fallback):
- Pattern matching on transcript keywords
- Used when LLM is unavailable or fails
- Detects common issues like:
  - Patient lookup failures
  - Multiple patient disambiguation
  - Excessive apologies/repetitions
  - Caller frustration indicators
  - Technical errors

#### Automatic Execution
QA analysis runs automatically when:
1. Call recording completes (`recordingStatus === 'completed'`)
2. Transcription service is enabled (`TRANSCRIPTION_ENABLED=true`)
3. Transcript becomes available (via AssemblyAI or Twilio)

**Flow**:
```
Call ends → Recording callback → Transcription triggered
→ Transcript received → QA Engine runs → Report saved to database
```

**Implementation**: `server/routes/voice.ts:332-351`

#### Database Schema
```sql
qa_reports (
  id, call_sid (unique), call_log_id,
  identity_detection_score, patient_classification_score,
  email_capture_score, appointment_type_score, prompt_clarity_score,
  overall_score, issues (JSONB), created_at
)
```

#### API Endpoints
- `GET /api/qa/reports?limit=50` - List all QA reports, sorted by most recent
- `GET /api/qa/report/:callId` - Get or generate QA report for specific call
  - Accepts either numeric call log ID or Twilio CallSID
  - Generates report on-the-fly if not already exists
  - Saves generated report for future requests

#### Frontend Integration
**Calls List** (`/calls`):
- Shows overall score badge (0-10) next to each call
- Color-coded: green (8-10), yellow (6-7), red (0-5)
- Empty state if no QA report exists yet

**Call Detail** (`/calls/:id`):
- Full QA Report card with:
  - Score breakdown grid (6 metrics with icons)
  - Issues list with causes and recommended fixes
  - Color-coded severity indicators
- Only shown if QA report exists for the call

#### Configuration
```env
OPENAI_API_KEY=sk-...  # Required for LLM analysis
OPENAI_BASE_URL=https://api.openai.com/v1  # Optional, defaults to OpenAI
TRANSCRIPTION_ENABLED=true  # Must be enabled for QA to work
```

### SMS Email Update Pipeline

#### Overview
Patients can send their email address via SMS to automatically update their Cliniko patient record.

#### Flow
1. Patient sends SMS with email address to clinic phone number
2. Twilio sends webhook POST to `/api/sms/incoming`
3. System validates:
   - Phone number format (E.164 Australian)
   - Email format (basic validation with `sanitizeEmail()`)
4. System looks up patient by phone number in Cliniko
5. If found, updates patient's email address via Cliniko API
6. Sends confirmation SMS back to patient

#### Flow Details
1. **Incoming SMS** → Twilio webhook POST to `/api/sms/inbound`
2. **Email Detection** → Regex validation: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
3. **Call Lookup** → Find most recent call from this phone number
4. **Conversation Update** → Save email to conversation context
5. **Patient Type Check**:
   - If `patientMode === 'new'` → Skip Cliniko update (will be set during booking)
   - If returning patient → Update Cliniko patient record
6. **Cliniko Update** → Call `updateClinikoPatientEmail(patientId, email)`
7. **Confirmation SMS** → Send success/error message back to patient

#### Patient Mode Safety
The system includes protection against data corruption:
- **New patients**: Email is saved to context but NOT pushed to Cliniko immediately
  - Reason: Patient record doesn't exist yet
  - Email will be included when creating the patient record during booking
- **Returning patients**: Email is updated immediately in Cliniko
  - Lookup patient by phone
  - Update existing patient record
  - Send confirmation

This prevents the BUG-001 scenario where a new patient calling from a shared phone number could accidentally overwrite an existing patient's email.

#### Error Handling
- Invalid phone format → Error SMS with reason
- Invalid email format → Error SMS with guidance
- Patient not found → Email saved to context, confirmation sent (will sync during booking)
- Cliniko update failure → Email saved to context, confirmation sent (graceful degradation)
- No recent call found → Error SMS requesting them to call

#### Implementation
- **Webhook Handler**: `server/routes/sms.ts:14-126` (`POST /api/sms/inbound`)
- **SMS Functions**: `server/services/sms.ts`
  - `sendEmailUpdateConfirmation()` - Success message
  - `sendEmailUpdateError()` - Error messages with reason
- **Cliniko Integration**: `server/integrations/cliniko.ts`
  - `updateClinikoPatientEmail(patientId, email)` - Email-only update (line 426)
  - `updateClinikoPatient(patientId, updates)` - General update (line 432)
- **Validation Helpers**: `server/integrations/cliniko.ts`
  - `sanitizeEmail()` - Email validation and cleanup (line 171)
  - `sanitizePhoneE164AU()` - Phone normalization (line 183)
- **Patient Lookup**: `server/services/cliniko.ts`
  - `findPatientByPhoneRobust()` - Robust phone-based lookup with retries

#### Configuration
In Twilio Console → Phone Numbers → Messaging Configuration:
```
Webhook URL: https://your-domain.com/api/sms/inbound
HTTP Method: POST
```

Twilio will forward all incoming SMS messages to this endpoint.

### Cliniko Integration

#### Service Layer
- `server/services/cliniko.ts` - High-level service functions
- `server/integrations/cliniko.ts` - Low-level API client with sanitization

#### Key Functions
- `findPatientByPhoneRobust(phone)` - Lookup patient by E.164 phone
- `getOrCreatePatient({ phone, fullName?, email? })` - Find or create patient record
- `updateClinikoPatient(patientId, { email?, first_name?, last_name?, ... })` - Update patient record
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

### Frontend Dashboard

#### Overview
The Echo Desk dashboard provides real-time monitoring and management of voice calls, QA reports, transcripts, and system settings.

#### Pages and Routes

**Main Dashboard** (`/` - `client/src/pages/dashboard.tsx`):
- Real-time metrics cards: Active Calls, Pending Alerts, Today's Calls
- Recent calls list with recording status and QA scores
- Recent alerts list with severity indicators
- System status indicator
- WebSocket-powered live updates

**Call Logs** (`/calls` - `client/src/pages/calls.tsx`):
- Searchable table of all calls
- Columns: Timestamp, From Number, Intent, Duration, QA Score, Status
- Recording and transcription status badges
- Click through to detailed call view
- Download transcript button

**Call Detail** (`/calls/:id` - `client/src/pages/call-detail.tsx`):
- Call metadata (timestamp, duration, phone numbers, intent)
- Inline audio player for call recordings
- Full transcript display
- Comprehensive QA report with:
  - Score breakdown (6 metrics with color-coded badges)
  - Issues list with causes and recommended fixes
  - Overall quality assessment
- Download recording and transcript buttons

**QA Reports** (`/qa-reports` - `client/src/pages/qa-reports.tsx`):
- List all QA reports with filtering
- Stats cards: Total Reports, Average Score, High Quality, Needs Improvement
- Table view with all score dimensions
- Color-coded trend indicators
- Link to full call details

**Transcripts** (`/transcripts` - `client/src/pages/transcripts.tsx`):
- All transcribed calls with full-text search
- Stats: Total Transcripts, Average Words/Call, Search Results
- Preview cards with summary and truncated transcript
- Word count badges
- Link to full call view

**Settings** (`/settings` - `client/src/pages/settings.tsx`):
- System information (version, environment, timezone)
- Feature flags (Recording, Transcription, QA Engine)
- Integration status (Twilio, Cliniko, AssemblyAI, OpenAI)
- System actions (Health checks, timezone verification)
- Documentation links

**Alerts** (`/alerts` - `client/src/pages/alerts.tsx`):
- Active and dismissed alerts
- Severity filtering
- Dismiss alert action
- Alert details and payloads

**Tenants** (`/tenants` - `client/src/pages/tenants.tsx`):
- Multi-tenant management (prepared for future)
- Clinic configuration
- Tenant-specific settings

#### UI Components

**Layout** (`client/src/components/layout/`):
- `app-layout.tsx` - Main layout with sidebar
- `sidebar.tsx` - Navigation sidebar with active route highlighting

**Shared Components**:
- Radix UI primitives (Card, Badge, Button, Input)
- Tailwind CSS styling
- Responsive design (mobile-friendly)
- Dark mode support
- Loading states and empty states
- Error boundaries

#### Real-Time Features
- WebSocket connection for live updates
- Auto-refreshing call lists
- Live QA score updates
- Alert notifications
- Connection status indicator

#### Data Fetching
- TanStack React Query for server state management
- Automatic refetching on window focus
- Optimistic updates
- Error handling with retry logic
- Caching for improved performance

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
