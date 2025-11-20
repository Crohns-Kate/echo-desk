# Echo Desk Roadmap

## Overview

This roadmap outlines the development plan for Echo Desk from current state (basic appointment booking) to production-ready AI voice receptionist with advanced features.

**Current State** (as of November 2025):
- ✅ Core call flow FSM implemented
- ✅ New patient intake via SMS form
- ✅ Returning patient recognition by phone
- ✅ Cliniko appointment booking (standard + new patient types)
- ✅ Real-time dashboard with WebSockets
- ✅ Call recording and basic logging
- ✅ Alert system for errors
- ✅ SMS confirmations
- ⚠️ Transcription integration (AssemblyAI) - partially implemented
- ⚠️ Intent classification - basic regex fallback

**Target**: Production-ready multi-tenant AI voice receptionist platform

---

## Stage 1: Core Stability & Appointment Correctness
**Duration**: 2 weeks
**Focus**: Ensure booking flow is bulletproof and handles edge cases

### Week 1-2 Tasks

#### High Priority
- [ ] **Patient Identity Verification**
  - Improve disambiguation flow for multiple patients with same phone
  - Add voice confirmation: "Before I book, can you confirm your date of birth is {DOB from Cliniko}?"
  - Prevent the "Michael Bishopp" bug (booking for wrong patient)

- [ ] **Appointment Type Selection**
  - Validate `CLINIKO_NEW_PATIENT_APPT_TYPE_ID` and `CLINIKO_APPT_TYPE_ID` on startup
  - Add fallback if appointment type not found (use first available + log warning)
  - Add admin endpoint to list available appointment types per practitioner

- [ ] **Form Validation**
  - Add server-side email validation (currently only client-side)
  - Add phone number format validation (E.164)
  - Add name sanitization (prevent SQL injection, XSS in Cliniko notes)

- [ ] **Error Recovery Improvements**
  - Add "transfer to reception" actual transfer (not just hangup)
  - Configure `RECEPTION_PHONE_NUMBER` env var
  - Use Twilio `<Dial>` to forward calls on errors

- [ ] **Timeout Handling**
  - Add configurable timeouts for each Gather (currently hardcoded)
  - Add "Are you still there?" prompt after long silence
  - Improve form waiting experience (add periodic updates: "Still waiting for form...")

#### Medium Priority
- [ ] **Slot Selection UX**
  - Add "Can you find something earlier?" option after presenting slots
  - Add "Can you find something later?" option
  - Re-search with different date range if caller rejects all 3 options

- [ ] **Call Recording Reliability**
  - Fix recording status callback race condition (sometimes recording starts after call ends)
  - Add 2-second delay before starting recording (call must be "in-progress")
  - Add recording retry logic if first attempt fails

- [ ] **SMS Reliability**
  - Add SMS send retry (3 attempts with exponential backoff)
  - Add SMS delivery status tracking
  - Create alert if SMS fails after all retries

#### Low Priority
- [ ] **Voice Quality**
  - Test all 4 allowed voices (Matthew, Nicole-Neural, Olivia-Neural, Amy-Neural)
  - Add voice A/B testing framework
  - Add SSML emphasis and prosody for important information

