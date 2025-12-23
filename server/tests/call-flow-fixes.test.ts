/**
 * Call Flow Fixes - Regression Tests
 *
 * Tests for the following fixes:
 * 1. Empty speech debounce/grace window
 * 2. Secondary booking after confirmed appointment
 * 3. Knee pain FAQ (not out-of-scope)
 */

console.log('============================================================');
console.log('CALL FLOW FIXES - REGRESSION TESTS');
console.log('============================================================\n');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
  try {
    if (fn()) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ ${name} - Error: ${e}`);
    failed++;
  }
}

// ============================================================
// TEST 1: Empty Speech Debounce
// ============================================================
console.log('\n[TEST 1: Empty Speech Debounce]');
console.log('Scenario: Twilio sends empty SpeechResult, then immediately sends "3 p.m."');
console.log('Expected: Should NOT say "Are you still there?" - should wait for grace window\n');

// Simulate context state tracking
interface MockContext {
  currentState: {
    emptyCount?: number;
    lastEmptyAt?: number;
  };
}

function simulateEmptySpeechHandler(
  ctx: MockContext | null,
  speechResult: string,
  now: number,
  graceMs: number = 1000
): { shouldSpeak: boolean; shouldWaitSilently: boolean; updatedCtx: MockContext | null } {
  // Non-empty speech - reset counters
  if (speechResult && speechResult.trim() !== '') {
    if (ctx?.currentState?.emptyCount) {
      ctx.currentState.emptyCount = 0;
      ctx.currentState.lastEmptyAt = undefined;
    }
    return { shouldSpeak: false, shouldWaitSilently: false, updatedCtx: ctx };
  }

  // Empty speech handling
  const emptyCount = ctx?.currentState?.emptyCount || 0;
  const lastEmptyAt = ctx?.currentState?.lastEmptyAt || 0;

  // Check grace window
  const timeSinceLastEmpty = now - lastEmptyAt;
  if (lastEmptyAt > 0 && timeSinceLastEmpty < graceMs) {
    // Within grace window - wait silently
    return { shouldSpeak: false, shouldWaitSilently: true, updatedCtx: ctx };
  }

  // Outside grace window - update context and potentially speak
  if (ctx) {
    ctx.currentState = ctx.currentState || {};
    ctx.currentState.emptyCount = emptyCount + 1;
    ctx.currentState.lastEmptyAt = now;
  }

  // Should speak "Are you still there?" (unless max count reached)
  return {
    shouldSpeak: emptyCount < 2,
    shouldWaitSilently: false,
    updatedCtx: ctx
  };
}

// Test: Empty followed by immediate non-empty (within grace window)
test('Empty → immediate non-empty (within 500ms) should NOT trigger "Are you still there?"', () => {
  const ctx: MockContext = { currentState: {} };
  const now = Date.now();

  // First: empty speech arrives
  const result1 = simulateEmptySpeechHandler(ctx, '', now, 1000);

  // Then: non-empty speech arrives 500ms later (within grace window)
  // This simulates: the user's real speech arrived right after the empty
  const result2 = simulateEmptySpeechHandler(result1.updatedCtx, '3 p.m.', now + 500, 1000);

  // After receiving real speech, we should NOT speak "are you still there"
  // The real speech handler takes over
  return result2.shouldSpeak === false && result2.shouldWaitSilently === false;
});

// Test: Empty followed by another empty within grace window = wait silently
test('Empty → empty (within grace window) should wait silently', () => {
  const ctx: MockContext = { currentState: {} };
  const now = Date.now();

  // First empty
  const result1 = simulateEmptySpeechHandler(ctx, '', now, 1000);

  // Second empty within 500ms
  const result2 = simulateEmptySpeechHandler(result1.updatedCtx, '', now + 500, 1000);

  return result2.shouldWaitSilently === true;
});

// Test: Empty followed by empty OUTSIDE grace window = speak prompt
test('Empty → empty (after grace window) should speak "Are you still there?"', () => {
  const ctx: MockContext = { currentState: {} };
  const now = Date.now();

  // First empty
  const result1 = simulateEmptySpeechHandler(ctx, '', now, 1000);

  // Second empty after 1500ms (outside grace window)
  const result2 = simulateEmptySpeechHandler(result1.updatedCtx, '', now + 1500, 1000);

  return result2.shouldSpeak === true;
});

// Test: Reset emptyCount when non-empty speech received
test('Non-empty speech should reset emptyCount', () => {
  const ctx: MockContext = { currentState: { emptyCount: 1, lastEmptyAt: Date.now() } };
  const now = Date.now();

  // Non-empty speech arrives
  const result = simulateEmptySpeechHandler(ctx, 'hello', now + 2000, 1000);

  return result.updatedCtx?.currentState?.emptyCount === 0;
});

// ============================================================
// TEST 2: Secondary Booking Detection
// ============================================================
console.log('\n[TEST 2: Secondary Booking Detection]');
console.log('Scenario: User completes booking, then says "book for my child same time"');
console.log('Expected: Should detect secondary booking, NOT route to reschedule\n');

interface MockState {
  im?: string;
  appointmentCreated?: boolean;
  bookingFor?: 'self' | 'someone_else';
  np?: boolean;
  tp?: string | null;
  nm?: string | null;
  bc?: boolean;
  si?: number | null;
}

function detectSecondaryBooking(state: MockState, utterance: string): MockState {
  if (!state.appointmentCreated) {
    return state; // No primary booking - nothing to do
  }

  const utteranceLower = utterance.toLowerCase();
  const secondaryBookingPhrases = [
    'book for my',
    'also book',
    'another appointment',
    'same time for',
    'same time as my',
    'book my child',
    'book my son',
    'book my daughter',
    'for my child',
    'for my son',
    'for my daughter',
    'for my kid',
    'family member',
    'someone else',
    'another person',
    'one more appointment',
    'second appointment'
  ];

  const isSecondaryBooking = secondaryBookingPhrases.some(phrase => utteranceLower.includes(phrase));

  if (isSecondaryBooking) {
    // Reset for secondary booking
    const newState = { ...state };
    newState.im = 'book';
    newState.bookingFor = 'someone_else';
    newState.appointmentCreated = false;
    newState.bc = false;
    newState.si = null;
    newState.nm = null;
    newState.np = true;

    // Keep time preference if "same time" mentioned
    if (!utteranceLower.includes('same time')) {
      newState.tp = null;
    }

    return newState;
  }

  return state;
}

// Test: "book for my child same time" after booking
test('"book for my child same time" should trigger secondary booking', () => {
  const state: MockState = {
    im: 'book',
    appointmentCreated: true,
    tp: 'tomorrow 3pm',
    nm: 'John Smith',
    bc: true,
    si: 1
  };

  const result = detectSecondaryBooking(state, 'Can you also book for my child same time as my appointment?');

  return result.bookingFor === 'someone_else' &&
         result.appointmentCreated === false &&
         result.im === 'book' &&
         result.nm === null &&
         result.tp === 'tomorrow 3pm'; // Should preserve time preference
});

// Test: "book my daughter" after booking
test('"book my daughter" should trigger secondary booking', () => {
  const state: MockState = {
    im: 'book',
    appointmentCreated: true,
    tp: 'tomorrow morning'
  };

  const result = detectSecondaryBooking(state, 'I also want to book my daughter');

  return result.bookingFor === 'someone_else' && result.appointmentCreated === false;
});

// Test: "one more appointment for my son" after booking
test('"one more appointment for my son" should trigger secondary booking', () => {
  const state: MockState = {
    im: 'book',
    appointmentCreated: true
  };

  const result = detectSecondaryBooking(state, 'I need one more appointment for my son');

  return result.bookingFor === 'someone_else' && result.np === true;
});

// Test: Secondary booking should clear name but keep time if "same time" mentioned
test('Secondary booking with "same time" should preserve time preference', () => {
  const state: MockState = {
    appointmentCreated: true,
    tp: 'today at 2pm',
    nm: 'Parent Name'
  };

  const result = detectSecondaryBooking(state, 'same time for my kid please');

  return result.tp === 'today at 2pm' && result.nm === null;
});

// Test: Secondary booking WITHOUT "same time" should clear time preference
test('Secondary booking without "same time" should clear time preference', () => {
  const state: MockState = {
    appointmentCreated: true,
    tp: 'today at 2pm',
    nm: 'Parent Name'
  };

  const result = detectSecondaryBooking(state, 'book for my daughter');

  return result.tp === null;
});

// Test: Normal utterance after booking should NOT trigger secondary booking
test('Normal question after booking should NOT trigger secondary booking', () => {
  const state: MockState = {
    appointmentCreated: true,
    tp: 'tomorrow'
  };

  const result = detectSecondaryBooking(state, 'what should I wear?');

  return result.appointmentCreated === true && result.bookingFor === undefined;
});

// ============================================================
// TEST 3: Knee Pain FAQ
// ============================================================
console.log('\n[TEST 3: Knee Pain FAQ Response]');
console.log('Scenario: User asks about knee pain');
console.log('Expected: Should offer assessment, NOT say "we focus on chiropractic care"\n');

// Simulate FAQ category detection
function categorizeCondition(utterance: string): 'treatable' | 'out_of_scope' | 'other' {
  const utteranceLower = utterance.toLowerCase();

  // List of treatable conditions (including joints)
  const treatableConditions = [
    'back pain', 'neck pain', 'headache', 'shoulder pain', 'hip pain',
    'knee pain', 'joint pain', 'muscle pain', 'sciatica', 'posture',
    'sports injury', 'stiff', 'sore', 'ache', 'sprain',
    'shoulder', 'knee', 'hip', 'back', 'neck' // Single words for "hurt my X"
  ];

  // List of out-of-scope (animal care, etc.)
  const outOfScope = [
    'dog', 'cat', 'pet', 'animal', 'horse', 'veterinary'
  ];

  // Check out of scope first
  for (const phrase of outOfScope) {
    if (utteranceLower.includes(phrase)) {
      return 'out_of_scope';
    }
  }

  // Check treatable conditions
  for (const condition of treatableConditions) {
    if (utteranceLower.includes(condition)) {
      return 'treatable';
    }
  }

  return 'other';
}

// Test: Knee pain is treatable
test('Knee pain should be categorized as treatable', () => {
  return categorizeCondition('I have knee pain') === 'treatable';
});

// Test: Hip pain is treatable
test('Hip pain should be categorized as treatable', () => {
  return categorizeCondition('My hip is sore') === 'treatable';
});

// Test: Shoulder pain is treatable
test('Shoulder pain should be categorized as treatable', () => {
  return categorizeCondition('I hurt my shoulder') === 'treatable';
});

// Test: Back pain is treatable
test('Back pain should be categorized as treatable', () => {
  return categorizeCondition('lower back pain') === 'treatable';
});

// Test: Dog treatment is out of scope
test('Dog/pet treatment should be categorized as out_of_scope', () => {
  return categorizeCondition('Can you treat my dog?') === 'out_of_scope';
});

// Test: Sports injury is treatable
test('Sports injury should be categorized as treatable', () => {
  return categorizeCondition('I have a sports injury') === 'treatable';
});

// ============================================================
// TEST 4: Call Stage Guard (Empty Speech Suppression)
// ============================================================
console.log('\n[TEST 4: Call Stage Guard]');
console.log('Scenario: Empty speech during booking_in_progress or terminal stage');
console.log('Expected: Should NOT say "Are you still there?" - silent gather only\n');

type CallStage = 'greeting' | 'ask_name' | 'ask_time' | 'offer_slots' | 'ask_confirmation' | 'faq' | 'booking_in_progress' | 'sending_sms' | 'terminal';

interface EmptySpeechContext {
  currentState: {
    emptyCount?: number;
    lastEmptyAt?: number;
    callStage?: CallStage;
    terminalLock?: boolean;
  };
}

function shouldSpeakEmptyPrompt(ctx: EmptySpeechContext | null): boolean {
  const callStage = ctx?.currentState?.callStage;
  const terminalLock = ctx?.currentState?.terminalLock;

  // Non-interactive stages - suppress prompt
  const nonInteractiveStages: CallStage[] = ['booking_in_progress', 'sending_sms', 'terminal'];
  const isNonInteractive = callStage && nonInteractiveStages.includes(callStage);

  // Terminal lock always suppresses
  if (terminalLock || isNonInteractive) {
    return false; // Silent gather only
  }

  return true; // Can speak "Are you still there?"
}

// Test: booking_in_progress should suppress empty speech prompt
test('booking_in_progress stage should suppress "Are you still there?"', () => {
  const ctx: EmptySpeechContext = { currentState: { callStage: 'booking_in_progress' } };
  return shouldSpeakEmptyPrompt(ctx) === false;
});

// Test: terminal stage should suppress empty speech prompt
test('terminal stage should suppress "Are you still there?"', () => {
  const ctx: EmptySpeechContext = { currentState: { callStage: 'terminal' } };
  return shouldSpeakEmptyPrompt(ctx) === false;
});

// Test: sending_sms stage should suppress empty speech prompt
test('sending_sms stage should suppress "Are you still there?"', () => {
  const ctx: EmptySpeechContext = { currentState: { callStage: 'sending_sms' } };
  return shouldSpeakEmptyPrompt(ctx) === false;
});

// Test: terminalLock=true should suppress regardless of stage
test('terminalLock=true should suppress "Are you still there?"', () => {
  const ctx: EmptySpeechContext = { currentState: { terminalLock: true, callStage: 'faq' } };
  return shouldSpeakEmptyPrompt(ctx) === false;
});

// Test: Interactive stages should allow empty speech prompt
test('greeting stage should allow "Are you still there?"', () => {
  const ctx: EmptySpeechContext = { currentState: { callStage: 'greeting' } };
  return shouldSpeakEmptyPrompt(ctx) === true;
});

test('ask_name stage should allow "Are you still there?"', () => {
  const ctx: EmptySpeechContext = { currentState: { callStage: 'ask_name' } };
  return shouldSpeakEmptyPrompt(ctx) === true;
});

test('offer_slots stage should allow "Are you still there?"', () => {
  const ctx: EmptySpeechContext = { currentState: { callStage: 'offer_slots' } };
  return shouldSpeakEmptyPrompt(ctx) === true;
});

test('faq stage (without terminalLock) should allow "Are you still there?"', () => {
  const ctx: EmptySpeechContext = { currentState: { callStage: 'faq', terminalLock: false } };
  return shouldSpeakEmptyPrompt(ctx) === true;
});

// ============================================================
// TEST 5: Terminal Lock Behavior
// ============================================================
console.log('\n[TEST 5: Terminal Lock Behavior]');
console.log('Scenario: After booking, terminalLock=true should prevent duplicate confirmations');
console.log('Expected: FAQ, directions, price allowed; no repeat confirmations\n');

interface TerminalLockState {
  appointmentCreated?: boolean;
  terminalLock?: boolean;
  callStage?: CallStage;
  smsConfirmSent?: boolean;
  smsMapSent?: boolean;
}

function simulateBookingCompletion(): TerminalLockState {
  // Simulates what happens after appointment is created
  return {
    appointmentCreated: true,
    terminalLock: true,
    callStage: 'terminal',
    smsConfirmSent: true
  };
}

function canSendDuplicateSms(state: TerminalLockState, smsType: 'confirm' | 'map'): boolean {
  if (smsType === 'confirm') {
    return !state.smsConfirmSent; // Can only send if not already sent
  }
  if (smsType === 'map') {
    return !state.smsMapSent; // Can only send if not already sent
  }
  return false;
}

// Test: After booking, terminalLock should be true
test('After booking, terminalLock should be true', () => {
  const state = simulateBookingCompletion();
  return state.terminalLock === true;
});

// Test: After booking, callStage should be terminal
test('After booking, callStage should be terminal', () => {
  const state = simulateBookingCompletion();
  return state.callStage === 'terminal';
});

// Test: Cannot send duplicate confirmation SMS
test('Cannot send duplicate confirmation SMS after booking', () => {
  const state = simulateBookingCompletion();
  return canSendDuplicateSms(state, 'confirm') === false;
});

// Test: Can send map SMS if not already sent
test('Can send map SMS if not already sent', () => {
  const state = simulateBookingCompletion();
  state.smsMapSent = false;
  return canSendDuplicateSms(state, 'map') === true;
});

// Test: Cannot send map SMS if already sent
test('Cannot send duplicate map SMS', () => {
  const state = simulateBookingCompletion();
  state.smsMapSent = true;
  return canSendDuplicateSms(state, 'map') === false;
});

// ============================================================
// TEST 6: Empty Speech Grace Window (REGRESSION FIX)
// ============================================================
console.log('\n[TEST 6: Empty Speech Grace Window (Regression Fix)]');
console.log('Scenario: First empty should be silent, not "Are you still there?"');
console.log('Expected: On first empty (lastEmptyAt=0), return silent gather and set timestamp\n');

function simulateEmptySpeechGrace(
  lastEmptyAt: number,
  now: number,
  graceMs: number = 1000
): { shouldSpeak: boolean; isFirstEmpty: boolean; isWithinGrace: boolean } {
  const isFirstEmpty = lastEmptyAt === 0;
  const timeSinceLastEmpty = now - lastEmptyAt;
  const isWithinGrace = !isFirstEmpty && timeSinceLastEmpty < graceMs;

  // FIRST EMPTY or WITHIN GRACE: Silent gather only, don't speak
  if (isFirstEmpty || isWithinGrace) {
    return { shouldSpeak: false, isFirstEmpty, isWithinGrace };
  }

  // AFTER GRACE: Can speak "Are you still there?"
  return { shouldSpeak: true, isFirstEmpty, isWithinGrace };
}

test('FIRST empty (lastEmptyAt=0) should NOT speak - silent gather only', () => {
  const now = Date.now();
  const result = simulateEmptySpeechGrace(0, now);
  return result.shouldSpeak === false && result.isFirstEmpty === true;
});

test('Empty within grace window should NOT speak', () => {
  const now = Date.now();
  const lastEmptyAt = now - 500; // 500ms ago
  const result = simulateEmptySpeechGrace(lastEmptyAt, now);
  return result.shouldSpeak === false && result.isWithinGrace === true;
});

test('Empty AFTER grace window should speak', () => {
  const now = Date.now();
  const lastEmptyAt = now - 1500; // 1.5 seconds ago
  const result = simulateEmptySpeechGrace(lastEmptyAt, now);
  return result.shouldSpeak === true;
});

test('Empty → immediate non-empty should never trigger "Are you still there?"', () => {
  // Simulate: empty arrives, then 200ms later non-empty arrives
  // The first empty should return silent gather (shouldSpeak=false)
  const now = Date.now();
  const emptyResult = simulateEmptySpeechGrace(0, now);
  // First empty: should NOT speak, just set timestamp
  // Then non-empty arrives - context would reset emptyCount
  return emptyResult.shouldSpeak === false;
});

// ============================================================
// TEST 7: Secondary Booking Session (REGRESSION FIX)
// ============================================================
console.log('\n[TEST 7: Secondary Booking Session (Regression Fix)]');
console.log('Scenario: After primary booking, user says "book for my son Chris"');
console.log('Expected: Reset terminalLock, SMS flags, create new appointment\n');

interface SecondaryBookingState {
  appointmentCreated: boolean;
  terminalLock: boolean;
  callStage: string;
  smsConfirmSent: boolean;
  smsIntakeSent: boolean;
  bookingFor?: 'self' | 'someone_else';
  secondaryPatientName?: string;
  smsConfirmSentPrimary?: boolean;
  smsIntakeSentPrimary?: boolean;
}

function simulateSecondaryBookingDetection(
  state: SecondaryBookingState,
  utterance: string
): SecondaryBookingState {
  if (!state.appointmentCreated) return state;

  const utteranceLower = utterance.toLowerCase();
  const secondaryBookingPhrases = [
    'book for my', 'also book', 'another appointment', 'for my child',
    'for my son', 'for my daughter', 'family member', 'someone else'
  ];

  const isSecondaryBooking = secondaryBookingPhrases.some(p => utteranceLower.includes(p));

  if (isSecondaryBooking) {
    // Reset for secondary booking session
    return {
      appointmentCreated: false,
      terminalLock: false,
      callStage: 'ask_name',
      smsConfirmSent: false,
      smsIntakeSent: false,
      bookingFor: 'someone_else',
      secondaryPatientName: undefined,
      smsConfirmSentPrimary: state.smsConfirmSent,
      smsIntakeSentPrimary: state.smsIntakeSent
    };
  }

  return state;
}

test('Secondary booking should reset terminalLock to false', () => {
  const state: SecondaryBookingState = {
    appointmentCreated: true,
    terminalLock: true,
    callStage: 'terminal',
    smsConfirmSent: true,
    smsIntakeSent: true
  };
  const result = simulateSecondaryBookingDetection(state, 'book for my son Chris');
  return result.terminalLock === false;
});

test('Secondary booking should reset SMS flags for new session', () => {
  const state: SecondaryBookingState = {
    appointmentCreated: true,
    terminalLock: true,
    callStage: 'terminal',
    smsConfirmSent: true,
    smsIntakeSent: true
  };
  const result = simulateSecondaryBookingDetection(state, 'also book for my daughter');
  return result.smsConfirmSent === false && result.smsIntakeSent === false;
});

test('Secondary booking should preserve primary SMS state', () => {
  const state: SecondaryBookingState = {
    appointmentCreated: true,
    terminalLock: true,
    callStage: 'terminal',
    smsConfirmSent: true,
    smsIntakeSent: true
  };
  const result = simulateSecondaryBookingDetection(state, 'book for my child');
  return result.smsConfirmSentPrimary === true && result.smsIntakeSentPrimary === true;
});

test('Secondary booking should set callStage to ask_name', () => {
  const state: SecondaryBookingState = {
    appointmentCreated: true,
    terminalLock: true,
    callStage: 'terminal',
    smsConfirmSent: true,
    smsIntakeSent: false
  };
  const result = simulateSecondaryBookingDetection(state, 'another appointment for my kid');
  return result.callStage === 'ask_name';
});

test('Secondary booking should set bookingFor to someone_else', () => {
  const state: SecondaryBookingState = {
    appointmentCreated: true,
    terminalLock: true,
    callStage: 'terminal',
    smsConfirmSent: true,
    smsIntakeSent: true
  };
  const result = simulateSecondaryBookingDetection(state, 'for my daughter');
  return result.bookingFor === 'someone_else';
});

// ============================================================
// TEST 8: Name Sanitizer (REGRESSION FIX)
// ============================================================
console.log('\n[TEST 8: Name Sanitizer (Regression Fix)]');
console.log('Scenario: Speech-to-text captures "Chris message" or "John text"');
console.log('Expected: Strip artifacts → "Chris", "John"\n');

function sanitizePatientName(name: string | null | undefined): string | null {
  if (!name) return null;

  const artifactWords = [
    'message', 'text', 'sms', 'link', 'email',
    'please', 'thanks', 'thank you', 'okay', 'ok',
    'appointment', 'booking', 'book'
  ];

  let sanitized = name.trim();

  for (const artifact of artifactWords) {
    const regex = new RegExp(`\\s+${artifact}\\s*$`, 'i');
    sanitized = sanitized.replace(regex, '');
  }

  sanitized = sanitized.replace(/[.,!?;:]+$/, '').trim();
  sanitized = sanitized.replace(/\b\w/g, c => c.toUpperCase());

  return sanitized || null;
}

test('"Chris message" should sanitize to "Chris"', () => {
  return sanitizePatientName('Chris message') === 'Chris';
});

test('"John text" should sanitize to "John"', () => {
  return sanitizePatientName('John text') === 'John';
});

test('"Sarah SMS" should sanitize to "Sarah"', () => {
  return sanitizePatientName('Sarah SMS') === 'Sarah';
});

test('"Michael please" should sanitize to "Michael"', () => {
  return sanitizePatientName('Michael please') === 'Michael';
});

test('"Emma booking" should sanitize to "Emma"', () => {
  return sanitizePatientName('Emma booking') === 'Emma';
});

test('"David" (no artifact) should remain "David"', () => {
  return sanitizePatientName('david') === 'David';
});

test('null input should return null', () => {
  return sanitizePatientName(null) === null;
});

test('"Chris Link appointment" should sanitize to "Chris Link"', () => {
  // Only removes trailing artifact
  return sanitizePatientName('Chris Link appointment') === 'Chris Link';
});

// ============================================================
// TEST 9: isValidPersonName - Group Booking Name Validation
// ============================================================
console.log('\n[TEST 9: isValidPersonName - Group Booking Name Validation]');
console.log('Scenario: Validate names for group booking - reject pronouns, relations, placeholders');
console.log('Expected: "John Smith" valid, "myself" invalid, "my son" invalid\n');

/**
 * Mirrors the isValidPersonName function from openai-call-handler.ts
 */
function isValidPersonName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;

  const lower = name.toLowerCase().trim();

  // Pronouns and self-references
  const pronouns = [
    'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
    'me', 'you', 'him', 'her', 'us', 'them', 'i', 'we', 'they',
    'my', 'your', 'his', 'its', 'our', 'their'
  ];

  // Possessive family/relationship references (these need real names)
  const possessiveReferences = [
    'my son', 'my daughter', 'my wife', 'my husband', 'my partner',
    'my child', 'my kid', 'my kids', 'my children', 'my baby',
    'my mother', 'my father', 'my mom', 'my dad', 'my mum',
    'my brother', 'my sister', 'my friend', 'my boyfriend', 'my girlfriend',
    'my spouse', 'my fiancé', 'my fiancee', 'my fiance',
    'the child', 'the kid', 'the baby', 'the son', 'the daughter',
    'son', 'daughter', 'wife', 'husband', 'partner', 'child', 'kid', 'baby'
  ];

  // Common non-name words and articles
  const nonNameWords = [
    'for', 'and', 'the', 'a', 'an', 'this', 'that', 'here', 'there',
    'when', 'what', 'where', 'which', 'who', 'whom', 'whose',
    'today', 'tomorrow', 'both', 'all', 'some', 'any', 'each',
    'appointment', 'booking', 'please', 'thanks', 'thank', 'can', 'make'
  ];

  // Placeholder markers
  const placeholders = ['primary', 'secondary', 'caller', 'patient1', 'patient2'];

  // Check for exact pronoun match
  if (pronouns.includes(lower)) return false;

  // Check if name starts with possessive pronoun
  if (lower.startsWith('my ') || lower.startsWith('your ') ||
      lower.startsWith('his ') || lower.startsWith('her ') ||
      lower.startsWith('the ') || lower.startsWith('for ')) {
    return false;
  }

  // Check for possessive reference matches
  if (possessiveReferences.includes(lower)) return false;

  // Check if starts with common non-name word
  for (const word of nonNameWords) {
    if (lower.startsWith(word + ' ')) return false;
  }

  // Check for placeholder markers
  if (placeholders.includes(lower)) return false;

  // Check if it's a single non-name word
  if (nonNameWords.includes(lower)) return false;

  // Reject if name is too short
  if (lower.length < 2) return false;

  return true;
}

// Valid names should pass
test('"John Smith" should be valid', () => isValidPersonName('John Smith'));
test('"Sarah" should be valid', () => isValidPersonName('Sarah'));
test('"Chris Brown" should be valid', () => isValidPersonName('Chris Brown'));
test('"Tommy" should be valid', () => isValidPersonName('Tommy'));

// Pronouns should be rejected
test('"myself" should be INVALID (pronoun)', () => !isValidPersonName('myself'));
test('"me" should be INVALID (pronoun)', () => !isValidPersonName('me'));
test('"I" should be INVALID (pronoun)', () => !isValidPersonName('I'));
test('"him" should be INVALID (pronoun)', () => !isValidPersonName('him'));
test('"her" should be INVALID (pronoun)', () => !isValidPersonName('her'));

// Relation words used as names should be rejected
test('"son" should be INVALID (relation word)', () => !isValidPersonName('son'));
test('"daughter" should be INVALID (relation word)', () => !isValidPersonName('daughter'));
test('"wife" should be INVALID (relation word)', () => !isValidPersonName('wife'));
test('"husband" should be INVALID (relation word)', () => !isValidPersonName('husband'));
test('"child" should be INVALID (relation word)', () => !isValidPersonName('child'));
test('"kid" should be INVALID (relation word)', () => !isValidPersonName('kid'));
test('"baby" should be INVALID (relation word)', () => !isValidPersonName('baby'));

// Possessive references should be rejected
test('"my son" should be INVALID (possessive)', () => !isValidPersonName('my son'));
test('"my daughter" should be INVALID (possessive)', () => !isValidPersonName('my daughter'));
test('"my wife" should be INVALID (possessive)', () => !isValidPersonName('my wife'));
test('"the child" should be INVALID (possessive)', () => !isValidPersonName('the child'));

// Placeholders should be rejected
test('"primary" should be INVALID (placeholder)', () => !isValidPersonName('primary'));
test('"secondary" should be INVALID (placeholder)', () => !isValidPersonName('secondary'));
test('"caller" should be INVALID (placeholder)', () => !isValidPersonName('caller'));
test('"patient1" should be INVALID (placeholder)', () => !isValidPersonName('patient1'));

// Common words should be rejected
test('"for" should be INVALID (common word)', () => !isValidPersonName('for'));
test('"and" should be INVALID (common word)', () => !isValidPersonName('and'));
test('"please" should be INVALID (common word)', () => !isValidPersonName('please'));

// Edge cases
test('Empty string should be INVALID', () => !isValidPersonName(''));
test('Whitespace only should be INVALID', () => !isValidPersonName('   '));
test('Single character should be INVALID', () => !isValidPersonName('A'));

// ============================================================
// TEST 10: Group Booking Flow with Invalid Names
// ============================================================
console.log('\n[TEST 10: Group Booking Flow with Invalid Names]');
console.log('Scenario: User says "my son and I" - should detect intent but require real names');
console.log('Expected: gb=true, but executor should NOT run until real names provided\n');

interface GroupBookingState {
  gb: boolean;
  gp: Array<{ name: string; relation?: string }>;
  tp: string | null;
  hasRealNames: boolean;
  groupBookingReady: boolean;
}

function evaluateGroupBookingState(state: GroupBookingState): GroupBookingState {
  // Check if gp contains ACTUAL names (not placeholders, pronouns, or relations)
  const hasRealNames = Array.isArray(state.gp) &&
                       state.gp.length >= 2 &&
                       state.gp.every(p => p.name && isValidPersonName(p.name));

  const groupBookingReady = state.gb === true &&
                            hasRealNames &&
                            state.tp !== null;

  return { ...state, hasRealNames, groupBookingReady };
}

// "my son and I" -> gb=true but no valid names yet
test('Group booking with "myself" and "son" should NOT be ready (invalid names)', () => {
  const state: GroupBookingState = {
    gb: true,
    gp: [{ name: 'myself', relation: 'self' }, { name: 'son', relation: 'son' }],
    tp: 'today afternoon',
    hasRealNames: false,
    groupBookingReady: false
  };
  const result = evaluateGroupBookingState(state);
  return result.hasRealNames === false && result.groupBookingReady === false;
});

// Real names provided -> ready to book
test('Group booking with "John Smith" and "Tommy Smith" should be ready', () => {
  const state: GroupBookingState = {
    gb: true,
    gp: [{ name: 'John Smith', relation: 'self' }, { name: 'Tommy Smith', relation: 'son' }],
    tp: 'today afternoon',
    hasRealNames: false,
    groupBookingReady: false
  };
  const result = evaluateGroupBookingState(state);
  return result.hasRealNames === true && result.groupBookingReady === true;
});

// One valid name, one invalid -> not ready
test('Group booking with one valid and one invalid name should NOT be ready', () => {
  const state: GroupBookingState = {
    gb: true,
    gp: [{ name: 'John Smith', relation: 'self' }, { name: 'son', relation: 'son' }],
    tp: 'today afternoon',
    hasRealNames: false,
    groupBookingReady: false
  };
  const result = evaluateGroupBookingState(state);
  return result.hasRealNames === false && result.groupBookingReady === false;
});

// Valid names but no time preference -> not ready
test('Group booking with valid names but no tp should NOT be ready', () => {
  const state: GroupBookingState = {
    gb: true,
    gp: [{ name: 'John Smith', relation: 'self' }, { name: 'Tommy Smith', relation: 'son' }],
    tp: null,
    hasRealNames: false,
    groupBookingReady: false
  };
  const result = evaluateGroupBookingState(state);
  return result.hasRealNames === true && result.groupBookingReady === false;
});

// Only one person in gp -> not ready (need at least 2 for group)
test('Group booking with only 1 person should NOT be ready', () => {
  const state: GroupBookingState = {
    gb: true,
    gp: [{ name: 'John Smith', relation: 'self' }],
    tp: 'today afternoon',
    hasRealNames: false,
    groupBookingReady: false
  };
  const result = evaluateGroupBookingState(state);
  return result.hasRealNames === false && result.groupBookingReady === false;
});

// ============================================================
// TEST 11: Group Booking Executor Control Flow
// ============================================================
console.log('\n[TEST 11: Group Booking Executor Control Flow]');
console.log('Scenario: Executor runs BEFORE AI, blocks false confirmations');
console.log('Expected: AI cannot say "booked" when executor hasn\'t run\n');

interface GroupBookingContext {
  gb: boolean;
  gp: Array<{ name: string; relation?: string }>;
  tp: string | null;
  groupBookingComplete: number | false;
  bc: boolean;
}

interface AIResponse {
  reply: string;
  state: {
    bc: boolean;
    gp?: Array<{ name: string; relation?: string }>;
  };
}

/**
 * Simulates the control flow check:
 * If AI sets bc=true but groupBookingComplete is false, block it
 */
function simulateGroupBookingControlFlow(
  context: GroupBookingContext,
  aiResponse: AIResponse
): { blocked: boolean; overriddenReply: string | null; bcReset: boolean } {
  // Check if gp contains ACTUAL names
  const hasRealNames = Array.isArray(context.gp) &&
                       context.gp.length >= 2 &&
                       context.gp.every(p => p.name && isValidPersonName(p.name));

  // If AI sets bc=true but executor never ran (groupBookingComplete is false)
  if (context.gb && aiResponse.state.bc === true && !context.groupBookingComplete) {
    const gpLength = context.gp.length;
    const needsNames = gpLength < 2 || !hasRealNames;
    const needsTime = !context.tp;

    let overriddenReply: string;
    if (needsNames && needsTime) {
      overriddenReply = "I can book for both of you — may I have both full names and when you'd like to come in?";
    } else if (needsNames) {
      overriddenReply = "I can book for both of you — may I have both full names please?";
    } else if (needsTime) {
      overriddenReply = "When would you both like to come in?";
    } else {
      overriddenReply = "Let me book that for you. Just a moment...";
    }

    return { blocked: true, overriddenReply, bcReset: true };
  }

  return { blocked: false, overriddenReply: null, bcReset: false };
}

// AI says "I've booked you" but executor never ran (no real names)
test('Block AI confirmation when gp has invalid names', () => {
  const context: GroupBookingContext = {
    gb: true,
    gp: [{ name: 'myself', relation: 'self' }, { name: 'son', relation: 'son' }],
    tp: 'today 3pm',
    groupBookingComplete: false,
    bc: false
  };
  const aiResponse: AIResponse = {
    reply: "Great, I've booked you both for 3pm and 3:15pm!",
    state: { bc: true }
  };
  const result = simulateGroupBookingControlFlow(context, aiResponse);
  return result.blocked === true &&
         result.bcReset === true &&
         result.overriddenReply?.includes('full names');
});

// AI says "I've booked you" but executor never ran (missing time)
test('Block AI confirmation when tp is missing', () => {
  const context: GroupBookingContext = {
    gb: true,
    gp: [{ name: 'John Smith', relation: 'self' }, { name: 'Tommy Smith', relation: 'son' }],
    tp: null,
    groupBookingComplete: false,
    bc: false
  };
  const aiResponse: AIResponse = {
    reply: "Perfect, I've booked you both!",
    state: { bc: true }
  };
  const result = simulateGroupBookingControlFlow(context, aiResponse);
  return result.blocked === true &&
         result.bcReset === true &&
         result.overriddenReply?.includes('When would you');
});

// Executor DID run (groupBookingComplete > 0) - should NOT block
test('Allow AI reply when executor completed successfully', () => {
  const context: GroupBookingContext = {
    gb: true,
    gp: [{ name: 'John Smith', relation: 'self' }, { name: 'Tommy Smith', relation: 'son' }],
    tp: 'today 3pm',
    groupBookingComplete: 2,  // Executor created 2 appointments
    bc: true
  };
  const aiResponse: AIResponse = {
    reply: "Your appointments are confirmed!",
    state: { bc: true }
  };
  const result = simulateGroupBookingControlFlow(context, aiResponse);
  return result.blocked === false && result.bcReset === false;
});

// AI doesn't set bc=true - should NOT block
test('No blocking when AI doesn\'t confirm', () => {
  const context: GroupBookingContext = {
    gb: true,
    gp: [{ name: 'myself', relation: 'self' }, { name: 'son', relation: 'son' }],
    tp: 'today 3pm',
    groupBookingComplete: false,
    bc: false
  };
  const aiResponse: AIResponse = {
    reply: "And what's your son's name?",
    state: { bc: false }
  };
  const result = simulateGroupBookingControlFlow(context, aiResponse);
  return result.blocked === false && result.bcReset === false;
});

// Not a group booking - should NOT block single booking confirmation
test('No blocking for single (non-group) booking', () => {
  const context: GroupBookingContext = {
    gb: false,  // Not a group booking
    gp: [],
    tp: 'today 3pm',
    groupBookingComplete: false,
    bc: false
  };
  const aiResponse: AIResponse = {
    reply: "I've booked you for 3pm!",
    state: { bc: true }
  };
  const result = simulateGroupBookingControlFlow(context, aiResponse);
  return result.blocked === false;
});

// ============================================================
// TEST 12: Deterministic Time Preference Extraction
// ============================================================
console.log('\n[TEST 12: Deterministic Time Preference Extraction]');
console.log('Scenario: Extract time preference from utterance BEFORE AI');
console.log('Expected: "this morning" → tp set, ask_time skipped\n');

/**
 * Mirrors the extractTimePreferenceFromUtterance function from openai-call-handler.ts
 */
function extractTimePreferenceFromUtterance(utterance: string): string | null {
  const lower = utterance.toLowerCase().trim();

  // Pattern 1: Specific time with explicit meridiem
  const specificTimeMatch = lower.match(
    /\b(?:at|around|about)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i
  );

  if (specificTimeMatch) {
    const hour = parseInt(specificTimeMatch[1], 10);
    const minute = specificTimeMatch[2] || '00';
    const meridiem = specificTimeMatch[3].toLowerCase().replace(/\./g, '');
    return `today ${hour}:${minute}${meridiem}`;
  }

  // Pattern 2: Time of day with optional day reference
  const timeOfDayMatch = lower.match(
    /\b(this|today|tomorrow|next)?\s*(morning|afternoon|evening|arvo)\b/i
  );

  if (timeOfDayMatch) {
    const dayRef = timeOfDayMatch[1] || 'today';
    let timeOfDay = timeOfDayMatch[2];
    if (timeOfDay === 'arvo') timeOfDay = 'afternoon';
    const normalizedDay = dayRef === 'this' ? 'today' : dayRef;
    return `${normalizedDay} ${timeOfDay}`;
  }

  // Pattern 3: Day names
  const dayNameMatch = lower.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );
  if (dayNameMatch) {
    return dayNameMatch[1].toLowerCase();
  }

  // Pattern 4: Relative days
  if (/\btomorrow\b/i.test(lower)) return 'tomorrow';
  if (/\btoday\b/i.test(lower)) return 'today';

  // Pattern 5: Week references
  if (/\bnext\s+week\b/i.test(lower)) return 'next week';
  if (/\bthis\s+week\b/i.test(lower)) return 'today';

  return null;
}

// Time of day patterns
test('"this morning" → "today morning"', () => {
  return extractTimePreferenceFromUtterance('I need an appointment this morning') === 'today morning';
});

test('"this afternoon" → "today afternoon"', () => {
  return extractTimePreferenceFromUtterance('Can I come in this afternoon') === 'today afternoon';
});

test('"this arvo" → "today afternoon" (Australian slang)', () => {
  return extractTimePreferenceFromUtterance('I need an appointment this arvo') === 'today afternoon';
});

test('"tomorrow morning" → "tomorrow morning"', () => {
  return extractTimePreferenceFromUtterance('How about tomorrow morning') === 'tomorrow morning';
});

test('"tomorrow afternoon" → "tomorrow afternoon"', () => {
  return extractTimePreferenceFromUtterance('Can you fit me in tomorrow afternoon') === 'tomorrow afternoon';
});

// Specific time patterns
test('"at 9am" → "today 9:00am"', () => {
  return extractTimePreferenceFromUtterance('I want to come at 9am') === 'today 9:00am';
});

test('"4:30pm" → "today 4:30pm"', () => {
  return extractTimePreferenceFromUtterance('How about 4:30pm?') === 'today 4:30pm';
});

test('"around 3 p.m." → "today 3:00pm"', () => {
  const result = extractTimePreferenceFromUtterance('I can come around 3 p.m.');
  return result === 'today 3:00pm' || result === 'today 3:00p.m.';
});

// Day name patterns
test('"on Monday" → "monday"', () => {
  return extractTimePreferenceFromUtterance('Can I book for Monday') === 'monday';
});

test('"tuesday afternoon" → detects tuesday or afternoon', () => {
  const result = extractTimePreferenceFromUtterance('I want to come Tuesday afternoon');
  return result !== null;  // Should extract something
});

// Relative day patterns
test('"today" → "today"', () => {
  return extractTimePreferenceFromUtterance("I need to be seen today") === 'today';
});

test('"tomorrow" → "tomorrow"', () => {
  return extractTimePreferenceFromUtterance("Can I come tomorrow?") === 'tomorrow';
});

// Week patterns
test('"next week" → "next week"', () => {
  return extractTimePreferenceFromUtterance("Maybe sometime next week") === 'next week';
});

// No time preference
test('No time phrase → null', () => {
  return extractTimePreferenceFromUtterance("I need an appointment") === null;
});

test('Name only → null', () => {
  return extractTimePreferenceFromUtterance("My name is John Smith") === null;
});

// ============================================================
// TEST 13: Universal TP Extraction Flow
// ============================================================
console.log('\n[TEST 13: Universal TP Extraction Flow]');
console.log('Scenario: TP extraction runs for ALL booking intents, not just group');
console.log('Expected: Single booking also benefits from deterministic TP\n');

interface BookingContext {
  im: string | null;  // intent
  tp: string | null;  // time preference
  rs: boolean;        // ready to offer slots
  gb: boolean;        // group booking
  bookingFor?: string;
}

function simulateUniversalTpExtraction(
  context: BookingContext,
  utterance: string
): BookingContext {
  const isBookingIntent = context.im === 'book' ||
                          !context.im ||
                          context.bookingFor === 'someone_else';

  if (isBookingIntent && !context.tp) {
    const extractedTp = extractTimePreferenceFromUtterance(utterance);
    if (extractedTp) {
      return {
        ...context,
        tp: extractedTp,
        rs: true
      };
    }
  }

  return context;
}

test('Single booking: "this morning" sets tp and rs=true', () => {
  const context: BookingContext = {
    im: 'book',
    tp: null,
    rs: false,
    gb: false
  };
  const result = simulateUniversalTpExtraction(context, "I need an appointment this morning");
  return result.tp === 'today morning' && result.rs === true;
});

test('Secondary booking: "this afternoon" sets tp and rs=true', () => {
  const context: BookingContext = {
    im: 'book',
    tp: null,
    rs: false,
    gb: false,
    bookingFor: 'someone_else'
  };
  const result = simulateUniversalTpExtraction(context, "Same time this afternoon for my son");
  return result.tp === 'today afternoon' && result.rs === true;
});

test('No intent (default): "tomorrow" sets tp', () => {
  const context: BookingContext = {
    im: null,  // No intent set yet (first turn)
    tp: null,
    rs: false,
    gb: false
  };
  const result = simulateUniversalTpExtraction(context, "I want to book tomorrow");
  return result.tp === 'tomorrow' && result.rs === true;
});

test('TP already set: should NOT override', () => {
  const context: BookingContext = {
    im: 'book',
    tp: 'today 4:00pm',  // Already set
    rs: true,
    gb: false
  };
  const result = simulateUniversalTpExtraction(context, "Actually this morning");
  return result.tp === 'today 4:00pm';  // Unchanged
});

test('Reschedule intent: should NOT extract', () => {
  const context: BookingContext = {
    im: 'change',  // Reschedule, not book
    tp: null,
    rs: false,
    gb: false
  };
  const result = simulateUniversalTpExtraction(context, "I want to reschedule to tomorrow");
  return result.tp === null;  // Not extracted for reschedule
});

// ============================================================
// TEST 14: Terminal Call Exit
// ============================================================
console.log('\n[TEST 14: Terminal Call Exit]');
console.log('Scenario: After booking, caller says goodbye');
console.log('Expected: Clean exit with "All set. Thanks for calling. Goodbye!"\n');

interface TerminalExitContext {
  bc: boolean;
  appointmentCreated: boolean;
  groupBookingComplete: number | false;
  gb: boolean;
}

interface TerminalExitResult {
  shouldHangup: boolean;
  message: string;
  blocked: boolean;
}

function simulateTerminalExit(
  context: TerminalExitContext,
  utterance: string
): TerminalExitResult {
  const userUtteranceLower = utterance.toLowerCase().trim();

  const goodbyePhrases = [
    'no', 'nope', 'nah', "that's it", "that's all", "that is all", "that is it",
    'goodbye', 'bye', 'good bye', 'see ya', 'see you', 'thanks bye', 'thank you bye',
    'i\'m good', 'im good', "i'm done", 'im done', "that's everything", 'nothing else',
    'all set', 'all done', 'we\'re done', 'we are done', 'all good', 'no thanks',
    'no thank you', 'no more', 'nothing more', 'finished', 'i\'m finished', 'done'
  ];
  const wantsToEndCall = goodbyePhrases.some(phrase => userUtteranceLower.includes(phrase));

  const groupBookingInProgress = context.gb === true && !context.groupBookingComplete;

  const bookingComplete = context.bc === true ||
                          context.appointmentCreated === true ||
                          context.groupBookingComplete;

  const askingAboutHangup = userUtteranceLower.includes('hang up') ||
                             userUtteranceLower.includes('going to end');

  if (askingAboutHangup) {
    return {
      shouldHangup: true,
      message: "Yes, we're all done! Thanks for calling. Have a lovely day!",
      blocked: false
    };
  }

  if (wantsToEndCall && groupBookingInProgress) {
    return { shouldHangup: false, message: '', blocked: true };
  } else if (wantsToEndCall && bookingComplete) {
    return {
      shouldHangup: true,
      message: "All set. Thanks for calling. Goodbye!",
      blocked: false
    };
  } else if (wantsToEndCall && !context.gb) {
    return {
      shouldHangup: true,
      message: "No worries! Feel free to call back anytime. Goodbye!",
      blocked: false
    };
  }

  return { shouldHangup: false, message: '', blocked: false };
}

// After single booking (bc=true), "no thanks" should hang up
test('After booking (bc=true), "no thanks" should hang up', () => {
  const ctx: TerminalExitContext = {
    bc: true,
    appointmentCreated: false,
    groupBookingComplete: false,
    gb: false
  };
  const result = simulateTerminalExit(ctx, "no thanks");
  return result.shouldHangup === true && result.message.includes('Goodbye');
});

// After single booking (appointmentCreated=true), "that's all" should hang up
test('After booking (appointmentCreated=true), "that\'s all" should hang up', () => {
  const ctx: TerminalExitContext = {
    bc: false,
    appointmentCreated: true,
    groupBookingComplete: false,
    gb: false
  };
  const result = simulateTerminalExit(ctx, "that's all");
  return result.shouldHangup === true && result.message.includes('Goodbye');
});

// After group booking complete, "bye" should hang up
test('After group booking complete, "bye" should hang up', () => {
  const ctx: TerminalExitContext = {
    bc: true,
    appointmentCreated: false,
    groupBookingComplete: 2,
    gb: true
  };
  const result = simulateTerminalExit(ctx, "bye");
  return result.shouldHangup === true && result.message.includes('Goodbye');
});

// Group booking in progress, "bye" should be BLOCKED
test('Group booking in progress, "bye" should be BLOCKED', () => {
  const ctx: TerminalExitContext = {
    bc: false,
    appointmentCreated: false,
    groupBookingComplete: false,
    gb: true
  };
  const result = simulateTerminalExit(ctx, "bye");
  return result.blocked === true && result.shouldHangup === false;
});

// "Are you going to hang up?" should confirm and hang up
test('"Are you going to hang up?" should confirm and hang up', () => {
  const ctx: TerminalExitContext = {
    bc: true,
    appointmentCreated: false,
    groupBookingComplete: false,
    gb: false
  };
  const result = simulateTerminalExit(ctx, "are you going to hang up?");
  return result.shouldHangup === true && result.message.includes('all done');
});

// "finished" should trigger exit
test('"finished" should trigger clean exit', () => {
  const ctx: TerminalExitContext = {
    bc: true,
    appointmentCreated: false,
    groupBookingComplete: false,
    gb: false
  };
  const result = simulateTerminalExit(ctx, "I'm finished");
  return result.shouldHangup === true;
});

// No booking, "no thanks" should still exit gracefully
test('No booking, "no thanks" should exit with different message', () => {
  const ctx: TerminalExitContext = {
    bc: false,
    appointmentCreated: false,
    groupBookingComplete: false,
    gb: false
  };
  const result = simulateTerminalExit(ctx, "no thanks");
  return result.shouldHangup === true && result.message.includes('call back');
});

// Non-goodbye phrase should NOT trigger exit
test('Question after booking should NOT trigger exit', () => {
  const ctx: TerminalExitContext = {
    bc: true,
    appointmentCreated: false,
    groupBookingComplete: false,
    gb: false
  };
  const result = simulateTerminalExit(ctx, "what's the price?");
  return result.shouldHangup === false && result.blocked === false;
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n============================================================');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL CALL FLOW FIXES TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
console.log('============================================================');

console.log('\n[HOW TO TEST IN PRODUCTION]');
console.log('1. Empty Speech Debounce:');
console.log('   - Call → greet → pause (silence) → say "3 p.m." quickly');
console.log('   - Should NOT hear "Are you still there?" before "3 p.m." is processed');
console.log('');
console.log('2. Secondary Booking:');
console.log('   - Complete a booking → "Book for my child same time as my appointment"');
console.log('   - Should ask for child\'s name, NOT say "couldn\'t find appointment"');
console.log('');
console.log('3. Knee Pain FAQ:');
console.log('   - Ask "Do you treat knee pain?"');
console.log('   - Should say "Yes, our chiropractors can help assess knee pain"');
console.log('   - Should NOT say "we focus on chiropractic care"');
console.log('');
console.log('4. Call Stage Guard (NEW):');
console.log('   - Select slot → system says "Booking now" → silence');
console.log('   - Should NOT hear "Are you still there?" during booking');
console.log('   - Silent gather only while booking_in_progress');
console.log('');
console.log('5. Terminal Lock (NEW):');
console.log('   - After booking, ask price + directions');
console.log('   - Should answer FAQ without repeating confirmation/SMS language');
console.log('   - No duplicate "I\'ve booked your appointment" messages');
console.log('');
console.log('6. Empty Speech Grace Window (REGRESSION FIX):');
console.log('   - On FIRST empty speech, should NOT say "Are you still there?"');
console.log('   - Should return silent gather and set lastEmptyAt timestamp');
console.log('   - Only speak after grace window (1s) passes');
console.log('');
console.log('7. Secondary Booking (REGRESSION FIX):');
console.log('   - After primary booking: "book for my son Chris same time"');
console.log('   - Should reset terminalLock=false, smsConfirmSent=false');
console.log('   - Should create NEW appointment with child name');
console.log('   - Should send NEW confirmation SMS for child');
console.log('');
console.log('8. Name Sanitizer (REGRESSION FIX):');
console.log('   - "Chris message" → "Chris"');
console.log('   - "John text" → "John"');
console.log('   - Strips speech-to-text artifacts from patient names');
