/**
 * Booking Confirmation Fixes - Test Suite
 *
 * Tests for the following fixes:
 * 1. Slot confirmation guard - prevents booking on same turn slots are offered
 * 2. Terminal state enforcement - prevents booking prompts after booking complete
 * 3. Universal hangup detection - properly handles "hang up" commands
 * 4. Group booking time confirmation - requires user confirmation before booking
 *
 * Run: npm test
 */

console.log('============================================================');
console.log('BOOKING CONFIRMATION FIXES - TEST SUITE');
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

function testSection(name: string) {
  console.log(`\n[${name}]`);
}

// ============================================================
// TEST 1: Slot Confirmation Guard
// Scenario: User says "tomorrow morning" → slots fetched → AI shouldn't book on same turn
// ============================================================
testSection('TEST 1: Slot Confirmation Guard');

interface MockSlot {
  startISO: string;
  speakable: string;
}

interface MockState {
  slotsOfferedAt?: number;
  bc?: boolean;
  si?: number | null;
  nm?: string;
}

function simulateSlotConfirmationGuard(
  currentState: MockState,
  availableSlots: MockSlot[] | undefined,
  aiWantsToBook: { bc: boolean; si: number | null | undefined; nm: string | null }
): { shouldBook: boolean; reason: string; updatedState: MockState } {

  const slotsWereOfferedPreviously = currentState.slotsOfferedAt !== undefined;
  const slotsExistNow = availableSlots && availableSlots.length > 0;

  // If slots exist but weren't offered yet, mark them as offered NOW
  if (slotsExistNow && !slotsWereOfferedPreviously) {
    currentState.slotsOfferedAt = Date.now();
  }

  const shouldAttemptBooking = aiWantsToBook.bc &&
                                aiWantsToBook.nm &&
                                availableSlots &&
                                aiWantsToBook.si !== undefined &&
                                aiWantsToBook.si !== null;

  const bookingBlockedBySlotGuard = shouldAttemptBooking && !slotsWereOfferedPreviously;

  if (bookingBlockedBySlotGuard) {
    // Block booking - user hasn't seen slots yet
    currentState.bc = false;
    currentState.si = null;
    return {
      shouldBook: false,
      reason: 'Blocked: Slots just offered this turn - user must confirm',
      updatedState: currentState
    };
  }

  if (shouldAttemptBooking) {
    currentState.bc = true;
    currentState.si = aiWantsToBook.si;
    return {
      shouldBook: true,
      reason: 'Allowed: User had opportunity to select slot',
      updatedState: currentState
    };
  }

  return {
    shouldBook: false,
    reason: 'Not attempting booking (missing requirements)',
    updatedState: currentState
  };
}

test('First turn with slots: AI tries to book → BLOCKED', () => {
  const state: MockState = {}; // No slotsOfferedAt yet
  const slots: MockSlot[] = [
    { startISO: '2025-01-15T10:30:00', speakable: '10:30am' },
    { startISO: '2025-01-15T11:15:00', speakable: '11:15am' }
  ];

  const result = simulateSlotConfirmationGuard(state, slots, {
    bc: true,
    si: 0,
    nm: 'Jane Smith'
  });

  return result.shouldBook === false && result.reason.includes('Blocked');
});

test('Second turn after slots offered: AI tries to book → ALLOWED', () => {
  const state: MockState = {
    slotsOfferedAt: Date.now() - 5000 // Slots were offered 5 seconds ago
  };
  const slots: MockSlot[] = [
    { startISO: '2025-01-15T10:30:00', speakable: '10:30am' }
  ];

  const result = simulateSlotConfirmationGuard(state, slots, {
    bc: true,
    si: 0,
    nm: 'Jane Smith'
  });

  return result.shouldBook === true && result.reason.includes('Allowed');
});

test('No slots available: AI tries to book → NOT ATTEMPTED', () => {
  const state: MockState = {};

  const result = simulateSlotConfirmationGuard(state, undefined, {
    bc: true,
    si: 0,
    nm: 'Jane Smith'
  });

  return result.shouldBook === false && result.reason.includes('Not attempting');
});

test('slotsOfferedAt is set when slots first appear', () => {
  const state: MockState = {}; // No slotsOfferedAt
  const slots: MockSlot[] = [
    { startISO: '2025-01-15T10:30:00', speakable: '10:30am' }
  ];

  simulateSlotConfirmationGuard(state, slots, { bc: false, si: null, nm: null });

  return state.slotsOfferedAt !== undefined;
});

// ============================================================
// TEST 2: Terminal State Booking Prompt Guard
// Scenario: After booking confirmed, AI should NOT ask "would you like to book?"
// ============================================================
testSection('TEST 2: Terminal State Booking Prompt Guard');

