# CLAUDE.md - Echo Desk AI Operating System

## AUTONOMOUS MODE — ACTIVE

**Status**: Authorized for autonomous code changes
**Last Updated**: November 22, 2025 - Phase 4 Core Complete

---

## OPERATING RULES

### Rule 1: NO PERMISSION REQUESTS
- Full permission to modify, refactor, restructure, extend codebase
- Choose robust, scalable, commercial-grade solutions
- No "should I proceed?" or "is this okay?"

### Rule 2: DIRECT FILE MODIFICATIONS
- Update files immediately when features/fixes requested
- Create files if they don't exist
- Use best-practice structure automatically

### Rule 3: ALWAYS UPDATE THIS FILE
After ANY change, update with:
1. What was done
2. Why it was done
3. Next steps
4. Architectural notes
5. Known issues
6. To-do list

### Rule 4: CONTEXT PERSISTENCE
On session reload:
- Read this file automatically
- Continue from where left off
- No restatement requests

### Rule 5: WORK UNTIL FINISHED
- Continue until feature complete
- Only stop for blocking constraints
- No mid-task permission pauses

---

## PROJECT STATE: PHASE 4 COMPLETE ✅ → PHASE 5 READY

### What Was Just Completed (November 2025)

**Dashboard (Complete)**:
- Main dashboard with real-time metrics
- Call logs with QA scores
- Full call detail with audio player
- QA reports with filtering
- Transcripts with full-text search
- Settings page with system info
- Sidebar navigation
- WebSocket live updates

**FAQ Knowledge Brain (Complete)**:
- `faqs` table with 10 seeded FAQs
- `server/services/faq.ts` with keyword search
- Intent detection (`detectFaqIntent()`)
- TTS formatting (`formatFaqAnswerForSpeech()`)
- FSM integration: `FAQ_ANSWERING` + `FAQ_FOLLOWUP` states
- Multi-turn FAQ support
- Categories: hours, location, parking, billing, services, preparation, cancellation, first-visit, urgent, booking

**SMS → Cliniko Pipeline (Complete)**:
- Email validation via SMS
- Conversation context updates
- Cliniko patient sync (existing patients only)
- Data corruption safeguards for new patients
- Success/failure logging
- Confirmation SMS responses

**Error Recovery (Enhanced)**:
- Conversational retry prompts with variations
- FAQ detection before patient type determination
- Graceful degradation throughout FSM
- Better handling of unclear responses

**Documentation (Updated)**:
- `echo-desk-architecture.md` - FAQ system, dashboard, SMS pipeline
- `echo-desk-fsm.md` - FAQ states and transitions
- `echo-desk-roadmap.md` - Phase 3 marked complete

---

## PHASE 3 FINAL VALIDATION (November 22, 2025)

### A1: Appointment Slot Search Accuracy ✅

**Enhanced date-parser.ts** with support for:
- `today`, `tomorrow` - correct timezone handling
- Weekdays: `saturday`, `monday`, etc. - finds next occurrence
- `this saturday` vs `next saturday` - 7-day difference validated
- `next week` - returns Monday-Friday of next week
- Explicit dates: `23rd`, `the 23rd`, `on the 15th`
- Month+day: `may 23rd`, `23rd of may`, `december 15`
- Slash format: `23/5`, `15/12` (DD/MM Australian format)

**34 automated tests** covering all scenarios:
```bash
npm run test:dates    # Date parser tests
```

### A2: Multi-Patient Disambiguation ✅

**Behaviors validated**:
- Same phone, two existing patients: Asks "Is this Michael or Sarah?"
- Selection by DTMF digit (1/2/3)
- Selection by name in speech
- "Someone new" creates fresh patient WITHOUT overwriting existing records
- Correction flows ("No, it's for my son instead")
- Case insensitivity

**23 automated tests**:
```bash
npm run test:multi-patient    # Multi-patient tests
```

### A3: End-to-End Booking Flow Tests ✅

**Flows validated**:
- New patient: Greeting → Phone confirm → Form → Complaint → Search → Book
- Existing patient: Lookup → Complaint → Search → Book
- Multi-patient disambiguation
- Mid-flow date changes ("actually, do you have Tuesday instead?")
- Error recovery (no availability, unclear speech, invalid selection)
- State machine transitions
- Appointment type selection (NEW_PATIENT vs STANDARD)

