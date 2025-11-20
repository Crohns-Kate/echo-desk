# ❗ **IMPORTANT — WHAT YOU SHOULD DO**

You should **paste this NEW version OVER the top** of anything existing.
**Replace your entire CLAUDE.md with the content below.**

Because this is the definitive, complete, unified manual.

Do NOT append.
Do NOT merge.
Do NOT keep the old one.

Just overwrite it with what you’re about to receive.

---

# ✅ **READY TO PASTE — FINAL COMPLETE `CLAUDE.md` (MASTER VERSION)**

Paste EVERYTHING below into the file **exactly as-is**:

---

# CLAUDE.md

## **AI OPERATING SYSTEM — MASTER PROJECT SPECIFICATION**

This file defines the required permanent behaviour of Claude Code inside this project.
Claude must read and obey this document automatically **every session**.

---

# 🎯 **PROJECT PURPOSE**

This project is an **AI Voice Operating System** for service businesses, initially a chiropractic/clinic workflow.

It includes:

* Twilio inbound voice with conversational booking
* Cliniko API operation (availability + create appointment)
* Call logging & conversation tracking
* Real-time dashboard via WebSockets
* Automated alert system
* SMS appointment confirmation
* Multi-tenant structure (foundation laid)
* AI layer (Claude/OpenAI) planned later
* Designed for resale as "EchoDesk"

Claude’s job is to maintain, improve, and extend this system safely and consistently.

---

# 🧱 **ARCHITECTURE OVERVIEW**

## Backend

* Node.js (Express)
* TypeScript
* SQLite via `storage.ts`
* Cliniko API service layer
* Twilio Voice & Messaging
* WebSockets for dashboard
* Timezone management using dayjs with `"Australia/Brisbane"`

## Frontend

* React (small dashboard)
* Alerts, Calls, Tenant configuration

## Routing Essentials

Claude must ensure the following routes **always** exist:

### Voice Routes

```
POST /api/voice/incoming
POST /api/voice/handle
POST /api/voice/recording-status
```

### Dashboard Routes

```
GET /api/calls
GET /api/stats
GET /api/alerts
PATCH /api/alerts/:id/dismiss
GET /api/recordings/:sid/*
```

### Worker/Diagnostic

```
GET /__cliniko/health
GET /__cliniko/avail
GET /__tz/now
```

---

# 🔒 **SECURITY REQUIREMENTS**

Claude must ensure:

### Webhooks

* Twilio signature validation MUST wrap all `/api/voice/*` routes unless `APP_MODE=TEST`.

### Recording Access

* `/api/recordings/:sid/*` requires a `RECORDING_TOKEN`.
* No public access without token.
* Claude must not remove this.

### No Silent Schema Changes

* Schema updates require:

  * migration file
  * version bump
  * safe fallback

### Environment Safety

Claude must NOT:

* Introduce new required env variables without noting it in `.env.example`.
* Remove required env variables unless approved.

---

# 🗣️ **VOICE ENGINE RULES (CRITICAL)**

These rules must be applied in **ALL Twilio voice modifications**.

### Allowed Twilio Voices

Claude must only allow:

```
Polly.Matthew
Polly.Nicole-Neural
Polly.Olivia-Neural
Polly.Amy-Neural (optional)
```

### Never Hardcode Voice Names

Always use:

```
VOICE_NAME
FALLBACK_VOICE
```

### Sanitization is Mandatory

All text MUST go through these before being spoken:

```
saySafe()
sanitizeForSay()
ttsClean()
```

### No illegal characters allowed in <Say>:

Prohibit:

* emojis
* smart quotes
* curly apostrophes
* non-ASCII control chars
* XML tags when not in SSML mode
* undefined/empty string fed into <Say>

### Every Gather must have:

```
timeout
speechTimeout
actionOnEmptyResult
redirect fallback
```

### All times must use:

```
labelForSpeech()
AUST_TZ
```

---

# 🎬 **CALL FLOW (PERMANENT RULES)**

Claude must preserve this state machine:

### 1. `/api/voice/incoming`

* greet caller
* gather speech
* redirect timeout

### 2. `/api/voice/handle?route=start`

“Would you like to book an appointment?”