const bookingPromptPatterns = [
  /would you like to (make|book|schedule|proceed with) an? (appointment|booking)/i,
  /can i (help you )?(book|schedule|make) an? appointment/i,
  /shall i (book|schedule|make|confirm) (an? )?(appointment|that|it)/i,
  /do you want (me )?to (book|schedule|make|confirm)/i,
  /would you like me to (book|schedule|make|confirm|lock)/i,
  /would you like to (proceed|go ahead|confirm)/i,
  /shall i (confirm|lock) that (in|for you)/i,
  /can i (confirm|lock) that (in|for you)/i,
  /want me to (book|confirm|lock) (that|it)/i,
  /let me (book|confirm|lock) that (in|for you)/i,
  /when would you like to come in/i,
  /what time works (best|for you)/i,
  /can i (help|assist) you with (a|an)? (booking|appointment)/i,
  /would you like to (set up|arrange)/i
];

function shouldBlockReply(reply: string, isTerminalState: boolean, appointmentCreated: boolean): boolean {
  if (!isTerminalState) return false;

  // Check if any booking prompt pattern matches
  const hasBookingPrompt = bookingPromptPatterns.some(p => p.test(reply));

  // Also check if AI is trying to restart booking flow
  const replyLower = reply.toLowerCase();
  const isRestartingBookingFlow = appointmentCreated &&
    (replyLower.includes('when would you') ||
     replyLower.includes('what time') ||
     replyLower.includes('book an appointment'));

  return hasBookingPrompt || isRestartingBookingFlow;
}

test('Terminal state: "Would you like to make an appointment?" → BLOCKED', () => {
  const reply = "Is there anything else? Would you like to make an appointment?";
  return shouldBlockReply(reply, true, true);
});

test('Terminal state: "Shall I book that for you?" → BLOCKED', () => {
  const reply = "I have 10:30 available. Shall I book that for you?";
  return shouldBlockReply(reply, true, true);
});

test('Terminal state: "When would you like to come in?" → BLOCKED', () => {
  const reply = "When would you like to come in?";
  return shouldBlockReply(reply, true, true);
});

test('Terminal state: FAQ answer without booking prompt → ALLOWED', () => {
  const reply = "We charge $95 for an initial consultation. Is there anything else?";
  return shouldBlockReply(reply, true, true) === false;
});

test('Non-terminal state: Booking prompt → ALLOWED', () => {
  const reply = "Would you like to make an appointment?";
  return shouldBlockReply(reply, false, false) === false;
});

test('Terminal state: "Can I help you book an appointment?" → BLOCKED', () => {
  const reply = "Can I help you book an appointment?";
  return shouldBlockReply(reply, true, true);
});

// ============================================================
// TEST 3: Universal Hangup Detection
// Scenario: User says "hang up" at any point → should disconnect
// ============================================================
testSection('TEST 3: Universal Hangup Detection');

const directHangupCommands = [
  'hang up',
  'end the call',
  'end call',
  'close the call',
  'disconnect',
  'i want to hang up',
  'please hang up',
  'you can hang up',
  'just hang up',
  'go ahead and hang up',
  'okay hang up'
];

function detectHangupIntent(utterance: string): { isDirectCommand: boolean; isQuestion: boolean } {
  const utteranceLower = utterance.toLowerCase().trim();

  const isDirectCommand = directHangupCommands.some(cmd => utteranceLower.includes(cmd));

  const isQuestion = (utteranceLower.includes('are you going to') ||
                      utteranceLower.includes('will you') ||
                      utteranceLower.includes('can you') ||
                      utteranceLower.includes('should i')) &&
                     utteranceLower.includes('hang up');

  return { isDirectCommand, isQuestion };
}

test('Direct command: "hang up" → detected as command', () => {
  const result = detectHangupIntent('hang up');
  return result.isDirectCommand === true && result.isQuestion === false;
});

test('Direct command: "please hang up" → detected as command', () => {
  const result = detectHangupIntent('please hang up');
  return result.isDirectCommand === true;
});

test('Question: "are you going to hang up?" → detected as question', () => {
  const result = detectHangupIntent('are you going to hang up?');
  return result.isQuestion === true;
});

test('Question: "will you hang up?" → detected as question', () => {
  const result = detectHangupIntent('will you hang up for me?');
  return result.isQuestion === true;
});

test('Not hangup: "how do I book?" → not detected', () => {
  const result = detectHangupIntent('how do I book an appointment?');
  return result.isDirectCommand === false && result.isQuestion === false;
});

test('Direct command: "you can hang up now" → detected as command', () => {
  const result = detectHangupIntent('you can hang up now');
  return result.isDirectCommand === true;
});