**42 automated tests**:
```bash
npm run test:booking    # Booking flow tests
```

### Running All Tests

```bash
npm test              # Runs ALL test suites (99+ tests)
npm run test:dates    # Date parser only
npm run test:appointment  # Appointment search only
npm run test:multi-patient  # Multi-patient disambiguation
npm run test:booking  # End-to-end booking flows
```

### Remaining Limitations

1. **Transcription Integration** - Not fully validated (requires live calls)
2. **Recording Reliability** - Timing edge cases not fully tested
3. **DOB Confirmation** - Not implemented for returning patient verification

---

## PHASE 4: MULTI-TENANT ARCHITECTURE ✅ (Complete)

See `docs/echo-desk-multitenant-architecture.md` for full design.

### Implemented (November 22, 2025)

**Schema Enhancements:**
- Enhanced `tenants` table with: `phoneNumber`, `voiceName`, `greeting`, `fallbackMessage`, `businessHours`, `clinikoApiKeyEncrypted`, `clinikoShard`, `clinikoPractitionerId`, feature flags, subscription fields
- Added `tenantId` to: `phoneMap`, `appointments`, `qaReports`
- All tenant-scoped tables now have FK to tenants

**Tenant Resolver Service (`server/services/tenantResolver.ts`):**
- `resolveTenant(calledNumber)` - Maps Twilio phone to tenant
- `resolveTenantWithFallback(calledNumber)` - With default fallback
- `getTenantContext(tenant)` - Builds full context object
- `encrypt()/decrypt()` - AES-256-CBC for Cliniko API keys

**Storage Layer Updates:**
- `getTenantByPhone(phoneNumber)`
- `getTenantById(id)`
- `updateTenant(id, updates)`

**Voice Routes Integration:**
- `/api/voice/incoming` now resolves tenant by called number
- `CallFlowHandler` accepts `TenantContext` for clinic-specific settings
- Greeting, clinic name, timezone now tenant-aware

**Admin API Endpoints:**
```
GET    /api/admin/tenants           # List all tenants
GET    /api/admin/tenants/:slug     # Get tenant by slug
POST   /api/admin/tenants           # Create new tenant
PATCH  /api/admin/tenants/:id       # Update tenant settings
GET    /api/admin/tenants/:id/stats # Get tenant stats
```

### Database Migration Required
Run after deployment:
```bash
npm run db:push
```

### Phase 4 Complete
1. ✅ Tenant admin UI in dashboard
2. ✅ Per-tenant FAQ management UI
3. ✅ Tenant onboarding wizard (5-step guided setup)
4. ✅ Stripe billing integration (subscriptions, webhooks, portal)

---

## CRITICAL ARCHITECTURE RULES (NEVER BREAK)

### Voice Engine (Mandatory)
1. **Only allowed voices**: Polly.Matthew, Polly.Nicole-Neural, Polly.Olivia-Neural, Polly.Amy-Neural
2. **Always use**: `VOICE_NAME`, `FALLBACK_VOICE` (never hardcode)
3. **Sanitization required**: `saySafe()`, `sanitizeForSay()`, `ttsClean()` for ALL text
4. **No illegal characters**: emojis, smart quotes, curly apostrophes, XML tags
5. **Every Gather must have**: timeout, speechTimeout, actionOnEmptyResult, redirect fallback
6. **Timezone**: Always use `labelForSpeech()`, `AUST_TZ`

### Security (Mandatory)
1. Twilio signature validation on `/api/voice/*` (unless `APP_MODE=TEST`)
2. Recording access requires `RECORDING_TOKEN`
3. Schema changes need migration file + version bump
4. No new required env vars without updating `.env.example`

### State Machine (FSM)
- 14 states including FAQ_ANSWERING, FAQ_FOLLOWUP
- Valid transitions enforced in `CallFlowHandler`
- Session context persisted via conversation storage
- See `docs/echo-desk-fsm.md` for full spec

### Observability
- All calls must log: callSid, from, to, intent, summary, timestamps
- Alerts auto-create for: Cliniko fails, no availability, booking fails, SMS errors
- WebSocket events: `emitCallStarted()`, `emitCallUpdated()`, `emitAlertCreated()`

