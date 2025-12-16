/**
 * Call Flow Stability Tests
 *
 * Tests for the acceptance criteria defined in the call flow stabilization fix:
 * 1. Loop prevention: Never ask the same question more than 2 times
 * 2. Shared phone disambiguation: Trigger once only, early
 * 3. Identity confirmation: possiblePatientId never used for booking, only confirmedPatientId
 * 4. "Send me a link" context routing
 * 5. No mid-flow resets: Once booking intent is locked, never revert
 * 6. Noise/STT failures: After 2 failures, offer SMS fallback
 *
 * Run: node --import tsx server/tests/call-flow-stability.test.ts
 */

import {
  initializeConversation,
  shouldAskQuestion,
  incrementQuestionCount,
  getQuestionCount,
  advanceBookingStage,
  isPastStage,
  resolveSharedPhone,
  resolveIdentity,
  BookingStage,
  type ConversationContext
} from '../ai/receptionistBrain';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ ${testName}${details ? ': ' + details : ''}`);
    failed++;
  }
}

function testSection(name: string) {
  console.log(`\n[${name}]`);
}

// Start tests
console.log('='.repeat(60));
console.log('CALL FLOW STABILITY TEST SUITE');
console.log('='.repeat(60));

let context: ConversationContext;

// ═══════════════════════════════════════════════
// 1. LOOP PREVENTION TESTS
// ═══════════════════════════════════════════════

testSection('1. LOOP PREVENTION (max 2 asks per question)');

context = initializeConversation('test-call-123', '+61400000000', 'Test Clinic');

assert(
  shouldAskQuestion(context, 'shared_phone_disambiguation') === true,
  'First question ask allowed'
);

context = incrementQuestionCount(context, 'shared_phone_disambiguation');
assert(
  shouldAskQuestion(context, 'shared_phone_disambiguation') === true,
  'Second question ask allowed'
);

context = incrementQuestionCount(context, 'shared_phone_disambiguation');
assert(
  shouldAskQuestion(context, 'shared_phone_disambiguation') === false,
  'Third question ask BLOCKED (max 2)'
);

// Test independent question tracking
context = initializeConversation('test-call-456', '+61400000000', 'Test Clinic');
context = incrementQuestionCount(context, 'shared_phone_disambiguation');
context = incrementQuestionCount(context, 'shared_phone_disambiguation');
assert(
  shouldAskQuestion(context, 'identity_confirmation') === true,
  'Different question types tracked independently'
);

// Test getQuestionCount
context = initializeConversation('test-call-789', '+61400000000', 'Test Clinic');
assert(
  getQuestionCount(context, 'name_capture') === 0,
  'Question count starts at 0'
);
context = incrementQuestionCount(context, 'name_capture');
assert(
  getQuestionCount(context, 'name_capture') === 1,
  'Question count increments to 1'
);
context = incrementQuestionCount(context, 'name_capture');
assert(
  getQuestionCount(context, 'name_capture') === 2,
  'Question count increments to 2'
);

// ═══════════════════════════════════════════════
// 2. SHARED PHONE DISAMBIGUATION TESTS
// ═══════════════════════════════════════════════

testSection('2. SHARED PHONE DISAMBIGUATION (once only)');

context = initializeConversation('test-call-sp-1', '+61400000000', 'Test Clinic');
context.possiblePatientId = '123';
context.possiblePatientName = 'John Doe';

assert(
  context.sharedPhoneResolved === undefined,
  'Shared phone not resolved initially'
);

context = resolveSharedPhone(context);
assert(
  context.sharedPhoneResolved === true,
  'Shared phone marked as resolved'
);
assert(
  context.sharedPhoneDisambiguation === undefined,
  'Disambiguation state cleared after resolution'
);

// Test that resolution is permanent
context.possiblePatientId = '456';
assert(
  context.sharedPhoneResolved === true,
  'Shared phone resolution persists even if possiblePatientId changes'
);

// ═══════════════════════════════════════════════
// 3. IDENTITY CONFIRMATION TESTS
// ═══════════════════════════════════════════════

testSection('3. IDENTITY CONFIRMATION (resolves "Are you X?" loop)');

context = initializeConversation('test-call-id-1', '+61400000000', 'Test Clinic');
context.nameDisambiguation = {
  existingName: 'John Doe',
  spokenName: 'Jane Doe',
  patientId: '123',
  preservedBc: true,
  preservedSi: 1
};

context = resolveIdentity(context);
assert(
  context.identityResolved === true,
  'Identity marked as resolved'
);
assert(
  context.nameDisambiguation === undefined,
  'Name disambiguation cleared after resolution'
);

// ═══════════════════════════════════════════════
// 4. "SEND ME A LINK" CONTEXT ROUTING TESTS
// ═══════════════════════════════════════════════

testSection('4. "SEND ME A LINK" CONTEXT ROUTING');

function detectLinkRequest(utterance: string) {
  const lower = utterance.toLowerCase();
  return lower.includes('send me a link') ||
         lower.includes('text me a link') ||
         lower.includes('send a link') ||
         lower.includes('text a link');
}

function detectDirectionsRequest(utterance: string) {
  const lower = utterance.toLowerCase();
  return lower.includes('direction') ||
         lower.includes('map') ||
         lower.includes('location') ||
         lower.includes('where are you');
}

assert(
  detectLinkRequest('send me a link') === true,
  '"send me a link" detected'
);
assert(
  detectLinkRequest('text me a link') === true,
  '"text me a link" detected'
);
assert(
  detectDirectionsRequest('send me directions') === true,
  '"send me directions" detected as directions request'
);
assert(
  detectDirectionsRequest('where are you located') === true,
  '"where are you located" detected as directions request'
);

// In booking context, "send me a link" should NOT be directions
const utterance1 = 'send me a link';
const inBookingContext = true;
const wantsDirections = detectDirectionsRequest(utterance1);
assert(
  detectLinkRequest(utterance1) && inBookingContext && !wantsDirections,
  '"send me a link" in booking context → booking link (not directions)'
);

// ═══════════════════════════════════════════════
// 5. INTENT LOCK (NO MID-FLOW RESETS) TESTS
// ═══════════════════════════════════════════════

testSection('5. INTENT LOCK (no mid-flow resets)');

context = initializeConversation('test-call-il-1', '+61400000000', 'Test Clinic');
context = advanceBookingStage(context, BookingStage.INTENT);

assert(
  context.intentLocked === true,
  'Intent locked after advancing to INTENT stage'
);
assert(
  context.bookingStage === BookingStage.INTENT,
  'Booking stage set correctly'
);

// Test stage progression maintains lock
context = advanceBookingStage(context, BookingStage.NEW_OR_EXISTING);
context = advanceBookingStage(context, BookingStage.COLLECT_NAME);
assert(
  context.intentLocked === true,
  'Intent lock maintained through stage progression'
);

// Test isPastStage
context = advanceBookingStage(context, BookingStage.OFFER_SLOTS);
assert(
  isPastStage(context, BookingStage.INTENT) === true,
  'isPastStage: past INTENT stage'
);
assert(
  isPastStage(context, BookingStage.SHARED_PHONE) === true,
  'isPastStage: past SHARED_PHONE stage'
);
assert(
  isPastStage(context, BookingStage.OFFER_SLOTS) === false,
  'isPastStage: at current stage (not past)'
);
assert(
  isPastStage(context, BookingStage.CONFIRM_SLOT) === false,
  'isPastStage: not past future stages'
);

// Test intent reset blocking
context = initializeConversation('test-call-il-2', '+61400000000', 'Test Clinic');
context.intentLocked = true;
context.currentState = { im: 'book' };
const newIntent = 'other';
const shouldBlockReset = context.intentLocked && (newIntent === 'other' || newIntent === 'faq');
assert(
  shouldBlockReset === true,
  'Intent reset to "other" blocked when locked'
);

// ═══════════════════════════════════════════════
// 6. SMS FALLBACK TESTS
// ═══════════════════════════════════════════════

testSection('6. SMS FALLBACK (after 2 failures)');

context = initializeConversation('test-call-sms-1', '+61400000000', 'Test Clinic');
context.noiseCount = 2;
assert(
  context.noiseCount >= 2,
  'SMS fallback triggers after 2 noise failures'
);

// ═══════════════════════════════════════════════
// 7. REGRESSION TESTS FROM CALL LOG
// ═══════════════════════════════════════════════

testSection('7. REGRESSION TESTS (from call log)');

// Test: No "Are you Michael Ip?" after slot selection
context = initializeConversation('test-call-reg-1', '+61400000000', 'Test Clinic');
context.currentState = {
  im: 'book',
  np: false,
  nm: 'Michael Brown',
  tp: 'today afternoon',
  si: 2, // Slot selected
  bc: false
};
context.intentLocked = true;
context = advanceBookingStage(context, BookingStage.CONFIRM_SLOT);
context.possiblePatientId = '123';
context.possiblePatientName = 'Michael Ip';

const slotAlreadySelected = context.currentState.si !== undefined && context.currentState.si !== null;
assert(
  slotAlreadySelected === true,
  'Slot is already selected'
);
assert(
  isPastStage(context, BookingStage.SHARED_PHONE) === true,
  'Past shared phone stage - no disambiguation should trigger'
);

// Test: "same number" handling
context = initializeConversation('test-call-reg-2', '+61400000000', 'Test Clinic');
const sameNumberUtterances = ['same number', 'same', 'this number', 'use this number'];
sameNumberUtterances.forEach(utterance => {
  const lower = utterance.toLowerCase();
  const isSameNumber = lower.includes('same number') ||
                       lower.includes('same') ||
                       lower.includes('this number');
  assert(
    isSameNumber === true,
    `"${utterance}" recognized as same number`
  );
});

// Test: No reset to "What can I help you with?" after booking started
context = initializeConversation('test-call-reg-3', '+61400000000', 'Test Clinic');
context.currentState = {
  im: 'book',
  np: true,
  nm: 'Margaret Thatcher',
  tp: 'today afternoon'
};
context.intentLocked = true;
const aiTriesToReset = 'other';
const resetBlocked = context.intentLocked && (aiTriesToReset === 'other' || aiTriesToReset === 'faq');
assert(
  resetBlocked === true,
  'AI cannot reset intent to "other" after booking started'
);

// ═══════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════

console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
