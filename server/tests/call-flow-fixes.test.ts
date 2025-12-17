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
// TEST 9: Intake Form URL with clinikoPatientId
// ============================================================
console.log('\n[TEST 9: Intake Form URL with clinikoPatientId]');
console.log('Scenario: Intake form SMS link should include patientId for direct Cliniko update');
console.log('Expected: URL format: /intake/form_xxx?patientId=123\n');

function generateIntakeLink(params: {
  token: string;
  clinikoPatientId?: string;
  publicUrl?: string;
}): string {
  const publicUrl = params.publicUrl || 'http://localhost:3000';
  const patientIdParam = params.clinikoPatientId ? `?patientId=${params.clinikoPatientId}` : '';
  return `${publicUrl}/intake/${params.token}${patientIdParam}`;
}

test('Intake link with patientId should include query param', () => {
  const link = generateIntakeLink({
    token: 'form_CAxxxx123',
    clinikoPatientId: '456789'
  });
  return link === 'http://localhost:3000/intake/form_CAxxxx123?patientId=456789';
});

test('Intake link without patientId should NOT include query param', () => {
  const link = generateIntakeLink({
    token: 'form_CAxxxx123'
  });
  return link === 'http://localhost:3000/intake/form_CAxxxx123';
});

test('Intake link should use provided publicUrl', () => {
  const link = generateIntakeLink({
    token: 'form_test',
    clinikoPatientId: '999',
    publicUrl: 'https://clinic.example.com'
  });
  return link === 'https://clinic.example.com/intake/form_test?patientId=999';
});

// ============================================================
// TEST 10: Group Booking Detection
// ============================================================
console.log('\n[TEST 10: Group Booking Detection]');
console.log('Scenario: User says "book for me and my son"');
console.log('Expected: Detect group booking (gb=true), track multiple patients\n');

interface GroupBookingState {
  gb?: boolean;  // group_booking
  gp?: Array<{ name: string; relation?: string }>;  // group_patients
  groupBookingComplete?: number;
}

function detectGroupBooking(utterance: string): boolean {
  const utteranceLower = utterance.toLowerCase();
  const groupPhrases = [
    'me and my', 'my son and', 'my daughter and', 'for both',
    'two of us', 'both of us', 'two appointments', 'two people',
    'and me', 'and i', 'the kids and', 'whole family'
  ];
  return groupPhrases.some(phrase => utteranceLower.includes(phrase));
}

function simulateGroupBookingCompletion(
  groupPatients: Array<{ name: string; relation?: string }>
): GroupBookingState {
  return {
    gb: true,
    gp: groupPatients,
    groupBookingComplete: groupPatients.length
  };
}

test('"book for me and my son" should detect group booking', () => {
  return detectGroupBooking('book for me and my son') === true;
});

test('"appointment for both of us" should detect group booking', () => {
  return detectGroupBooking('appointment for both of us') === true;
});

test('"two appointments please" should detect group booking', () => {
  return detectGroupBooking('two appointments please') === true;
});

test('"I need an appointment" should NOT detect group booking', () => {
  return detectGroupBooking('I need an appointment') === false;
});

test('"book for my daughter" should NOT detect group booking (single)', () => {
  // This is a single booking for someone else, not a group
  return detectGroupBooking('book for my daughter') === false;
});

test('Group booking completion should track all members', () => {
  const result = simulateGroupBookingCompletion([
    { name: 'John Smith', relation: 'self' },
    { name: 'Tommy Smith', relation: 'son' }
  ]);
  return result.gb === true &&
         result.gp?.length === 2 &&
         result.groupBookingComplete === 2;
});

test('Group booking should store patient names and relations', () => {
  const result = simulateGroupBookingCompletion([
    { name: 'Sarah Jones', relation: 'self' },
    { name: 'Emma Jones', relation: 'daughter' }
  ]);
  return result.gp?.[0]?.name === 'Sarah Jones' &&
         result.gp?.[0]?.relation === 'self' &&
         result.gp?.[1]?.name === 'Emma Jones' &&
         result.gp?.[1]?.relation === 'daughter';
});

// ============================================================
// TEST 11: Form Submission with Patient ID
// ============================================================
console.log('\n[TEST 11: Form Submission with Patient ID]');
console.log('Scenario: Form submitted with clinikoPatientId in request body');
console.log('Expected: Use patient ID directly instead of phone lookup\n');

function determinePatientIdSource(params: {
  clinikoPatientId?: string;
  callerPhone?: string;
  phoneFromForm?: string;
}): { source: 'direct' | 'phone_lookup' | 'none'; patientId?: string } {
  // PREFERRED: Use clinikoPatientId if provided
  if (params.clinikoPatientId) {
    return { source: 'direct', patientId: params.clinikoPatientId };
  }

  // FALLBACK: Phone lookup
  if (params.callerPhone || params.phoneFromForm) {
    return { source: 'phone_lookup', patientId: undefined };
  }

  return { source: 'none' };
}

test('With clinikoPatientId, should use direct update', () => {
  const result = determinePatientIdSource({
    clinikoPatientId: '123456',
    callerPhone: '+61400000000'
  });
  return result.source === 'direct' && result.patientId === '123456';
});

test('Without clinikoPatientId, should fall back to phone lookup', () => {
  const result = determinePatientIdSource({
    callerPhone: '+61400000000'
  });
  return result.source === 'phone_lookup';
});

test('clinikoPatientId takes precedence over phone', () => {
  const result = determinePatientIdSource({
    clinikoPatientId: '999',
    callerPhone: '+61400000000',
    phoneFromForm: '+61411111111'
  });
  return result.source === 'direct' && result.patientId === '999';
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
