/**
 * State Machine - Resilient conversation state management
 *
 * This module implements the "Sticky State Machine" pattern:
 * - Intent locking (can't exit reschedule until slot reserved or SMS sent)
 * - Universal Recovery hierarchy (never say goodbye when stuck)
 * - Atomic Identity Scrubbing (hard reset on denial)
 * - Safety Valve (2-turn stuck detection with SMS handoff)
 */

import type { CompactCallState, ConversationContext } from '../ai/receptionistBrain';

// ═══════════════════════════════════════════════
// State Machine Types
// ═══════════════════════════════════════════════

/**
 * Conversation states for the state machine
 */
export type ConversationState =
  | 'INITIAL'           // Call just started
  | 'VERIFYING'         // Asking "Am I speaking with X?"
  | 'MANUAL_SEARCH'     // User denied identity, collecting name
  | 'SEARCHING'         // Looking up patient by name
  | 'OFFERING_SLOTS'    // Presenting available times
  | 'SLOT_SELECTED'     // User picked a slot
  | 'SOFT_BOOKING'      // Skip identity, offer slots immediately
  | 'SENDING_SMS'       // Sending confirmation link
  | 'COMPLETED'         // Call objective achieved
  | 'SAFETY_VALVE'      // Stuck state - force SMS handoff
  | 'GOODBYE';          // Call ending

/**
 * State machine context for tracking state history
 */
export interface StateMachineContext {
  /** Current state */
  currentState: ConversationState;

  /** Previous state (for detecting loops) */
  previousState: ConversationState | null;

  /** How many turns we've been in the current state */
  turnsInCurrentState: number;

  /** Locked intent that MUST be completed */
  lockedIntent: 'book' | 'reschedule' | 'cancel' | null;

  /** Whether identity has been atomically scrubbed */
  identityScrubbed: boolean;

  /** Recovery level we're operating at (1-4) */
  recoveryLevel: 1 | 2 | 3 | 4;

  /** Last utterance for debugging */
  lastUtterance: string;

  /** Timestamp of last state change */
  lastStateChangeAt: number;
}

/**
 * Initialize state machine context
 */
export function initStateMachine(): StateMachineContext {
  return {
    currentState: 'INITIAL',
    previousState: null,
    turnsInCurrentState: 0,
    lockedIntent: null,
    identityScrubbed: false,
    recoveryLevel: 1,
    lastUtterance: '',
    lastStateChangeAt: Date.now()
  };
}

// ═══════════════════════════════════════════════
// Denial Detection
// ═══════════════════════════════════════════════

/**
 * Check if utterance indicates denial of identity
 */
