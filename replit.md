# EchoDesk

## Overview

EchoDesk is a production-grade voice receptionist dashboard for Australian healthcare clinics. It provides real-time monitoring of Twilio voice calls, manages caller alerts, and integrates with Cliniko for complete appointment lifecycle management. The application features:

- **Full Cliniko Integration**: Live appointment booking, rescheduling, and cancellation with real patient lookup
- **SMS Confirmations**: Automated appointment confirmations sent via Twilio SMS with Australian date formatting
- **Real-time Updates**: WebSocket-powered dashboard with automatic call/alert updates and connection resilience
- **AI Intent Detection**: GPT-4o-mini powered conversation understanding with multi-turn context and confidence scoring
- **Identity Capture**: Wizard-based patient information collection for first-time callers
- **Call Recording**: Twilio recording with automated transcription for quality assurance

The application enables clinic receptionists to monitor active calls, review comprehensive call history, manage patient identity, and oversee the complete appointment workflow through an intuitive Material Design 3-inspired interface.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System:**
- React 18 with TypeScript using Vite as the build tool and development server
- Client-side routing implemented with Wouter for lightweight navigation
- Component library based on shadcn/ui (Radix UI primitives with Tailwind CSS)

**State Management:**
- TanStack Query (React Query) for server state management, caching, and API synchronization
- WebSocket integration for real-time updates with automatic cache invalidation
- Exponential backoff reconnection (1s → 30s) for connection resilience
- No global client state - relies on React Query's intelligent caching and refetching strategies

**UI Design System:**
- Material Design 3 principles adapted for healthcare operations
- Tailwind CSS with custom design tokens defined in CSS variables
- Typography: Inter (primary), JetBrains Mono (monospace for IDs/timestamps)
- Color system using HSL with CSS custom properties for theme flexibility
- Component variants using class-variance-authority for consistent styling patterns

**Routing Structure:**
- `/` - Dashboard with real-time metrics and recent activity
- `/calls` - Complete call history with search functionality
- `/calls/:id` - Individual call detail view
- `/alerts` - Alert management interface
- `/tenants` - Multi-tenant clinic configuration

### Backend Architecture

**Server Framework:**
- Express.js with TypeScript running on Node.js
- Custom Vite integration for HMR in development
- ES modules throughout the codebase

**API Design:**
- RESTful endpoints under `/api` namespace
- Twilio webhook endpoints under `/api/voice` for voice call handling
- Request/response logging middleware for debugging
- Raw body preservation for Twilio signature validation

**Voice Call Processing:**
- TwiML generation for Twilio voice responses (NO `<Start>` tag - eliminates error 13520)
- Amazon Polly for text-to-speech in Australian English
- **Voice Constants & Safety** (`server/utils/voice-constants.ts`):
  - `VOICE_NAME` - Configurable via env (default: "Polly.Olivia-Neural")
  - `ttsClean()` - Extremely conservative text sanitizer:
    - Strips SSML tags, non-ASCII characters, fancy quotes
    - Removes punctuation that trips Polly (?,!,:;())
    - Collapses whitespace, ensures plain text only
  - `say(node, text)` - Multi-level voice fallback system:
    - Primary: VOICE_NAME (env-configurable)
    - Fallback: alice (Twilio default)
    - Auto-skips empty strings
    - NO bargeIn parameter (eliminated for 12200 warning prevention)
  - `pause(node, secs)` - Integer-only pause helper:
    - Enforces integer values for Twilio compliance
    - Default: 1 second
    - Coerces non-integers to 1
- Enhanced intent detection system:
  - Primary: GPT-4o-mini with confidence scoring (0.0-1.0)
  - Fallback: Regex-based pattern matching
  - Multi-turn conversation context tracking
  - Full dialogue history for intent refinement
  - Supports: book, reschedule, cancel, human, hours intents
- Identity capture wizard for first-time callers
- Complete appointment lifecycle management:
  - New booking with Cliniko availability lookup
  - Rescheduling with appointment retrieval
  - Cancellation with confirmation
  - SMS confirmations for all operations

**Middleware Layers:**
1. Body parsing (JSON with raw body buffer for webhooks)
2. Request timing and logging
3. Twilio signature validation (optional in development)
4. Error handling and response formatting

**TwiML Hardening (Eliminates Twilio 12200 warnings):**
- NO `language` attributes on `<Say>` or `<Gather>` elements
- NO `bargeIn` attributes on `<Say>` or `<Gather>` elements
- All pauses use integer values only via `pause()` helper
- Standard Gather pattern: `vr.gather({ input: ['speech'], timeout: 5, speechTimeout: 'auto', actionOnEmptyResult: true, ... })`
- Every Gather followed by: `say(g, text); pause(g, 1);` pattern
- Test endpoint: `/api/voice/ping` for TwiML validation

### Data Storage & Schema

**Database:**
- PostgreSQL via Neon serverless driver
- Drizzle ORM for type-safe database queries and schema management
- WebSocket connection pooling for serverless compatibility

