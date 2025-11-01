# EchoDesk

## Overview
EchoDesk is a production-grade voice receptionist dashboard designed for Australian healthcare clinics. Its core purpose is to streamline appointment management and enhance call handling through real-time monitoring, AI-powered intent detection, and deep integration with Cliniko. The application provides receptionists with tools for live call oversight, comprehensive call history review, patient identity management, and complete appointment lifecycle control (booking, rescheduling, cancellation). Key capabilities include automated SMS confirmations, call recording with transcription, and an intuitive dashboard interface built on Material Design 3 principles.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework:** React 18 with TypeScript and Vite.
- **Routing:** Lightweight client-side routing using Wouter.
- **UI:** shadcn/ui (Radix UI + Tailwind CSS) component library, adhering to Material Design 3 principles.
- **State Management:** TanStack Query for server state, caching, and real-time updates via WebSockets with automatic cache invalidation and exponential backoff for connection resilience. No global client state; relies on React Query's intelligent caching.
- **Styling:** Tailwind CSS with custom CSS variables for design tokens and HSL-based color system. Typography uses Inter and JetBrains Mono.

### Backend
- **Framework:** Express.js with TypeScript and Node.js.
- **API:** RESTful endpoints, specific Twilio webhook endpoints for voice. Includes request/response logging and Twilio signature validation.
- **Voice Processing:**
    - TwiML generation for Twilio, optimized to prevent common Twilio errors (e.g., no `<Start>` tag, specific `<Gather>` configurations, no `bargeIn`).
    - Amazon Polly (Olivia-Neural voice) for Australian English text-to-speech.
    - AI Intent Detection: GPT-4o-mini with confidence scoring and multi-turn context tracking. Fallback to regex-based matching. Supports intents like book, reschedule, cancel, human, hours.
    - Identity capture wizard for new callers.
    - Natural time formatting and slot integration for appointment booking, including intelligent fallback logic and robust option parsing.
    - Appointment persistence in the database for rescheduling lookup and status tracking.
- **Middleware:** Body parsing, request timing/logging, Twilio signature validation, error handling.
- **TwiML Hardening:** Strict adherence to Twilio best practices to prevent common errors (e.g., `language='en-AU'` on all `<Gather>` elements, integer-only pauses).

### Data Storage & Schema
- **Database:** PostgreSQL via Neon serverless driver.
- **ORM:** Drizzle ORM for type-safe queries.
- **Migrations:** Manual, idempotent, transactional migrations managed via environment variables and admin endpoints.
- **Core Tables:**
    - `tenants`: Multi-tenant clinic configurations.
    - `phoneMap`: Caller identity registry.
    - `leads`: Phone number tracking for opt-out.
    - `conversations`: Multi-turn interaction state with JSONB context for dialogue history.
    - `callLogs`: Comprehensive call history, metadata, intent, summary, recording/transcription URLs.
    - `alerts`: Real-time system notifications for reception staff.
- **Schema Design:** Serial primary keys, timestamps, JSONB for flexible data, foreign keys, text fields for Cliniko IDs.

### Real-time Communication
- **WebSockets:** Server on `/ws` path, client with exponential backoff reconnection.
- **Events:** `call:started`, `call:updated`, `call:ended`, `alert:created`, `alert:dismissed` for dashboard updates and cache invalidation.

## External Dependencies

- **Twilio:**
    - Voice API for call handling, TwiML generation, and call recording/transcription callbacks.
    - SMS API for automated appointment confirmations (booking, rescheduling, cancellation) with Australian date/time formatting.
    - Webhook security via signature validation.
- **Cliniko API:**
    - Full RESTful API integration for patient lookup, creation, practitioner availability, appointment type enumeration, and complete appointment lifecycle management (creation, rescheduling, cancellation).
    - Basic authentication with API key.
    - Australian region endpoint (`api.au4.cliniko.com`).
- **AWS Polly (via Twilio):**
    - Text-to-speech using Olivia-Neural voice for Australian English.
- **OpenAI (GPT-4o-mini):**
    - Optional, configurable via environment variables, for enhanced intent detection with confidence scoring, reasoning, and multi-turn context.
- **Google Fonts:**
    - Inter and JetBrains Mono for typography.
- **PostgreSQL (Neon):**
    - Database hosting and session storage via `connect-pg-simple`.