### 3. `/api/voice/handle?route=book-day`

Confirm intent → ask for day.

### 4. `/api/voice/handle?route=book-part`

Fetch 1–2 slots → offer options.

### 5. `/api/voice/handle?route=book-choose`

Book chosen slot → confirm → SMS.

### 6. Recording Status Callback

```
POST /api/voice/recording-status
```

Must always update:

* recordingSid
* recordingUrl (for streaming)
* status

---

# 📊 **OBSERVABILITY RULES**

Claude must ensure:

### All calls log:

* callSid
* from
* to
* intent
* summary
* timestamps

### Alerts automatically create when:

* Cliniko fails
* No availability
* Booking fails
* SMS errors
* Voice flow errors

### WebSocket Messages:

Claude must use:

```
emitCallStarted()
emitCallUpdated()
emitAlertCreated()
```

---

# 🧪 **UNIT TEST REQUIREMENTS (MANUAL, NOT AUTOMATED)**

Claude must manually test the following endpoints after making changes:

### 1. Voice Flow

```
curl -X POST localhost:5000/api/voice/incoming
curl -X POST localhost:5000/api/voice/handle?route=start
```

### 2. Cliniko

```
/__cliniko/health
/__cliniko/avail
```

### 3. Timezone

```
/__tz/now
```

### 4. Call Log

```
/api/calls
```

### 5. Alerts

```
/api/alerts
```

### 6. Recordings

```
/api/recordings/:sid/stream
```

Claude must check TwiML validity after ANY voice change.

---

# ⚙️ **CODING STANDARDS**

Claude must always:

* Use async/await
* Avoid `any` unless absolutely necessary (and document why)
* Use consistent imports
* Avoid duplication
* Never leave unused variables
* Always TypeScript-check before returning code:

```
npx tsc --noEmit
```

---

# 🔧 **MIGRATION RULES**

If schema changes are necessary:

* Claude must create:
  `migrations/YYYYMMDD-description.sql`
* Add a bump to:
  `storage.getSchemaVersion()`
* Add fallback logic for old data
* Update README + CLAUDE.md accordingly

Claude must never silently change database shape.

---

# 🧠 **LLM LAYER RULES (FOR FUTURE)**

This system will later include:

* Intent classifier (partially done)
* Conversation memory
* Multi-turn guidance
* Agents that can book/cancel/reschedule

Claude must prepare code to be:

* modular
* function-based
* easily wrapped by a future LLM router

LLM logic must always be isolated under:

```
/server/services/intent.ts
/server/services/ai/
```

---

# 🧱 **SPRINT WORKFLOW (PERMANENT)**

Claude must follow this sprint structure for all future change requests:

### Sprint 0 — Safety

Fix crashes, guardrails, errors.

### Sprint 1 — Consistency

Timezones, naming, architecture cleanup.

### Sprint 2 — Observability

Logs, alerts, WebSocket wiring.

### Sprint 3 — Dashboard/UI

Stats, pagination, filtering.

### Sprint 4 — LLM Integration

Later.

### Sprint 5 — Multi-Tenant Expansion

Later.

### Sprint 6 — Production Hardening

Before deployment.

Claude must automatically classify tasks into these sprints.

---

# 🚀 **DEPLOYMENT RULES**

Claude must prepare code so it can deploy on:

### 1. Replit (dev only)

* unstable
* limited CPU
* should not be used for production

### 2. Render.com or Fly.io (recommended)

* Node server
* Websocket
* SQLite OK but Postgres preferred

### 3. Twilio Webhook Requirements

* HTTPS
* Low latency
* Must respond < 5 seconds

Claude must keep the code stateless and safe for scaling.

---

# 👥 **MULTI-TENANT DESIGN (FUTURE)**

Claude must design new features so they can be expanded to:

* multiple clinics
* per-tenant voice flows
* per-tenant TTS voices
* per-tenant Cliniko keys
* per-tenant dashboards

All new code must be written with this future in mind.

---

# 🧯 **FALLBACK RULESET (IF ANYTHING BREAKS)**

Claude must automatically apply these when errors occur:

### If Cliniko errors →