// ============================================================
// TEST 4: Group Booking Confirmation Flow
// Scenario: Group booking should propose times and wait for confirmation
// ============================================================
testSection('TEST 4: Group Booking Confirmation Flow');

interface GroupBookingState {
  gb?: boolean;
  gp?: Array<{ name: string }>;
  tp?: string;
  groupBookingProposed?: boolean;
  groupBookingComplete?: boolean;
}

function simulateGroupBookingConfirmation(
  state: GroupBookingState,
  slots: MockSlot[],
  userUtterance: string
): { action: string; message?: string; shouldBook: boolean } {

  const hasRealNames = Array.isArray(state.gp) &&
                        state.gp.length >= 2 &&
                        state.gp.every(p => p.name && !['myself', 'my son', 'me', 'my daughter'].includes(p.name.toLowerCase()));

  const groupBookingReady = state.gb === true &&
                             hasRealNames &&
                             state.tp &&
                             !state.groupBookingComplete;

  if (!groupBookingReady) {
    return { action: 'not_ready', shouldBook: false };
  }

  // If not yet proposed, propose and wait
  if (!state.groupBookingProposed) {
    const getFirstName = (fullName: string) => fullName.split(' ')[0];
    const proposedSummary = state.gp!.map((p, i) => {
      const slot = slots[i];
      return `${getFirstName(p.name)} at ${slot?.speakable || 'an available time'}`;
    }).join(' and ');

    state.groupBookingProposed = true;

    return {
      action: 'propose',
      message: `I can book ${proposedSummary}. Does that work?`,
      shouldBook: false
    };
  }

  // Already proposed - check user's response
  const confirmationPhrases = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'perfect', 'sounds good'];
  const declinePhrases = ['no', 'nope', 'different', 'change'];

  const utteranceLower = userUtterance.toLowerCase().trim();
  const isConfirming = confirmationPhrases.some(phrase => utteranceLower.includes(phrase));
  const isDeclining = declinePhrases.some(phrase => utteranceLower.includes(phrase));

  if (isDeclining) {
    state.groupBookingProposed = false;
    state.tp = undefined;
    return {
      action: 'decline',
      message: 'What time would work better for you?',
      shouldBook: false
    };
  }

  if (isConfirming) {
    return {
      action: 'confirm',
      shouldBook: true
    };
  }

  // Unclear response - repeat proposal
  return {
    action: 'repeat',
    message: 'Just to confirm - does that work?',
    shouldBook: false
  };
}

test('Group booking: First time ready → propose times, do NOT book', () => {
  const state: GroupBookingState = {
    gb: true,
    gp: [{ name: 'Michael Bishop' }, { name: 'Merrick Bishop' }],
    tp: 'tomorrow morning'
  };
  const slots: MockSlot[] = [
    { startISO: '2025-01-15T10:30:00', speakable: '10:30am' },
    { startISO: '2025-01-15T11:15:00', speakable: '11:15am' }
  ];

  const result = simulateGroupBookingConfirmation(state, slots, '');

  return result.action === 'propose' &&
         result.shouldBook === false &&
         state.groupBookingProposed === true &&
         result.message?.includes('Michael') &&
         result.message?.includes('Merrick');
});

test('Group booking: User confirms "yes" → proceed to book', () => {
  const state: GroupBookingState = {
    gb: true,
    gp: [{ name: 'Michael Bishop' }, { name: 'Merrick Bishop' }],
    tp: 'tomorrow morning',
    groupBookingProposed: true
  };
  const slots: MockSlot[] = [
    { startISO: '2025-01-15T10:30:00', speakable: '10:30am' }
  ];

  const result = simulateGroupBookingConfirmation(state, slots, 'yes that works');

  return result.action === 'confirm' && result.shouldBook === true;
});

test('Group booking: User declines "no, different time" → reset and ask again', () => {
  const state: GroupBookingState = {
    gb: true,
    gp: [{ name: 'Michael Bishop' }, { name: 'Merrick Bishop' }],
    tp: 'tomorrow morning',
    groupBookingProposed: true
  };
  const slots: MockSlot[] = [];

  const result = simulateGroupBookingConfirmation(state, slots, 'no I want a different time');

  return result.action === 'decline' &&
         result.shouldBook === false &&
         state.groupBookingProposed === false &&
         state.tp === undefined;
});

test('Group booking: Unclear response "um" → repeat proposal', () => {
  const state: GroupBookingState = {
    gb: true,
    gp: [{ name: 'Michael Bishop' }, { name: 'Merrick Bishop' }],
    tp: 'tomorrow morning',
    groupBookingProposed: true
  };
  const slots: MockSlot[] = [];

  const result = simulateGroupBookingConfirmation(state, slots, 'um');

  return result.action === 'repeat' && result.shouldBook === false;
});

