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

# END OF FILE

Claude must obey this document every session.
Do not modify this file without user approval.

---

