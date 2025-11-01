# EchoDesk

## Overview

EchoDesk is a production-grade voice receptionist dashboard designed for Australian healthcare clinics. Its primary purpose is to provide real-time monitoring of Twilio voice calls, manage caller alerts, and offer comprehensive appointment lifecycle management through integration with Cliniko. Key capabilities include full Cliniko integration for bookings, rescheduling, and cancellations, automated SMS confirmations, a WebSocket-powered real-time dashboard, AI-driven intent detection using GPT-4o-mini, a wizard for new patient identity capture, and call recording with automated transcription. The project aims to streamline clinic operations by providing an intuitive interface for receptionists to manage calls, patient identity, and appointment workflows.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend uses React 18 with TypeScript and Vite. Navigation is handled by Wouter, and components are built with shadcn/ui (Radix UI primitives + Tailwind CSS). State management, caching, and API synchronization are managed by TanStack Query, which also integrates WebSockets for real-time updates and automatic cache invalidation with exponential backoff for connection resilience. The UI adheres to Material Design 3 principles, using Tailwind CSS with custom HSL-based design tokens and specific typography (Inter and JetBrains Mono). Routing includes a dashboard, call history, individual call details, alert management, and multi-tenant configuration.

### Backend Architecture

The backend is built with Express.js and TypeScript on Node.js. It features RESTful APIs under `/api` and Twilio webhook endpoints under `/api/voice`. Voice call processing leverages TwiML generation, Amazon Polly for Australian English text-to-speech, and a robust intent detection system. This system primarily uses GPT-4o-mini with confidence scoring and multi-turn context, falling back to regex matching. It includes an identity capture wizard and sophisticated natural time formatting and slot integration for Cliniko appointments, handling local timezones, speakable time formats, and slot freezing to prevent race conditions. TwiML hardening measures eliminate common Twilio errors. Appointment persistence is managed in a local database to facilitate rescheduling and cancellation workflows, and SMS confirmations are automated for all appointment actions.

### Data Storage & Schema

PostgreSQL, accessed via Neon serverless driver and Drizzle ORM, serves as the database. Core tables include `tenants` for multi-clinic configurations, `phoneMap` for caller identity, `leads` for phone number tracking and opt-out management, `conversations` for multi-turn interaction state with JSONB context, `callLogs` for comprehensive call history, and `alerts` for real-time receptionist notifications. The schema emphasizes serial primary keys, timestamps, JSONB for flexible data, and foreign key relationships.

## External Dependencies

-   **Twilio:** Used for Voice API (inbound calls, TwiML generation, recording, transcription), SMS API (confirmations, notifications), and webhook handling with signature validation.
-   **Cliniko API:** Provides full RESTful integration for appointment lifecycle management, including availability, patient lookup/creation, appointment creation, rescheduling, and cancellation, targeting the Australian region endpoint.
-   **AWS Polly (via Twilio):** Utilized for Australian English text-to-speech with the Olivia-Neural voice.
-   **OpenAI:** GPT-4o-mini is optionally used for advanced intent detection, offering confidence scoring, multi-turn context, and structured JSON output. A regex-based fallback is in place.
-   **Google Fonts:** Inter and JetBrains Mono fonts are loaded via CDN for consistent typography.
-   **Neon:** Provides serverless PostgreSQL database hosting.
-   **connect-pg-simple:** Used for PostgreSQL-based session management.
-   **Vite:** Frontend build tool and development server.