export function isDenial(utterance: string): boolean {
  const lower = utterance.toLowerCase().trim();

  // Simple "no" responses
  if (/^no[,.]?\s*$/i.test(lower)) return true;
  if (/^nope\b/i.test(lower)) return true;
  if (/^nah\b/i.test(lower)) return true;

  // Explicit denials
  if (/^not\s+(me|him|her)\b/i.test(lower)) return true;
  if (/that'?s\s+not\s+me/i.test(lower)) return true;
  if (/i'?m\s+not\s+\w+/i.test(lower)) return true;
  if (/wrong\s+(person|name|number)/i.test(lower)) return true;
  if (/someone\s+else/i.test(lower)) return true;
  if (/different\s+person/i.test(lower)) return true;

  // Corrective denials (with new name)
  if (/^no[,.]?\s*(i'?m|this\s+is|my\s+name\s+is|it'?s)\s+/i.test(lower)) return true;
  if (/^actually[,.]?\s*(i'?m|this\s+is|my\s+name\s+is)\s+/i.test(lower)) return true;

  return false;
}

/**
 * Check if utterance indicates confirmation
 */
export function isConfirmation(utterance: string): boolean {
  const lower = utterance.toLowerCase().trim();

  if (/^yes\b/i.test(lower)) return true;
  if (/^yeah\b/i.test(lower)) return true;
  if (/^yep\b/i.test(lower)) return true;
  if (/^yup\b/i.test(lower)) return true;
  if (/^correct\b/i.test(lower)) return true;
  if (/^that'?s\s+(me|right|correct)/i.test(lower)) return true;
  if (/^speaking\b/i.test(lower)) return true;
  if (/^this\s+is\s+\w+/i.test(lower)) return true; // "This is John"
  if (/^uh\s*huh\b/i.test(lower)) return true;
  if (/^mm\s*hmm\b/i.test(lower)) return true;

  return false;
}

/**
 * Check if utterance looks like a name (for manual search)
 */
export function looksLikeName(utterance: string): boolean {
  const cleaned = utterance.trim();

  // Skip obvious non-names
  const skipWords = ['yes', 'no', 'yeah', 'yep', 'nope', 'ok', 'okay', 'um', 'uh', 'hmm', 'well'];
  if (skipWords.includes(cleaned.toLowerCase())) return false;

  // Too short to be a name
  if (cleaned.length < 3) return false;

  // Too long to be a name
  if (cleaned.length > 50) return false;

  // Contains letters and possibly spaces/periods (name-like)
  if (/^[A-Za-z][A-Za-z.\s'-]+[A-Za-z]?\.?$/.test(cleaned)) return true;

  return false;
}

// ═══════════════════════════════════════════════
// State Transitions
// ═══════════════════════════════════════════════

/**
 * Transition to a new state
 */
export function transitionTo(
  sm: StateMachineContext,
  newState: ConversationState,
  reason?: string
): StateMachineContext {
  console.log(`[StateMachine] 🔄 TRANSITION: ${sm.currentState} → ${newState}${reason ? ` (${reason})` : ''}`);

  return {
    ...sm,
    previousState: sm.currentState,
    currentState: newState,
    turnsInCurrentState: 0,
    lastStateChangeAt: Date.now()
  };
}

/**
 * Increment turn counter (called each conversation turn)
 */
export function incrementTurn(sm: StateMachineContext, utterance: string): StateMachineContext {
  return {
    ...sm,
    turnsInCurrentState: sm.turnsInCurrentState + 1,
    lastUtterance: utterance
  };
}

/**
 * Lock intent (prevents exiting until objective achieved)
 */
export function lockIntent(
  sm: StateMachineContext,
  intent: 'book' | 'reschedule' | 'cancel'
): StateMachineContext {
  console.log(`[StateMachine] 🔒 INTENT LOCKED: ${intent} - must complete before exiting`);
  return {
    ...sm,
    lockedIntent: intent
  };
}

/**
 * Unlock intent (objective achieved or abandoned via Safety Valve)
 */
export function unlockIntent(sm: StateMachineContext): StateMachineContext {
  console.log(`[StateMachine] 🔓 INTENT UNLOCKED: ${sm.lockedIntent}`);
  return {
    ...sm,
    lockedIntent: null
  };
}

// ═══════════════════════════════════════════════
// Atomic Identity Scrubbing
// ═══════════════════════════════════════════════

/**
 * Perform atomic identity scrubbing
 *
 * When caller says "No" to identity match, this function:
 * 1. Clears ALL pre-loaded patient data
 * 2. Sets identityScrubbed flag
 * 3. Transitions to MANUAL_SEARCH state
 *
 * This prevents "Joe Turner" data from leaking into "Roger Moore" booking
 */
export function scrubIdentity(
  callState: Partial<CompactCallState>,
  sm: StateMachineContext
): { callState: Partial<CompactCallState>; sm: StateMachineContext } {
  console.log('[StateMachine] 🧹 ATOMIC IDENTITY SCRUB: Clearing all pre-loaded patient data');

  // Log what we're clearing
  console.log('[StateMachine]   - Clearing matchedPatientName:', callState.matchedPatientName);
  console.log('[StateMachine]   - Clearing verifiedClinikoPatientId:', callState.verifiedClinikoPatientId);
  console.log('[StateMachine]   - Clearing nm:', callState.nm);

  // Clear ALL identity-related fields
  const scrubbedState: Partial<CompactCallState> = {
    ...callState,
    // Identity fields - SCRUB
    identityVerified: false,
    verifiedClinikoPatientId: undefined,
    matchedPatientName: undefined,
    pendingIdentityCheck: false,
    nm: null,  // Name must be re-collected

    // Appointment fields - SCRUB (wrong person's appointments)
    upcomingAppointmentId: undefined,
    upcomingAppointmentTime: undefined,

    // Search tracking - RESET
    nameSearchCompleted: false,
    nameSearchRequested: false,
    providedSearchName: undefined,
    needsNameForSearch: true,
    awaitingManualName: true,  // Next utterance IS the name

    // Keep booking intent - DON'T SCRUB
    // im, np, tp, etc. are preserved
  };

  // Update state machine
  const updatedSm: StateMachineContext = {
    ...transitionTo(sm, 'MANUAL_SEARCH', 'identity denied'),
    identityScrubbed: true,
    recoveryLevel: 2 as const  // Move to Level 2: Identity Pivot
  };

  console.log('[StateMachine] ✅ Identity scrubbed - now in MANUAL_SEARCH mode');

  return { callState: scrubbedState, sm: updatedSm };
}

// ═══════════════════════════════════════════════
// Universal Recovery Pattern
// ═══════════════════════════════════════════════

/**
 * Universal Recovery Response Generator
 *
 * Returns the appropriate recovery response based on current recovery level:
 * - Level 1: Direct Match (phone → verify → proceed)
 * - Level 2: Identity Pivot (denied → scrub → MANUAL_SEARCH)
 * - Level 3: Search Fallback (name search failed → SOFT_BOOKING)
 * - Level 4: Safety Valve (stuck 2 turns → force SMS handoff)
 */
export function getRecoveryResponse(
  sm: StateMachineContext,
  callState: Partial<CompactCallState>
): { response: string; newState: ConversationState; newRecoveryLevel: 1 | 2 | 3 | 4 } {
  console.log(`[StateMachine] 🔧 Recovery at Level ${sm.recoveryLevel}, State: ${sm.currentState}`);

  // Level 4: Safety Valve (highest priority - system stuck)
  if (sm.turnsInCurrentState >= 2 && sm.currentState !== 'COMPLETED' && sm.currentState !== 'GOODBYE') {
    console.log('[StateMachine] ⚠️ SAFETY VALVE TRIGGERED: Stuck in state for 2+ turns');
    return {
      response: "I'm having a bit of trouble with my system, so I've just sent a direct booking link to your phone to save you time. Just tap the link and you're all set!",
      newState: 'SAFETY_VALVE',
      newRecoveryLevel: 4
    };
  }

  // Level 3: Search Fallback (name search failed)
  if (sm.currentState === 'SEARCHING' && callState.nameSearchCompleted && !callState.upcomingAppointmentId) {
    console.log('[StateMachine] 📝 Level 3: Name search failed - switching to SOFT_BOOKING');
    return {
      response: "No worries! Let's find you a time that works. When would you like to come in?",
      newState: 'SOFT_BOOKING',
      newRecoveryLevel: 3
    };
  }

  // Level 2: Identity Pivot (identity denied)
  if (sm.currentState === 'MANUAL_SEARCH' && sm.identityScrubbed) {
    console.log('[StateMachine] 📝 Level 2: Awaiting name after identity denial');
    return {
      response: "No worries! What name is the appointment under so I can find it for you?",
      newState: 'MANUAL_SEARCH',
      newRecoveryLevel: 2
    };
  }

  // Level 1: Direct Match (normal flow)
  if (callState.pendingIdentityCheck && callState.matchedPatientName) {
    return {
      response: `I can help with that. Am I speaking with ${callState.matchedPatientName}?`,
      newState: 'VERIFYING',
      newRecoveryLevel: 1
    };
  }

  // Default: Continue in current state
  return {
    response: '',  // Let AI handle it
    newState: sm.currentState,
    newRecoveryLevel: sm.recoveryLevel
  };
}

// ═══════════════════════════════════════════════
// State Handler Functions
// ═══════════════════════════════════════════════

export interface StateHandlerResult {
  /** Response to give the user (empty = let AI handle) */
  response: string;
  /** Updated state machine context */
  sm: StateMachineContext;
  /** Updated call state */
  callState: Partial<CompactCallState>;
  /** Whether to call AI for response */
  callAI: boolean;
  /** Whether to end the call */
  endCall: boolean;
}

/**
 * Handle VERIFYING state
 */
export function handleVerifying(
  utterance: string,
  sm: StateMachineContext,
  callState: Partial<CompactCallState>
): StateHandlerResult {
  console.log('[StateMachine] 📍 VERIFYING: Processing utterance:', utterance);

  // Check for denial
  if (isDenial(utterance)) {
    console.log('[StateMachine] ❌ Identity DENIED - triggering atomic scrub');

    // Atomic identity scrub
    const { callState: scrubbedState, sm: updatedSm } = scrubIdentity(callState, sm);

    return {
      response: "No worries! What name is the appointment under so I can find it for you?",
      sm: updatedSm,
      callState: scrubbedState,
      callAI: false,  // We have the response
      endCall: false
    };
  }

  // Check for confirmation
  if (isConfirmation(utterance)) {
    console.log('[StateMachine] ✅ Identity CONFIRMED');

    return {
      response: '',  // Let AI handle the next step
      sm: transitionTo(sm, 'OFFERING_SLOTS', 'identity confirmed'),
      callState: {
        ...callState,
        identityVerified: true,
        pendingIdentityCheck: false
      },
      callAI: true,
      endCall: false
    };
  }

  // Ambiguous - let AI handle
  console.log('[StateMachine] ⚠️ Ambiguous response in VERIFYING');
  return {
    response: '',
    sm: incrementTurn(sm, utterance),
    callState,
    callAI: true,
    endCall: false
  };
}

/**
 * Handle MANUAL_SEARCH state
 */
export function handleManualSearch(
  utterance: string,
  sm: StateMachineContext,
  callState: Partial<CompactCallState>
): StateHandlerResult {
  console.log('[StateMachine] 📍 MANUAL_SEARCH: Processing utterance:', utterance);

  // Check if utterance looks like a name
  if (looksLikeName(utterance)) {
    console.log('[StateMachine] 📝 Received name for search:', utterance);

    return {
      response: '',  // Search will happen in main handler
      sm: transitionTo(sm, 'SEARCHING', 'name provided'),
      callState: {
        ...callState,
        providedSearchName: utterance.trim(),
        awaitingManualName: false,
        needsNameForSearch: false
      },
      callAI: false,  // Don't call AI - search first
      endCall: false
    };
  }

  // Not a name - increment turn and check for Safety Valve
  const updatedSm = incrementTurn(sm, utterance);

  if (updatedSm.turnsInCurrentState >= 2) {
    // Safety Valve: Stuck asking for name
    console.log('[StateMachine] ⚠️ SAFETY VALVE: Stuck in MANUAL_SEARCH');
    return {
      response: "I'm having a bit of trouble with my system, so I've just sent a direct booking link to your phone to save you time.",
      sm: transitionTo(updatedSm, 'SAFETY_VALVE', '2 turns stuck'),
      callState: {
        ...callState,
        rescheduleTimeFirst: true  // Switch to soft-booking mode
      },
      callAI: false,
      endCall: false
    };
  }

  return {
    response: "I'm sorry, I didn't catch that. Could you please tell me the full name the appointment is under?",
    sm: updatedSm,
    callState,
    callAI: false,
    endCall: false
  };
}

/**
 * Handle SOFT_BOOKING state (Time-First, skip identity)
 */
export function handleSoftBooking(
  utterance: string,
  sm: StateMachineContext,
  callState: Partial<CompactCallState>
): StateHandlerResult {
  console.log('[StateMachine] 📍 SOFT_BOOKING: Processing utterance:', utterance);

  // In soft-booking mode, we skip identity and go straight to slot offering
  // Let AI handle the time preference extraction and slot offering

  return {
    response: '',  // Let AI handle
    sm: {
      ...sm,
      recoveryLevel: 3  // Mark we're in soft-booking recovery
    },
    callState: {
      ...callState,
      rescheduleTimeFirst: true
    },
    callAI: true,
    endCall: false
  };
}

/**
 * Handle SAFETY_VALVE state
 */
export function handleSafetyValve(
  sm: StateMachineContext,
  callState: Partial<CompactCallState>,
  callerPhone: string
): StateHandlerResult {
  console.log('[StateMachine] 📍 SAFETY_VALVE: Forcing SMS handoff');

  // In Safety Valve mode:
  // 1. Send SMS with booking/reschedule link
  // 2. Provide a graceful exit message
  // 3. End the call

  return {
    response: "I'm having a bit of trouble with my system, so I've just sent a direct booking link to your phone to save you time. Just tap the link and you're all set! Have a great day!",
    sm: transitionTo(sm, 'COMPLETED', 'safety valve - sms sent'),
    callState: {
      ...callState,
      smsSentForReschedule: true
    },
    callAI: false,
    endCall: true
  };
}

// ═══════════════════════════════════════════════
// Main State Machine Router
// ═══════════════════════════════════════════════

/**
 * Route to the appropriate state handler
 */
export function routeState(
  utterance: string,
  sm: StateMachineContext,
  callState: Partial<CompactCallState>,
  callerPhone: string
): StateHandlerResult {
  console.log(`[StateMachine] 🎯 Routing state: ${sm.currentState} (turns: ${sm.turnsInCurrentState})`);

  // Check for stuck state (Safety Valve)
  if (sm.turnsInCurrentState >= 2 && sm.lockedIntent &&
      sm.currentState !== 'COMPLETED' && sm.currentState !== 'GOODBYE' && sm.currentState !== 'SAFETY_VALVE') {
    console.log('[StateMachine] ⚠️ SAFETY VALVE CHECK: Stuck for 2+ turns with locked intent');
    return handleSafetyValve(sm, callState, callerPhone);
  }

  switch (sm.currentState) {
    case 'VERIFYING':
      return handleVerifying(utterance, sm, callState);

    case 'MANUAL_SEARCH':
      return handleManualSearch(utterance, sm, callState);

    case 'SOFT_BOOKING':
      return handleSoftBooking(utterance, sm, callState);

    case 'SAFETY_VALVE':
      return handleSafetyValve(sm, callState, callerPhone);

    default:
      // For other states, let AI handle with normal flow
      return {
        response: '',
        sm: incrementTurn(sm, utterance),
        callState,
        callAI: true,
        endCall: false
      };
  }
}

/**
 * Check if goodbye is allowed based on state machine
 */
export function isGoodbyeAllowed(sm: StateMachineContext, callState: Partial<CompactCallState>): boolean {
  // Goodbye is allowed if:
  // 1. No locked intent
  if (!sm.lockedIntent) return true;

  // 2. Intent is completed
  if (sm.currentState === 'COMPLETED') return true;

  // 3. Safety valve was triggered
  if (sm.currentState === 'SAFETY_VALVE') return true;

  // 4. For reschedule: rc=true or smsSentForReschedule=true
  if (sm.lockedIntent === 'reschedule' || sm.lockedIntent === 'cancel') {
    if (callState.rc === true || callState.smsSentForReschedule === true) return true;
  }

  // 5. For booking: appointmentCreated=true
  if (sm.lockedIntent === 'book') {
    if (callState.appointmentCreated === true || callState.bc === true) return true;
  }

  // Otherwise, goodbye is NOT allowed
  console.log(`[StateMachine] 🚫 Goodbye NOT allowed: lockedIntent=${sm.lockedIntent}, state=${sm.currentState}`);
  return false;
}

/**
 * Determine if we should enter the state machine for this intent
 */
export function shouldUseStateMachine(callState: Partial<CompactCallState>): boolean {
  // Use state machine for reschedule and cancel intents
  // These require identity verification and have complex flows
  return callState.im === 'reschedule' || callState.im === 'change' || callState.im === 'cancel';
}

/**
 * Initialize state machine for a given intent
 */
export function initForIntent(intent: 'book' | 'reschedule' | 'cancel'): StateMachineContext {
  const sm = initStateMachine();

  // Lock the intent
  return lockIntent(sm, intent);
}