---

## KNOWN ISSUES

### Critical
- None currently blocking

### High Priority
- None - Phase 3 validation complete

### Medium Priority
1. Recording start race condition (sometimes fails)
2. Form timeout UX (needs periodic updates)
3. DOB confirmation for returning patients not implemented

### Low Priority
1. Transcription integration needs live call validation
2. Some edge cases in speech recognition not covered

---

## PHASE 4 ROADMAP (In Progress)

### Priority 1: Multi-Tenant Core (Current)
1. **Data Model** - `tenants` table, tenant_id FKs
2. **Call Routing** - Phone number → tenant mapping
3. **Tenant Context** - Middleware for request scoping
4. **Storage Layer** - Tenant-scoped queries

### Priority 2: Per-Tenant Configuration
1. **Cliniko Credentials** - Encrypted per-tenant API keys
2. **Voice Settings** - Custom greetings, practitioner names
3. **FAQ Sets** - Per-clinic FAQ management
4. **Business Hours** - Tenant-specific schedules

### Priority 3: Billing & Admin
1. **Stripe Integration** - Subscription tiers, usage tracking
2. **Admin Dashboard** - Tenant management UI
3. **Roles & Permissions** - Admin, manager, receptionist

### Priority 4: Analytics
1. Call volume charts per tenant
2. Booking conversion rates
3. QA score trends

---

## PHASE 5 ROADMAP (AI Excellence)

1. Sentiment analysis during calls
2. Tone-adaptive responses
3. Conversational context memory
4. Multi-intent handling
5. Predictive scheduling
6. Waitlist automation

---

## TECHNICAL STACK

**Backend**: Node.js, TypeScript, Express, PostgreSQL (Drizzle ORM)
**Voice**: Twilio Voice API + TwiML
**SMS**: Twilio Messaging API
**Practice Management**: Cliniko API
**Transcription**: AssemblyAI
**QA Analysis**: OpenAI GPT-4o-mini (with rule-based fallback)
**Real-time**: WebSockets (ws library)
**Frontend**: React, Wouter, TanStack Query, Radix UI, Tailwind CSS
**Timezone**: Australia/Brisbane (AUST_TZ)

---

## KEY FILES

### Core Voice Flow
- `server/routes/voice.ts` (4459 lines) - Main voice webhook handlers
- `server/services/callFlowHandler.ts` - FSM implementation
- `server/utils/voice-constants.ts` - saySafe(), VOICE_NAME

### Services
- `server/services/cliniko.ts` - High-level Cliniko service
- `server/integrations/cliniko.ts` - Low-level API client
- `server/services/faq.ts` - FAQ knowledge base
- `server/services/qa-engine.ts` - Call quality analysis
- `server/services/sms.ts` - SMS sending
- `server/services/transcription.ts` - AssemblyAI integration
- `server/services/websocket.ts` - Real-time dashboard
- `server/services/tenantResolver.ts` - Multi-tenant resolution + encryption
- `server/services/stripe.ts` - Billing, subscriptions, webhooks

### Data Layer
- `server/storage.ts` - Database abstraction layer
- `server/db.ts` - Drizzle connection
- `shared/schema.ts` - Drizzle schema definitions

### Dashboard
- `client/src/pages/dashboard.tsx` - Main dashboard
- `client/src/pages/calls.tsx` - Call logs
- `client/src/pages/call-detail.tsx` - Call details
- `client/src/pages/qa-reports.tsx` - QA reports
- `client/src/pages/transcripts.tsx` - Transcripts
- `client/src/pages/tenants.tsx` - Tenant admin UI
- `client/src/pages/tenant-onboarding.tsx` - 5-step setup wizard
- `client/src/pages/faq-management.tsx` - Per-tenant FAQ management
- `client/src/pages/billing.tsx` - Subscription management
- `client/src/pages/settings.tsx` - Settings

### Documentation
- `docs/echo-desk-architecture.md` - Complete technical architecture
- `docs/echo-desk-fsm.md` - FSM state machine spec
- `docs/echo-desk-roadmap.md` - Development roadmap
- `docs/echo-desk-bugs.md` - Bug tracking

---

## DEPLOYMENT