- [ ] **Timezone Edge Cases**
  - Test DST transitions (Australia/Brisbane doesn't have DST, but future multi-timezone support)
  - Add midnight boundary handling (booking for "tomorrow" at 11:55pm)
  - Add timezone display in dashboard

---

## Stage 2: QA Engine & Knowledge Brain
**Duration**: 3 weeks
**Focus**: Conversation quality analysis and FAQ handling

### Week 3-5 Tasks

#### High Priority
- [ ] **Per-Call Quality Scoring**
  - Implement `server/services/communication-quality.ts` (currently stubbed)
  - Score dimensions:
    - **Correctness**: Was appointment booked correctly?
    - **Efficiency**: How many turns to completion?
    - **Clarity**: Did caller understand prompts?
    - **Sentiment**: Was caller satisfied?
    - **Error handling**: How well were errors recovered?
  - Store scores in `call_logs` table (add `quality_score` JSONB column)
  - Display quality scores in dashboard

- [ ] **Conversation Tagging**
  - Add automatic tagging based on call patterns:
    - `#new-patient`, `#returning`, `#booked`, `#error`, `#transferred`, `#abandoned`
    - `#confused` (multiple retries), `#frustrated` (detected via sentiment)
    - `#form-timeout`, `#cliniko-error`, `#no-availability`
  - Add tags to `call_logs` (add `tags` TEXT[] column)
  - Add tag filtering in dashboard

- [ ] **FAQ Knowledge Base**
  - Create `faqs` table:
    - `id`, `category`, `question`, `answer`, `keywords`, `embedding` (for semantic search)
  - Add FAQ seed data:
    - Hours of operation
    - Location/directions
    - Parking information
    - What to bring to appointment
    - Cancellation policy
    - Insurance/payment accepted
    - Types of treatments offered
  - Add FAQ admin UI (CRUD)

- [ ] **FAQ State Handler**
  - Add `FAQ_HANDLER` state to FSM
  - Detect FAQ intent in `GREETING`, `CHIEF_COMPLAINT`, `CLOSING`
  - Match keywords or use OpenAI embeddings for semantic search
  - Speak answer from knowledge base
  - Return to previous state after answering

#### Medium Priority
- [ ] **Transcription Integration**
  - Complete AssemblyAI real-time transcription
  - Store full transcript in `call_logs.transcript`
  - Add transcript search in dashboard
  - Add transcript export (CSV, PDF)

- [ ] **Intent Classification Enhancement**
  - Replace regex fallback with OpenAI function calling or fine-tuned model
  - Add intent confidence scoring
  - Add intent logging for training data collection
  - Intents to detect:
    - `book_appointment`, `reschedule`, `cancel`, `faq`, `speak_to_human`, `emergency`

- [ ] **Sentiment Analysis**
  - Add real-time sentiment tracking during call
  - Use OpenAI or Anthropic to analyze transcription chunks
  - Create alert if sentiment turns negative
  - Add sentiment graph to dashboard call detail view

#### Low Priority
- [ ] **Call Summary Generation**
  - Use LLM to generate human-readable call summary
  - Include: caller name, intent, outcome, next steps
  - Store in `call_logs.summary`
  - Display in dashboard

- [ ] **Coaching Recommendations**
  - Analyze low-quality calls
  - Generate improvement suggestions for prompt wording
  - Track prompt version performance
  - A/B test prompt variations

---

## Stage 3: Multi-Clinic & Advanced Dashboard
**Duration**: 3 weeks
**Focus**: Multi-tenant support, improved admin experience

### Week 6-8 Tasks

#### High Priority
- [ ] **Multi-Tenant Phone Routing**
  - Add phone number → tenant mapping in `phone_map` table
  - Use `To` number (Twilio `Called`) to determine tenant
  - Load tenant-specific greeting, timezone, Cliniko credentials
  - Add tenant context to all DB queries

- [ ] **Tenant Management UI**
  - Add `/admin/tenants` page (protected by auth)
  - CRUD for tenants (clinic name, slug, greeting, timezone)
  - Add Cliniko credential management (encrypted storage)
  - Add tenant-specific phone number assignment

- [ ] **Tenant-Specific Voice Flows**
  - Add `voice_flow_overrides` JSONB column to `tenants` table
  - Allow per-tenant customization:
    - Greeting message
    - TTS voice
    - Practitioner ID
    - Appointment type IDs
    - Business hours
  - Fallback to defaults if not overridden

- [ ] **Dashboard Filtering & Search**
  - Add tenant filter (if multi-tenant)
  - Add date range filter
  - Add call status filter (completed, in-progress, error)
  - Add caller phone search
  - Add full-text transcript search
  - Add tag filter

#### Medium Priority
- [ ] **Advanced Analytics**
  - Add metrics page with charts:
    - Calls per day/week/month
    - Booking conversion rate (calls → appointments)
    - Average call duration
    - Most common FAQ topics
    - Error rate by category
    - Sentiment trend over time
  - Use Recharts for visualization
  - Add export to CSV

- [ ] **Call Detail Page**
  - Full call timeline (state transitions with timestamps)
  - Full transcript with speaker labels
  - Recording playback with waveform
  - Quality score breakdown
  - Session context dump (for debugging)
  - Related alerts
  - Booking details (link to Cliniko)

- [ ] **Alert Management**
  - Add alert priority (low, medium, high, critical)
  - Add alert assignment (assign to team member)
  - Add alert notes/comments
  - Add alert resolution tracking
  - Add email notifications for critical alerts

- [ ] **Bulk Actions**
  - Bulk dismiss alerts
  - Bulk export calls (CSV, JSON)
  - Bulk tag calls
  - Bulk delete old calls (GDPR compliance)

#### Low Priority
- [ ] **Team Management**
  - Add `users` table (admin, manager, receptionist roles)
  - Add authentication (Passport.js or next-auth)
  - Add role-based access control
  - Add activity log (who did what)

- [ ] **Custom Branding**
  - Per-tenant logo upload
  - Custom color scheme
  - Custom domain (white-label)
  - Custom email/SMS sender name

---

## Stage 4: Advanced Features & AI Enhancement
**Duration**: 2 weeks
**Focus**: Barge-in, conversational AI, advanced routing

### Week 9-10 Tasks

#### High Priority
- [ ] **Barge-In Support**
  - Enable Twilio `<Gather>` `actionOnEmptyResult=true` and `input=['speech', 'dtmf']` on all prompts
  - Allow caller to interrupt long prompts (e.g., "Press 1 for yes" → caller says "yes" before prompt finishes)
  - Test with real callers to optimize timing

- [ ] **Conversational AI Layer**
  - Integrate Claude or GPT-4 for free-form conversation
  - Use LLM to:
    - Understand ambiguous responses
    - Generate dynamic prompts
    - Handle unexpected questions
    - Rephrase based on caller confusion
  - Add LLM prompt templates in `server/services/ai/prompts.ts`
  - Add LLM response caching (Redis or in-memory)

- [ ] **Reschedule Flow**
  - Add `RESCHEDULE_SEARCH` state
  - Detect "I need to reschedule" in greeting or FAQ
  - Look up existing appointment by phone
  - Present current appointment details
  - Offer new time slots (same logic as booking)
  - Use `rescheduleAppointment()` Cliniko service
  - Send updated SMS confirmation

- [ ] **Cancel Flow**
  - Add `CANCEL_CONFIRM` state
  - Detect "I need to cancel" in greeting or FAQ
  - Look up existing appointment by phone
  - Confirm cancellation with caller
  - Use `cancelAppointment()` Cliniko service
  - Send cancellation confirmation SMS
  - Offer to rebook for different time

#### Medium Priority
- [ ] **Emergency Detection**
  - Add keyword detection for medical emergencies
  - Keywords: "emergency", "ambulance", "can't breathe", "chest pain", "severe bleeding"
  - Immediately transfer to emergency number or advise to call 000
  - Create critical alert
  - Log emergency call metadata

- [ ] **Business Hours Enforcement**
  - Add `business_hours` JSONB to `tenants` table
  - Format: `{ "monday": [["09:00", "17:00"]], "tuesday": [...], ... }`
  - Play after-hours message if outside business hours
  - Offer voicemail or SMS callback request
  - Disable appointment booking outside hours (or allow booking for next business day)

- [ ] **Voicemail & Callback**
  - Add `<Record>` for voicemail messages
  - Store voicemail URL in `call_logs.voicemail_url`
  - Create alert for voicemail received
  - Add callback request form (caller leaves number + preferred time)
  - Add admin UI to manage callbacks

- [ ] **SMS Two-Way Conversation**
  - Add SMS webhook handler
  - Detect inbound SMS reply to appointment confirmation
  - Parse "CANCEL", "RESCHEDULE", "CONFIRM"
  - Trigger appropriate flow
  - Reply with confirmation or further instructions

#### Low Priority
- [ ] **Call Transfer to Specific Person**
  - Add "speak to Dr. Michael" detection
  - Add "speak to receptionist Sarah" detection
  - Lookup practitioner/staff phone in Cliniko or custom table
  - Use `<Dial>` to transfer
  - Log transfer in call_logs

- [ ] **Waiting Room Integration**
  - Add "I'm running late" detection
  - Update appointment notes in Cliniko
  - Notify clinic staff via dashboard alert
  - Offer to reschedule if >30 minutes late

- [ ] **Appointment Reminders (Outbound)**
  - Add cron job to find appointments in next 24 hours
  - Send SMS reminder with confirm/cancel links
  - Add voice call reminder option (use Twilio Programmable Voice)
  - Track reminder delivery and responses

---

## Stage 5: Production Hardening & Scale
**Duration**: 1 week
**Focus**: Performance, reliability, security, compliance

### Week 11 Tasks

#### High Priority
- [ ] **Load Testing**
  - Simulate 100 concurrent calls
  - Test database connection pooling
  - Test WebSocket scalability
  - Identify bottlenecks
  - Optimize slow queries

- [ ] **Rate Limiting**
  - Add rate limiting middleware (express-rate-limit)
  - Limit webhook endpoints (prevent abuse)
  - Limit API endpoints (dashboard)
  - Add tenant-specific rate limits

- [ ] **Security Audit**
  - Review all SQL queries for injection risks
  - Review all user input sanitization
  - Review Twilio signature validation
  - Review recording/transcript access control
  - Add CSP headers
  - Add CORS configuration
  - Add helmet.js middleware

- [ ] **Error Monitoring**
  - Integrate Sentry or similar (error tracking)
  - Add custom error reporting for critical paths
  - Add uptime monitoring (UptimeRobot, Pingdom)
  - Add Twilio webhook failure notifications

- [ ] **Logging & Observability**
  - Add structured logging (winston, pino)
  - Add log levels (debug, info, warn, error)
  - Add request ID tracing
  - Add performance metrics (response times)
  - Add database query logging (slow query log)

#### Medium Priority
- [ ] **GDPR Compliance**
  - Add data retention policy (auto-delete recordings after X days)
  - Add "right to be forgotten" endpoint
  - Add consent tracking for recording
  - Add data export endpoint (all data for a phone number)
  - Add privacy policy link in SMS/forms

- [ ] **Backup & Disaster Recovery**
  - Set up automated database backups (daily)
  - Test restore procedure
  - Document disaster recovery plan
  - Set up staging environment (mirror production)

- [ ] **Deployment Automation**
  - Set up CI/CD (GitHub Actions)
  - Add automated tests (unit + integration)
  - Add database migration automation
  - Add zero-downtime deployment (blue-green)
  - Add rollback procedure

#### Low Priority
- [ ] **Documentation**
  - Write user manual (for clinic staff)
  - Write admin manual (for clinic owners)
  - Write developer guide (for future contributors)
  - Create video tutorials
  - Create FAQ for common issues

- [ ] **Cost Optimization**
  - Analyze Twilio usage and costs
  - Optimize Cliniko API call frequency (caching)
  - Optimize database queries (indexing)
  - Optimize OpenAI/Anthropic API calls (caching, smaller models)
  - Set up cost alerts

---

## Stage 6: Launch & Iteration
**Duration**: Ongoing
**Focus**: Real-world testing, feedback, iteration

### Post-Launch Tasks

#### Immediate (Week 12)
- [ ] **Pilot Deployment**
  - Deploy to 1-3 pilot clinics
  - Monitor closely for first 2 weeks
  - Daily check-ins with clinic staff
  - Rapid bug fixes

- [ ] **Feedback Collection**
  - Add in-call feedback prompt: "How did I do? Press 1 for great, 2 for okay, 3 for poor."
  - Add post-call SMS survey link
  - Add clinic staff feedback form
  - Weekly review of feedback and metrics

- [ ] **Iteration Based on Feedback**
  - Prioritize top 3 pain points
  - Fix critical bugs within 24 hours
  - Ship improvements weekly
  - A/B test prompt changes

#### Ongoing (Month 2+)
- [ ] **Marketing & Growth**
  - Create sales demo environment
  - Create marketing website
  - Create case studies from pilot clinics
  - Attend industry conferences
  - Build partnerships (Cliniko, other practice management systems)

- [ ] **Feature Requests**
  - Maintain public roadmap
  - Accept feature requests from customers
  - Prioritize based on impact and effort
  - Ship major features monthly

- [ ] **Integrations**
  - Add support for other practice management systems:
    - Cliniko (done)
    - Jane App
    - SimplePractice
    - Acuity Scheduling
    - Calendly
  - Add support for other voice providers:
    - Twilio (done)
    - Telnyx
    - Vonage
  - Add support for other LLM providers:
    - OpenAI GPT-4
    - Anthropic Claude
    - Google Gemini
    - Local models (Llama, Mistral)

- [ ] **Enterprise Features**
  - SSO (SAML, OAuth)
  - Advanced reporting & BI integrations
  - Custom SLAs
  - Dedicated support
  - On-premise deployment option

---

## Success Metrics

### Stage 1: Core Stability
- 🎯 **95% booking accuracy** (correct patient, correct time)
- 🎯 **<5% error rate** (calls ending in ERROR_RECOVERY)
- 🎯 **<2% abandoned calls** (caller hangs up mid-flow)

### Stage 2: QA Engine
- 🎯 **80% high-quality calls** (quality score >0.8)
- 🎯 **FAQ resolution rate >70%** (FAQ answered without human)
- 🎯 **Positive sentiment >85%** (based on transcription analysis)

### Stage 3: Multi-Clinic
- 🎯 **10 active tenants** (paying clinics)
- 🎯 **Dashboard engagement >50%** (clinic staff check dashboard daily)
- 🎯 **Alert resolution time <1 hour** (average)

### Stage 4: Advanced Features
- 🎯 **Reschedule/cancel success rate >90%** (self-service)
- 🎯 **Barge-in usage >30%** (callers interrupt prompts)
- 🎯 **LLM conversation quality >4/5** (manual review)

### Stage 5: Production
- 🎯 **99.9% uptime** (3 nines SLA)
- 🎯 **<500ms p95 response time** (webhook responses)
- 🎯 **Zero security incidents**
- 🎯 **GDPR compliance audit passed**

### Stage 6: Growth
- 🎯 **50+ active tenants** (end of year 1)
- 🎯 **10,000+ calls/month** (across all tenants)
- 🎯 **Net Promoter Score (NPS) >50**
- 🎯 **Customer retention >95%** (annual churn <5%)

---

## Technical Debt & Refactoring

### Known Issues to Address
1. **Long `voice.ts` file** - Split into smaller modules (700+ lines)
2. **Hardcoded values** - Move to env vars or database config
3. **Inconsistent error handling** - Standardize error response format
4. **Missing unit tests** - Add test coverage (target 80%)
5. **No integration tests** - Add end-to-end call flow tests
6. **Missing API documentation** - Generate OpenAPI spec
7. **Inconsistent logging** - Standardize log format and levels
8. **No database indexes** - Add indexes for common queries
9. **No caching layer** - Add Redis for Cliniko API responses
10. **WebSocket reconnection** - Improve client-side reconnection logic

### Refactoring Priorities (Ongoing)
- Extract reusable TwiML generation helpers
- Extract Cliniko service to separate package (for reuse in other projects)
- Extract FSM engine to generic library (not Twilio-specific)
- Extract voice constant sanitization to separate utility
- Consolidate timezone handling (too many places using dayjs directly)
- Replace `any` types with proper TypeScript types
- Add JSDoc comments to all public functions
- Add type guards for runtime validation

---

## Notes

- This roadmap is flexible and will be adjusted based on:
  - Customer feedback from pilot deployments
  - Technical challenges discovered during implementation
  - Market demands and competitor features
  - Resource availability and team capacity

- Each stage should include:
  - Code review before merging to main
  - Manual testing of critical paths
  - Update to documentation
  - Database migration if schema changes
  - Deploy to staging before production

- Risk mitigation:
  - Always maintain backward compatibility
  - Never break existing Cliniko integration
  - Always provide graceful degradation for new features
  - Monitor error rates closely after each deployment
  - Have rollback plan for every deployment
