# EchoDesk

## Overview

EchoDesk is a production-grade voice receptionist dashboard for Australian healthcare clinics. It provides real-time monitoring of Twilio voice calls, manages caller alerts, and integrates with Cliniko for appointment scheduling. The application enables clinic receptionists to track active calls, review call history, manage patient identity capture, and handle appointment booking/rescheduling/cancellation workflows through an intuitive Material Design 3-inspired interface.

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
- TwiML generation for Twilio voice responses
- Amazon Polly (Nicole-Neural voice) for text-to-speech in Australian English
- Intent detection system (regex-based fallback, OpenAI optional)
- Multi-turn conversation state tracking with context preservation
- Identity capture wizard for unknown callers
- Appointment booking workflow integration with Cliniko

**Middleware Layers:**
1. Body parsing (JSON with raw body buffer for webhooks)
2. Request timing and logging
3. Twilio signature validation (optional in development)
4. Error handling and response formatting

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
   - Links to tenant and lead
   - Voice/SMS flag
   - JSON context for conversation flow state
   - State machine tracking (active/completed/abandoned)

5. **callLogs** - Comprehensive call history
   - Twilio call metadata (CallSid, From, To, duration)
   - Intent classification and summary
   - Appointment booking outcomes
   - Recording and transcription URLs
   - Status tracking (queued/ringing/in-progress/completed)

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
- Voice API for inbound call handling
- TwiML generation for call flow control
- Webhook endpoints for call events (incoming, recording, transcription)
- Signature validation for webhook security
- Call recording with transcription support

**Cliniko API:**
- RESTful API integration for appointment management
- Basic authentication with API key
- Endpoints for:
  - Availability queries
  - Appointment creation
  - Patient lookup
- Australian region endpoint (api.au4.cliniko.com)

**AWS Polly (via Twilio):**
- Nicole-Neural voice for Australian English TTS
- SSML support for pronunciation control
- Integrated through Twilio's `<Say>` verb with voice parameter

**OpenAI (Optional):**
- GPT-4o-mini for advanced intent detection
- Fallback to regex-based intent matching if not configured
- Environment flag to enable/disable

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
- Required: Twilio credentials, database URL, Cliniko API key, public base URL
- Optional: OpenAI API key, feature flags for recording/transcription/intent engine
- Timezone configuration (default: Australia/Brisbane)