**Current**: Replit (dev only - unstable, limited CPU)
**Recommended**: Render.com or Fly.io
**Requirements**: HTTPS, <5sec response time, WebSocket support
**Database**: PostgreSQL (Neon, Supabase, or self-hosted)

---

## SUCCESS METRICS - PHASE 3

- ✅ Dashboard deployed and operational
- ✅ FAQ system answering common questions
- ✅ QA engine analyzing call quality
- ✅ SMS → Cliniko pipeline working
- ⚠️ Barge-in not yet implemented
- ⚠️ Date logic needs validation
- 🎯 Target: 95% booking accuracy
- 🎯 Target: <5% error rate
- 🎯 Target: 80% high-quality calls (QA score >8/10)
- 🎯 Target: 70% FAQ resolution rate

---

## CHANGE LOG

### 2025-11-22 Phase 3 Final Validation + Phase 4 Implementation
- ✅ **A1: Appointment Slot Search Accuracy**
  - Enhanced date-parser.ts with explicit date support (23rd, may 23rd, 23/5)
  - Added "next week" parsing (Monday-Friday)
  - 34 automated tests covering all date scenarios
- ✅ **A2: Multi-Patient Disambiguation**
  - Validated disambiguation logic for same-phone scenarios
  - Tested correction flows ("No, it's for my son")
  - 23 automated tests for multi-patient scenarios
- ✅ **A3: End-to-End Booking Flow Tests**
  - Created comprehensive test harness
  - Tests new patient, existing patient, mid-flow changes
  - 42 automated tests covering full FSM
- ✅ **Test Suite Complete**: 99+ tests, all passing
- ✅ **Phase 4 Multi-Tenant Core**:
  - Enhanced tenants schema with full config fields
  - Created `tenantResolver.ts` service with encryption
  - Updated storage layer with tenant methods
  - Integrated tenant context into voice routes
  - Added tenant admin API endpoints (CRUD + stats)
- ✅ **Phase 4 Admin UI**:
  - Full tenant admin UI in `client/src/pages/tenants.tsx`
  - Per-tenant FAQ management in `client/src/pages/faq-management.tsx`
  - FAQ CRUD API endpoints (`/api/faqs`)
  - Category filtering, search, priority management
- ✅ **Phase 4 Onboarding Wizard**:
  - 5-step guided setup: Basic Info, Contact, Voice, Cliniko, Features
  - `client/src/pages/tenant-onboarding.tsx`
  - Slug auto-generation from clinic name
- ✅ **Phase 4 Stripe Billing**:
  - `server/services/stripe.ts` - Full billing service
  - Subscription tiers: Free, Starter ($99), Pro ($299), Enterprise ($599)
  - Checkout sessions, billing portal, webhooks
  - Call limit enforcement per tier
  - `client/src/pages/billing.tsx` - Subscription management UI
- 🎯 **Next**: Run `npm run db:push` to apply schema changes, configure Stripe env vars

### 2025-11-21 Phase 3 - Session 2
- ✅ Implemented barge-in support: Added `actionOnEmptyResult: true` to all Gather calls in CallFlowHandler
- ✅ Audited date logic: parseNaturalDate validated for today/tomorrow/weekend handling
- ✅ Reviewed name usage: Appropriate personalization levels, no excessive repetition
- ✅ Build successful, ready for deployment

### 2025-11-21 - Phase 3 Completion
- ✅ Completed dashboard (all pages functional)
- ✅ Implemented FAQ Knowledge Brain
- ✅ Added FAQ states to FSM
- ✅ Enhanced SMS → Cliniko pipeline
- ✅ Improved error recovery
- ✅ Updated all documentation
- ✅ Build successful, ready for deployment

### Current Focus
Phase 4 Multi-Tenant Complete - Ready for Phase 5 (AI Excellence)

---

## AUTONOMOUS OPERATION CONFIRMED

Claude is authorized to:
- Modify any file to progress towards commercial-grade system
- Implement fixes without asking permission
- Refactor code for scalability
- Add features from roadmap
- Update documentation automatically
- Deploy changes when ready

**Communication Style**: Brief summaries (4-6 bullets), no disclaimers, no permission requests.

---

END OF CLAUDE.md
Last Updated: 2025-11-22 (Phase 4 Core Complete)
