# Documentation Audit Report - December 2024

## Executive Summary

This audit identified **significant conflicts** between instruction/memory files and the actual codebase, which likely contributed to call flow regressions. The primary issues were:

1. **FSM documentation was completely outdated** (system uses OpenAI mode)
2. **claude.md lacked critical implementation details** (intent locking, stages, loop prevention)
3. **Multiple PR-related docs contained stale information** about file paths and behavior

## Files Audited

### Agent Instruction Files (Direct AI Influence)

| File | Status | Impact |
|------|--------|--------|
| `/claude.md` | **UPDATED** | Primary Claude instruction file - was missing intent locking, BookingStage, loop prevention |
| `/replit.md` | Accurate | System architecture doc - correctly describes OpenAI mode |

### Technical Documentation

| File | Status | Impact |
|------|--------|--------|
| `/docs/CALLFLOW-SPEC.md` | **NEW** | Canonical source of truth for call flow |
| `/docs/echo-desk-fsm.md` | **DEPRECATED** | Completely outdated - described old FSM approach |
| `/docs/openai-conversation-mode.md` | **UPDATED** | Added reference to canonical spec |
| `/SHARED_PHONE_IMPLEMENTATION.md` | Accurate | Correctly describes shared phone handling |
| `/RESCHEDULE_CANCEL_DOCUMENTATION.md` | Partially accurate | Missing TwiML safety, dead-end handling |

### Historical/PR Documentation (Low Priority)

| File | Status | Notes |
|------|--------|-------|
| `/CALL_FLOW_IMPROVEMENTS.md` | Historical | Keep for reference |
| `/CALL_FLOW_FIXES_ROUND2.md` | Historical | Keep for reference |
| `/CONVERSATION_IMPROVEMENTS.md` | Historical | Keep for reference |
| `/pr-*.md` files | Historical | PR descriptions, keep as-is |

## Conflicts Identified

### 1. claude.md vs Actual Code

**claude.md said:**
- "How can I help you today?" is the hub
- Use NLU classifier to detect intent
- Three modes: Booking, FAQ, Reception Handover
- No mention of state machine stages

**Code reality:**
- Uses OpenAI receptionistBrain.ts with structured state
- Has `BookingStage` enum for linear progression
- Has `intentLocked` flag to prevent mid-call resets
- Has `sharedPhoneResolved` and `identityResolved` guards
- Has loop prevention (max 2 asks per question)

**Resolution:** Updated claude.md to reference canonical spec and list actual features.

### 2. docs/echo-desk-fsm.md vs Code

**Document said:**
- FSM-based approach using callFlowHandler.ts
- State machine with GREETING → PATIENT_TYPE_DETECT → etc.

**Code reality:**
- FSM is legacy code, not actively used
- Primary handler is openai-call-handler.ts
- Uses OpenAI conversation mode

**Resolution:** Marked as DEPRECATED with pointer to CALLFLOW-SPEC.md.

### 3. RESCHEDULE_CANCEL_DOCUMENTATION.md vs Code

**Document said:**
- "ALREADY FULLY IMPLEMENTED!"
- References specific line numbers in voice.ts

**Code reality:**
- Reschedule was hanging after "Let me find your appointment"
- TwiML safety nets were missing
- Line numbers were incorrect

**Resolution:** Code fixed in previous commits; doc kept for context.

## Root Cause Analysis

### Why the Flow Got Worse

1. **Conflicting instructions**: claude.md described one approach, code implemented another
2. **Missing critical guards**: Loop prevention, intent locking existed in code but weren't documented
3. **AI anchoring on outdated docs**: Claude may have followed FSM docs when making changes
4. **No single source of truth**: Multiple overlapping docs with different information

### Contributing Factors

- `echo-desk-fsm.md` still existed and described FSM approach
- `claude.md` didn't mention BookingStage, intentLocked, or loop prevention
- No clear indication of which docs were current vs deprecated

## Recommendations Implemented

1. **Created canonical spec** (`/docs/CALLFLOW-SPEC.md`) as single source of truth
2. **Updated claude.md** to reference canonical spec and list actual features
3. **Deprecated echo-desk-fsm.md** with clear warning
4. **Added cross-references** in openai-conversation-mode.md

## Files Changed in This Audit

| File | Change |
|------|--------|
| `/docs/CALLFLOW-SPEC.md` | Created - canonical specification |
| `/docs/AUDIT-REPORT-DEC2024.md` | Created - this report |
| `/claude.md` | Updated - added spec reference, implementation details |
| `/docs/echo-desk-fsm.md` | Updated - added deprecation notice |
| `/docs/openai-conversation-mode.md` | Updated - added spec reference |

## Ongoing Maintenance

To prevent future regressions:

1. **Update CALLFLOW-SPEC.md** when making call flow changes
2. **Do not add new flow documentation** without updating spec
3. **Archive old PR docs** rather than updating them
4. **Claude should always check** CALLFLOW-SPEC.md before modifying call flow code