* Create alert
* Speak:
  “Sorry, I couldn’t access the schedule.”

### If no availability →

* Create alert
* Offer another day

### If booking fails →

* Create alert
* Speak:
  “Sorry, your booking could not be completed.”

### If SMS fails →

* Log warning
* Do NOT interrupt call

### If Twilio rejects TTS →

* Retry with FALLBACK_VOICE
* Strip characters aggressively

---

# 🧨 **NEVER BREAK THESE (CRITICAL FAIL CONDITIONS)**

Claude must never:

* Introduce `<Say>` output containing illegal characters
* Remove sanitization
* Remove timezone constants
* Break TwiML structure
* Remove call logging
* Remove alert creation
* Remove recording callback
* Remove `VOICE_NAME` usage
* Remove fallback voice

If Claude needs to refactor voice code, it must do so **minimally** and **safely**.

---

# 📚 PROJECT FILES INDEX

## Documentation Files

The following documentation files provide detailed technical specifications and guidance:

### `./docs/echo-desk-architecture.md`
Complete technical architecture documentation including:
- Technology stack (Node.js, TypeScript, Express, PostgreSQL, Twilio, Cliniko)
- Route definitions and API endpoints
- Call flow state machine overview
- Cliniko integration details
- Database schema and tables
- Environment variables reference
- Voice/TTS configuration
- Security implementation
- State management and persistence
- Error handling patterns
- Multi-tenant design
- Deployment requirements
- Code organization structure
- Critical constraints and rules

### `./docs/echo-desk-fsm.md`
Detailed finite state machine (FSM) specification for call flow:
- Complete state diagram
- All 12 state definitions with:
  - Purpose and entry prompts
  - Expected inputs and hints
  - Session data read/write
  - State transitions and rules
  - Implementation references
- State transition validation rules
- Session context schema (CallContext interface)
- Persistence and recovery mechanisms
- Error handling per state
- Future enhancement plans
- Testing requirements

### `./docs/echo-desk-roadmap.md`
8-12 week development roadmap with 6 stages:
- **Stage 1** (2 weeks): Core stability and appointment correctness
- **Stage 2** (3 weeks): QA engine, conversation quality scoring, FAQ knowledge base
- **Stage 3** (3 weeks): Multi-tenant support, advanced dashboard, analytics
- **Stage 4** (2 weeks): Barge-in, conversational AI, reschedule/cancel flows
- **Stage 5** (1 week): Production hardening, security audit, load testing
- **Stage 6** (Ongoing): Launch, pilot deployment, iteration
- Success metrics for each stage
- Technical debt tracking
- Refactoring priorities

### `./docs/echo-desk-bugs.md`
Bug tracking and QA log including:
- Bug report template
- Critical historical bugs:
  - BUG-001: "Michael Bishopp" patient identity issue (fixed)
  - Recording race condition (open)
  - Form timeout edge cases (open)
  - Multiple patient disambiguation (open)
- Fixed bugs archive
- Known issues and limitations
- Pre-deployment QA checklist
- Testing procedures for all flows
- Bug reporting guidelines
- Priority definitions
- Monitoring and alerting strategy

## How to Use These Files

**For Development**:
1. Read `echo-desk-architecture.md` first to understand the system
2. Refer to `echo-desk-fsm.md` when modifying call flow logic
3. Check `echo-desk-bugs.md` before making changes (avoid regressions)
4. Update `echo-desk-roadmap.md` when planning new features

**For Bug Fixes**:
1. Check `echo-desk-bugs.md` to see if already documented
2. Follow the bug template to report new issues
3. Reference FSM documentation to understand expected behavior
4. Update bug log when issue is fixed

**For New Features**:
1. Review roadmap to align with planned stages
2. Understand architecture constraints
3. Design FSM states if adding new flows
4. Add to roadmap with priority and timeline

**For Onboarding**:
1. Start with `echo-desk-architecture.md` (big picture)
2. Read `echo-desk-fsm.md` (understand call flow)
3. Review `echo-desk-bugs.md` (learn from past issues)
4. Check `echo-desk-roadmap.md` (understand future direction)

---

# END OF FILE

Claude must obey this document every session.
Do not modify this file without user approval.

---

