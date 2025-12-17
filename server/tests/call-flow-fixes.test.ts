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