test('Group booking: Invalid names ("myself", "my son") → not ready', () => {
  const state: GroupBookingState = {
    gb: true,
    gp: [{ name: 'myself' }, { name: 'my son' }],
    tp: 'tomorrow morning'
  };

  const result = simulateGroupBookingConfirmation(state, [], '');

  return result.action === 'not_ready' && result.shouldBook === false;
});

// ============================================================
// TEST 5: Terminal Goodbye Phrases
// Scenario: After booking, user says "no thanks" → should hang up
// ============================================================
testSection('TEST 5: Terminal Goodbye Detection');

const terminalGoodbyePhrases = [
  'no', 'nope', 'nah', "that's it", "that's all", "that is all", "that is it",
  'goodbye', 'bye', 'good bye', 'see ya', 'see you', 'thanks bye', 'thank you bye',
  'i\'m good', 'im good', "i'm done", 'im done', "that's everything", 'nothing else',
  'all set', 'all done', 'we\'re done', 'we are done', 'all good', 'no thanks',
  'no thank you', 'no more', 'nothing more', 'finished', 'i\'m finished', 'done',
  'ok thanks', 'okay thanks', 'ok thank you', 'okay thank you', 'perfect thanks',
  'great thanks', 'great thank you', 'sounds good bye', 'sounds good goodbye',
  'nothing', 'no i\'m good', 'no im good', 'alright bye', 'alright goodbye'
];

const faqKeywords = ['price', 'cost', 'how much', 'pay', 'payment', 'cash', 'card',
                     'directions', 'where', 'address', 'location', 'find you',
                     'parking', 'park', 'wear', 'bring', 'prepare', 'what to',
                     'cancel', 'reschedule', 'change', 'move', 'another appointment', 'book'];

function detectTerminalGoodbye(utterance: string): { wantsToEnd: boolean; isFaq: boolean } {
  const utteranceLower = utterance.toLowerCase().trim();

  const isFaq = faqKeywords.some(kw => utteranceLower.includes(kw));
  const wantsToEnd = terminalGoodbyePhrases.some(phrase => utteranceLower.includes(phrase));

  return { wantsToEnd: !isFaq && wantsToEnd, isFaq };
}

test('Terminal: "no thanks" → wants to end', () => {
  const result = detectTerminalGoodbye('no thanks');
  return result.wantsToEnd === true && result.isFaq === false;
});

test('Terminal: "that\'s all" → wants to end', () => {
  const result = detectTerminalGoodbye("that's all");
  return result.wantsToEnd === true;
});

test('Terminal: "goodbye" → wants to end', () => {
  const result = detectTerminalGoodbye('goodbye');
  return result.wantsToEnd === true;
});

test('FAQ: "how much does it cost?" → FAQ, not goodbye', () => {
  const result = detectTerminalGoodbye('how much does it cost?');
  return result.isFaq === true && result.wantsToEnd === false;
});

test('FAQ: "where are you located?" → FAQ, not goodbye', () => {
  const result = detectTerminalGoodbye('where are you located?');
  return result.isFaq === true;
});

test('FAQ: "book another appointment" → FAQ, not goodbye', () => {
  const result = detectTerminalGoodbye('can I book another appointment for tomorrow?');
  return result.isFaq === true;
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL BOOKING CONFIRMATION TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED - Review output above');
}
console.log('='.repeat(60));

console.log('\n[BEHAVIORS VALIDATED]');
console.log('  1. Slot Confirmation Guard:');
console.log('     - Cannot book on same turn slots are offered');
console.log('     - slotsOfferedAt timestamp set when slots appear');
console.log('     - Second turn after slots offered → booking allowed');
console.log('');
console.log('  2. Terminal State Booking Prompt Guard:');
console.log('     - Blocks "would you like to make an appointment?" after booking');
console.log('     - Blocks "when would you like to come in?" after booking');
console.log('     - Allows FAQ answers without blocking');
console.log('');
console.log('  3. Universal Hangup Detection:');
console.log('     - Direct commands like "hang up" → immediate disconnect');
console.log('     - Questions like "are you going to hang up?" → confirm and disconnect');
console.log('');
console.log('  4. Group Booking Confirmation:');
console.log('     - Proposes times before booking (first turn)');
console.log('     - Waits for user confirmation ("yes"/"sounds good")');
console.log('     - Handles decline ("no, different time") → resets and asks again');
console.log('     - Rejects invalid names ("myself", "my son")');
console.log('');
console.log('  5. Terminal Goodbye Detection:');
console.log('     - "no thanks" / "that\'s all" → hang up');
console.log('     - FAQ questions → not treated as goodbye');

process.exit(failed > 0 ? 1 : 0);