**Core Tables:**

1. **tenants** - Multi-tenant clinic configurations
   - Stores clinic name, greeting messages, timezone settings
   - Slug-based tenant identification

2. **phoneMap** - Caller identity registry
   - Maps phone numbers to patient information
   - Stores full name, email, Cliniko patient ID
   - Updated through identity capture wizard

3. **leads** - Phone number tracking
   - Opt-out management for SMS/marketing
   - Tracks opt-out dates

4. **conversations** - Multi-turn interaction state
   - Links to tenant and lead via foreign keys
   - Voice/SMS flag for channel tracking
   - JSONB context storing full dialogue history:
     - Array of user/assistant turns with content
     - Previous intent and confidence for refinement
     - Supports GPT-4o-mini multi-turn understanding
   - State machine tracking (active/completed/abandoned)
   - Linked to calls via conversationId

5. **callLogs** - Comprehensive call history
   - Twilio call metadata (CallSid, From, To, duration)
   - Intent classification with confidence percentage
   - Detailed call summary with outcomes
   - Appointment booking/rescheduling/cancellation results
   - Recording and transcription URLs
   - Status tracking (queued/ringing/in-progress/completed)
   - Linked to conversation for context retrieval

6. **alerts** - Real-time notifications
   - System alerts for reception staff
   - Categorized by reason (unknown_caller, booking_failed, etc.)
   - Status tracking (open/dismissed)
   - Linked to calls and tenants

**Schema Design Principles:**
- Serial primary keys for all tables
- Timestamp tracking (createdAt, updatedAt where applicable)
- JSONB for flexible context storage
- Foreign key relationships for data integrity
- Text fields for Cliniko IDs (API returns strings)

### External Dependencies

**Twilio Integration:**
- Voice API for inbound call handling with TwiML generation
- SMS API for appointment confirmations and notifications
- Webhook endpoints for call lifecycle:
  - Incoming call handler with greeting
  - Recording callback with URL storage
  - Transcription callback with text extraction
- Signature validation for webhook security (development bypass available)
- Call recording with automated transcription
- SMS confirmation system:
  - Appointment booking confirmations
  - Rescheduling notifications
  - Cancellation notices
  - Australian date/time formatting

**Cliniko API:**
- Full RESTful API integration for complete appointment lifecycle
- Basic authentication with API key
- Comprehensive endpoints:
  - Real-time practitioner availability queries
  - Appointment type enumeration
  - Patient lookup by phone number
  - Patient creation for new callers
  - Appointment creation with auto-conflict detection
  - Appointment rescheduling
  - Appointment cancellation
- Australian region endpoint (api.au4.cliniko.com)
- Security: Redacted request body logging to prevent PII leakage

**AWS Polly (via Twilio):**
- Nicole-Neural voice for Australian English TTS
- SSML support for pronunciation control
- Integrated through Twilio's `<Say>` verb with voice parameter

**OpenAI (Optional):**
- GPT-4o-mini for enhanced intent detection with:
  - JSON structured output format
  - Confidence scoring (0.0 to 1.0)
  - Reasoning explanation for transparency
  - Multi-turn context awareness
  - Full conversation history analysis
- Graceful fallback to regex-based intent matching on errors or when disabled
- Temperature 0.3 for consistent classifications
- Environment flag (USE_OPENAI_INTENT) to enable/disable

**Google Fonts:**
- Inter font family (300-700 weights)
- JetBrains Mono (400-500 weights)
- Loaded via CDN for consistent typography

**Development Tools:**
- Replit-specific plugins for runtime error overlay and dev banner
- Cartographer for code mapping (Replit environment only)

**Session Management:**
- connect-pg-simple for PostgreSQL session storage
- Session data persisted across server restarts

**Environment Configuration:**
- All secrets managed through environment variables
- Required:
  - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
  - DATABASE_URL, PG* credentials
  - CLINIKO_API_KEY
  - PUBLIC_BASE_URL (for webhook callbacks)
  - SESSION_SECRET
- Optional:
  - OPENAI_API_KEY (for GPT-4o-mini intent detection)
  - USE_OPENAI_INTENT (boolean flag, defaults to false)
  - CALL_RECORDING_ENABLED (boolean, defaults to false)
  - TRANSCRIPTION_ENABLED (boolean, defaults to false)
  - IDENTITY_CAPTURE (boolean, defaults to true)
- Timezone configuration (default: Australia/Brisbane)

**WebSocket Real-time Updates:**
- Server: WebSocket server on `/ws` path
- Client: Automatic reconnection with exponential backoff (1s → 2s → 4s → ... → 30s max)
- Events:
  - call:started - New call logged
  - call:updated - Call metadata/intent/summary updated
  - call:ended - Call completed
  - alert:created - New alert for receptionist
  - alert:dismissed - Alert resolved
- Cache invalidation:
  - /api/calls and /api/calls/recent
  - /api/alerts and /api/alerts/recent
  - /api/stats
- Connection resilience with automatic recovery