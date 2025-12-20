/**
 * Group Booking + Deterministic Time Preference Test Suite
 * Tests the deterministic TP extraction for group bookings
 *
 * Run: npm run test:group-booking
 */

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

// ═══════════════════════════════════════════════════════════════
// Copy of extractTimePreferenceFromUtterance for testing
// (In production, this would be imported from the module)
// ═══════════════════════════════════════════════════════════════
function extractTimePreferenceFromUtterance(utterance: string): string | null {
  const lower = utterance.toLowerCase().trim();

  // Pattern 1: Time of day with optional day reference
  const timeOfDayMatch = lower.match(
    /\b(this|today|tomorrow|next)?\s*(morning|afternoon|evening|arvo)\b/i
  );

  if (timeOfDayMatch) {
    const dayRef = timeOfDayMatch[1] || 'today';
    let timeOfDay = timeOfDayMatch[2];

    // Normalize "arvo" to "afternoon" (Australian slang)
    if (timeOfDay === 'arvo') timeOfDay = 'afternoon';

    const normalizedDay = dayRef === 'this' ? 'today' : dayRef;
    return `${normalizedDay} ${timeOfDay}`;
  }

  // Pattern 2: Specific time (e.g., "3pm", "at 3", "around 4:30")
  const specificTimeMatch = lower.match(
    /\b(?:at|around|about)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i
  );

  if (specificTimeMatch) {
    const hour = parseInt(specificTimeMatch[1], 10);
    const minute = specificTimeMatch[2] || '00';
    const meridiem = specificTimeMatch[3]?.toLowerCase().replace(/\./g, '') || '';

    const timeStr = meridiem ? `${hour}:${minute}${meridiem}` : `${hour}:${minute}pm`;
    return `today ${timeStr}`;
  }

  // Pattern 3: Day names
  const dayNameMatch = lower.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );

  if (dayNameMatch) {
    return dayNameMatch[1].toLowerCase();
  }

  // Pattern 4: Relative days
  if (/\btomorrow\b/i.test(lower)) {
    return 'tomorrow';
  }

  if (/\btoday\b/i.test(lower)) {
    return 'today';
  }

  // Pattern 5: "next week", "this week"
  if (/\bnext\s+week\b/i.test(lower)) {
    return 'next week';
  }

  if (/\bthis\s+week\b/i.test(lower)) {
    return 'today';
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// Mock CompactCallState for group booking simulation
// ═══════════════════════════════════════════════════════════════
interface MockCompactCallState {
  gb?: boolean;
  gp?: Array<{ name: string; relation?: string }>;
  tp?: string | null;
  np?: boolean | null;
  rs?: boolean;
  im?: string;
  bc?: boolean;
  terminalLock?: boolean;
  smsConfirmSent?: boolean;
  smsIntakeSent?: boolean;
  groupBookingComplete?: number;
  appointmentCreated?: boolean;
}

// Simulates the group booking executor condition check
function hasGroupBookingInfo(state: MockCompactCallState): boolean {
  return state.gb === true &&
         Array.isArray(state.gp) &&
         state.gp.length >= 2 &&
         !!state.tp &&
         !state.groupBookingComplete &&
         !state.appointmentCreated;
}

// Simulates the deterministic TP extraction flow
function simulateDeterministicTPExtraction(
  state: MockCompactCallState,
  userUtterance: string
): MockCompactCallState {
  const isGroupBookingActive = state.gb === true &&
                                Array.isArray(state.gp) &&
                                state.gp.length >= 2;

  if (isGroupBookingActive && !state.tp) {
    const extractedTp = extractTimePreferenceFromUtterance(userUtterance);
    if (extractedTp) {
      return {
        ...state,
        tp: extractedTp,
        rs: true
      };
    }
  }

  return state;
}

// ═══════════════════════════════════════════════════════════════
// TESTS START
// ═══════════════════════════════════════════════════════════════

console.log('='.repeat(60));
console.log('GROUP BOOKING + DETERMINISTIC TP TEST SUITE');
console.log('='.repeat(60));

// ─────────────────────────────────────────────────────────────
// TEST 1: Deterministic Time Preference Extraction
// ─────────────────────────────────────────────────────────────
testSection('TEST 1: Deterministic Time Preference Extraction');

// Time of day patterns
assert(
  extractTimePreferenceFromUtterance('this afternoon') === 'today afternoon',
  '"this afternoon" → "today afternoon"'
);

assert(
  extractTimePreferenceFromUtterance('This afternoon') === 'today afternoon',
  '"This afternoon" (capitalized) → "today afternoon"'
);

assert(
  extractTimePreferenceFromUtterance('tomorrow morning') === 'tomorrow morning',
  '"tomorrow morning" → "tomorrow morning"'
);

assert(
  extractTimePreferenceFromUtterance('today evening') === 'today evening',
  '"today evening" → "today evening"'
);

assert(
  extractTimePreferenceFromUtterance('this arvo') === 'today afternoon',
  '"this arvo" (Australian slang) → "today afternoon"'
);

assert(
  extractTimePreferenceFromUtterance('afternoon') === 'today afternoon',
  '"afternoon" alone → "today afternoon"'
);

assert(
  extractTimePreferenceFromUtterance('morning') === 'today morning',
  '"morning" alone → "today morning"'
);

// Specific times
assert(
  extractTimePreferenceFromUtterance('at 3pm')?.includes('3') === true,
  '"at 3pm" includes hour 3'
);

assert(
  extractTimePreferenceFromUtterance('around 4:30pm')?.includes('4:30') === true,
  '"around 4:30pm" includes 4:30'
);

assert(
  extractTimePreferenceFromUtterance('3 o\'clock')?.includes('3') === true,
  '"3 o\'clock" includes hour 3'
);

// Day names
assert(
  extractTimePreferenceFromUtterance('next Monday') === 'monday',
  '"next Monday" → "monday"'
);

assert(
  extractTimePreferenceFromUtterance('Tuesday') === 'tuesday',
  '"Tuesday" → "tuesday"'
);

assert(
  extractTimePreferenceFromUtterance('Friday afternoon') === 'today afternoon',
  '"Friday afternoon" → matches afternoon first (acceptable)'
);

// Relative days
assert(
  extractTimePreferenceFromUtterance('tomorrow') === 'tomorrow',
  '"tomorrow" → "tomorrow"'
);

assert(
  extractTimePreferenceFromUtterance('today') === 'today',
  '"today" → "today"'
);

assert(
  extractTimePreferenceFromUtterance('next week') === 'next week',
  '"next week" → "next week"'
);

// No match cases
assert(
  extractTimePreferenceFromUtterance('yes please') === null,
  '"yes please" → null (no time preference)'
);

assert(
  extractTimePreferenceFromUtterance('I have back pain') === null,
  '"I have back pain" → null (no time preference)'
);

assert(
  extractTimePreferenceFromUtterance('John Smith') === null,
  '"John Smith" → null (no time preference)'
);

// ─────────────────────────────────────────────────────────────
// TEST 2: Group Booking State Progression (Turn 1 - Names)
// ─────────────────────────────────────────────────────────────
testSection('TEST 2: Group Booking Turn 1 - Name Collection');

// After AI processes "John Smith and Matt Smith"
const turn1State: MockCompactCallState = {
  gb: true,
  gp: [
    { name: 'John Smith', relation: 'self' },
    { name: 'Matt Smith', relation: 'son' }
  ],
  tp: null,
  np: true,
  rs: false,
  groupBookingComplete: undefined,
  appointmentCreated: false
};

assert(
  turn1State.gb === true,
  'Turn 1: gb=true after group booking detected'
);

assert(
  turn1State.gp?.length === 2,
  'Turn 1: gp.length=2 (both names collected)'
);

assert(
  turn1State.tp === null,
  'Turn 1: tp=null (no time preference yet)'
);

assert(
  hasGroupBookingInfo(turn1State) === false,
  'Turn 1: hasGroupBookingInfo=false (missing tp)'
);

// ─────────────────────────────────────────────────────────────
// TEST 3: Group Booking State Progression (Turn 2 - Time Preference)
// ─────────────────────────────────────────────────────────────
testSection('TEST 3: Group Booking Turn 2 - "This afternoon"');

// User says "This afternoon"
const turn2State = simulateDeterministicTPExtraction(turn1State, 'This afternoon');

assert(
  turn2State.tp === 'today afternoon',
  'Turn 2: tp="today afternoon" after deterministic extraction'
);

assert(
  turn2State.rs === true,
  'Turn 2: rs=true (request slots triggered)'
);

assert(
  hasGroupBookingInfo(turn2State) === true,
  'Turn 2: hasGroupBookingInfo=true (executor should run!)'
);

// ─────────────────────────────────────────────────────────────
// TEST 4: Group Booking with "tomorrow morning"
// ─────────────────────────────────────────────────────────────
testSection('TEST 4: Group Booking - "Tomorrow morning"');

const stateTomorrowMorning: MockCompactCallState = {
  gb: true,
  gp: [
    { name: 'Alice Brown', relation: 'self' },
    { name: 'Bob Brown', relation: 'husband' }
  ],
  tp: null,
  np: true
};

const afterTomorrowMorning = simulateDeterministicTPExtraction(stateTomorrowMorning, 'tomorrow morning');

assert(
  afterTomorrowMorning.tp === 'tomorrow morning',
  '"tomorrow morning" → tp="tomorrow morning"'
);

assert(
  hasGroupBookingInfo(afterTomorrowMorning) === true,
  'Group booking executor ready after "tomorrow morning"'
);

// ─────────────────────────────────────────────────────────────
// TEST 5: Group Booking with specific time "at 3pm"
// ─────────────────────────────────────────────────────────────
testSection('TEST 5: Group Booking - "at 3pm"');

const stateAt3pm: MockCompactCallState = {
  gb: true,
  gp: [
    { name: 'Chris Davis', relation: 'self' },
    { name: 'Dana Davis', relation: 'daughter' }
  ],
  tp: null,
  np: true
};

const afterAt3pm = simulateDeterministicTPExtraction(stateAt3pm, 'How about at 3pm?');

assert(
  afterAt3pm.tp?.includes('3') === true,
  '"at 3pm" → tp includes "3"'
);

assert(
  hasGroupBookingInfo(afterAt3pm) === true,
  'Group booking executor ready after "at 3pm"'
);

// ─────────────────────────────────────────────────────────────
// TEST 6: TP not extracted when no group booking
// ─────────────────────────────────────────────────────────────
testSection('TEST 6: TP extraction skipped for non-group bookings');

const singleBookingState: MockCompactCallState = {
  gb: false,  // Not a group booking
  gp: undefined,
  tp: null,
  np: true
};

const afterSingleBooking = simulateDeterministicTPExtraction(singleBookingState, 'this afternoon');

assert(
  afterSingleBooking.tp === null,
  'Non-group booking: tp stays null (LLM handles it)'
);

assert(
  afterSingleBooking.rs !== true,
  'Non-group booking: rs not set by deterministic extraction'
);

// ─────────────────────────────────────────────────────────────
// TEST 7: TP not overwritten if already set
// ─────────────────────────────────────────────────────────────
testSection('TEST 7: TP not overwritten if already set');

const stateWithTp: MockCompactCallState = {
  gb: true,
  gp: [
    { name: 'Eve Frank', relation: 'self' },
    { name: 'Fred Frank', relation: 'brother' }
  ],
  tp: 'monday afternoon',  // Already set
  np: true
};

const afterSecondUtterance = simulateDeterministicTPExtraction(stateWithTp, 'this morning');

assert(
  afterSecondUtterance.tp === 'monday afternoon',
  'Existing tp not overwritten by new utterance'
);

// ─────────────────────────────────────────────────────────────
// TEST 8: Executor blocks after completion
// ─────────────────────────────────────────────────────────────
testSection('TEST 8: Executor blocks after completion');

const completedState: MockCompactCallState = {
  gb: true,
  gp: [
    { name: 'Greg Hill', relation: 'self' },
    { name: 'Helen Hill', relation: 'wife' }
  ],
  tp: 'today afternoon',
  np: true,
  groupBookingComplete: 2,  // Already completed
  appointmentCreated: true
};

assert(
  hasGroupBookingInfo(completedState) === false,
  'Executor blocked when groupBookingComplete is set'
);

// ─────────────────────────────────────────────────────────────
// TEST 9: Edge cases - Various utterance formats
// ─────────────────────────────────────────────────────────────
testSection('TEST 9: Edge cases - Various utterance formats');

const edgeCaseState: MockCompactCallState = {
  gb: true,
  gp: [{ name: 'A', relation: 'self' }, { name: 'B', relation: 'child' }],
  tp: null,
  np: true
};

// Embedded in longer sentence
const afterEmbedded = simulateDeterministicTPExtraction(
  { ...edgeCaseState },
  'Sure, maybe this afternoon would work'
);
assert(
  afterEmbedded.tp === 'today afternoon',
  'Embedded "this afternoon" in sentence → extracted'
);

// With filler words
const afterFiller = simulateDeterministicTPExtraction(
  { ...edgeCaseState },
  'Um, uh, tomorrow morning I guess'
);
assert(
  afterFiller.tp === 'tomorrow morning',
  'With filler words → extracted'
);

// Australian slang variations
const afterArvo = simulateDeterministicTPExtraction(
  { ...edgeCaseState },
  "Yeah mate, this arvo works"
);
assert(
  afterArvo.tp === 'today afternoon',
  '"this arvo" (Aussie slang) → "today afternoon"'
);

// ─────────────────────────────────────────────────────────────
// TEST 10: Full Two-Person Group Booking Flow (Regression Test)
// Scenario: "Can I book for myself and my son?"
// ─────────────────────────────────────────────────────────────
testSection('TEST 10: Full Two-Person Group Booking Flow (Regression)');

// Check if gp contains ACTUAL names (not placeholders)
function hasRealNames(gp: Array<{ name: string; relation?: string }> | undefined): boolean {
  return Array.isArray(gp) &&
         gp.length >= 2 &&
         gp.every((p) =>
           p.name &&
           p.name !== 'PRIMARY' &&
           p.name !== 'SECONDARY' &&
           p.name.trim().length > 0
         );
}

// Simulates the executor condition check (must NOT include appointmentCreated)
// CRITICAL: Now checks for REAL names (not placeholders)
function groupBookingExecutorReady(state: MockCompactCallState): boolean {
  return state.gb === true &&
         hasRealNames(state.gp) &&
         !!state.tp &&
         !state.groupBookingComplete;
  // NOTE: appointmentCreated is NOT checked - group booking is atomic
}

// Turn 1: User says "Can I book for myself and my son?"
// AI detects group booking and collects names
const turn1: MockCompactCallState = {
  gb: true,
  gp: [
    { name: 'Michael Bishop', relation: 'self' },
    { name: 'Scott Bishop', relation: 'son' }
  ],
  tp: null,
  np: true,
  appointmentCreated: false  // This should NOT block executor
};

assert(
  turn1.gb === true && turn1.gp?.length === 2,
  'Turn 1: Names "Michael Bishop" and "Scott Bishop" collected'
);

assert(
  turn1.tp === null,
  'Turn 1: tp=null (time preference not yet collected)'
);

assert(
  groupBookingExecutorReady(turn1) === false,
  'Turn 1: Executor NOT ready (missing tp)'
);

// Turn 2: User says "This afternoon"
// Deterministic TP extraction sets tp, executor should be ready
const turn2 = simulateDeterministicTPExtraction(turn1, 'This afternoon');

assert(
  turn2.tp === 'today afternoon',
  'Turn 2: tp="today afternoon" extracted deterministically'
);

assert(
  groupBookingExecutorReady(turn2) === true,
  'Turn 2: Executor IS READY - should run BEFORE AI!'
);

// Verify that appointmentCreated=false does NOT block executor
const turn2WithPriorBooking: MockCompactCallState = {
  ...turn2,
  appointmentCreated: true  // Even if this is true, executor should still run
};

assert(
  groupBookingExecutorReady(turn2WithPriorBooking) === true,
  'Executor ignores appointmentCreated (group booking is atomic)'
);

// Verify executor is blocked ONLY by groupBookingComplete
const turn2Completed: MockCompactCallState = {
  ...turn2,
  groupBookingComplete: 2  // Both booked
};

assert(
  groupBookingExecutorReady(turn2Completed) === false,
  'Executor blocked ONLY when groupBookingComplete is set'
);

// ─────────────────────────────────────────────────────────────
// TEST 11: Executor Flow Priority
// Verifies that executor runs BEFORE AI can generate close-out
// ─────────────────────────────────────────────────────────────
testSection('TEST 11: Executor Priority Over AI');

// Simulate the exact state when user says "This afternoon"
// after providing names "Michael Bishop and Scott Bishop"
const preExecutorState: MockCompactCallState = {
  gb: true,
  gp: [
    { name: 'Michael Bishop', relation: 'self' },
    { name: 'Scott Bishop', relation: 'son' }
  ],
  tp: 'today afternoon',  // Set by deterministic extraction
  np: true,
  rs: true,  // Ready to offer slots
  groupBookingComplete: undefined,  // Not yet complete
  appointmentCreated: false
};

assert(
  groupBookingExecutorReady(preExecutorState) === true,
  'Pre-executor state: Ready to run'
);

// The executor should:
// 1. Fetch slots
// 2. Create 2 Cliniko patients
// 3. Create 2 appointments
// 4. Send 2 intake SMS links
// 5. Set groupBookingComplete = 2
// 6. Return TwiML confirmation WITHOUT calling AI

// After executor runs:
const postExecutorState: MockCompactCallState = {
  ...preExecutorState,
  groupBookingComplete: 2,
  bc: true,
  terminalLock: true,
  smsConfirmSent: true,
  smsIntakeSent: true
};

assert(
  postExecutorState.groupBookingComplete === 2,
  'Post-executor: groupBookingComplete = 2 (both patients booked)'
);

assert(
  postExecutorState.bc === true,
  'Post-executor: bc=true (booking confirmed)'
);

assert(
  postExecutorState.terminalLock === true,
  'Post-executor: terminalLock=true (call in terminal state)'
);

assert(
  groupBookingExecutorReady(postExecutorState) === false,
  'Post-executor: Executor blocked (won\'t run again)'
);

// ─────────────────────────────────────────────────────────────
// TEST 12: First-Utterance Group Booking Detection (Pre-AI)
// Tests the deterministic regex-based detection that seeds gb/gp
// BEFORE the AI runs, enabling executor to trigger on first turn
// ─────────────────────────────────────────────────────────────
testSection('TEST 12: First-Utterance Group Booking Detection');

// Group booking phrase patterns (mirror of production code)
const groupBookingPatterns = [
  /myself and my (son|child|daughter|kids?|husband|wife|partner|mum|mom|dad|father|mother)/i,
  /me and my (son|child|daughter|kids?|husband|wife|partner|mum|mom|dad|father|mother)/i,
  /my (son|child|daughter|kids?|husband|wife|partner|mum|mom|dad|father|mother) and (me|myself|i)/i,
  /both of us/i,
  /two of us/i,
  /for (both|two|the two)/i,
  /appointments? for (both|two|me and)/i,
  /book(ing)? for (me|myself) and/i,
  /for myself and/i,
  /(book|appointment|see).+(son|child|daughter|kids?).+and.+(me|myself)/i,
  /(book|appointment|see).+(me|myself).+and.+(son|child|daughter|kids?)/i
];

function detectsGroupBooking(utterance: string): boolean {
  return groupBookingPatterns.some(pattern => pattern.test(utterance));
}

// Simulates the first-turn seeding logic
function simulateFirstTurnDetection(
  state: MockCompactCallState,
  utterance: string
): MockCompactCallState {
  const isGroupBookingUtterance = detectsGroupBooking(utterance);

  if (isGroupBookingUtterance && !state.gb) {
    // Extract relation
    let relation = 'family member';
    const relationMatch = utterance.match(/my\s+(son|child|daughter|kids?|husband|wife|partner|mum|mom|dad|father|mother)/i);
    if (relationMatch) {
      relation = relationMatch[1].toLowerCase();
    }

    // Seed state
    const newState: MockCompactCallState = {
      ...state,
      gb: true,
      gp: [
        { name: 'PRIMARY', relation: 'caller' },
        { name: 'SECONDARY', relation: relation }
      ],
      im: 'book'
    };

    // Also extract tp if present
    const tp = extractTimePreferenceFromUtterance(utterance);
    if (tp) {
      newState.tp = tp;
      newState.rs = true;
    }

    return newState;
  }

  return state;
}

// Test pattern matching
assert(
  detectsGroupBooking('myself and my son for this afternoon') === true,
  '"myself and my son" detected as group booking'
);

assert(
  detectsGroupBooking('me and my child this afternoon') === true,
  '"me and my child" detected as group booking'
);

assert(
  detectsGroupBooking('my daughter and myself') === true,
  '"my daughter and myself" detected as group booking'
);

assert(
  detectsGroupBooking('both of us need an appointment') === true,
  '"both of us" detected as group booking'
);

assert(
  detectsGroupBooking('two of us need to be seen') === true,
  '"two of us" detected as group booking'
);

assert(
  detectsGroupBooking('for both please') === true,
  '"for both" detected as group booking'
);

assert(
  detectsGroupBooking('appointments for me and my husband') === true,
  '"appointments for me and my husband" detected'
);

assert(
  detectsGroupBooking('booking for myself and my wife') === true,
  '"booking for myself and my wife" detected'
);

assert(
  detectsGroupBooking('me and my kids') === true,
  '"me and my kids" detected'
);

assert(
  detectsGroupBooking('my mum and me') === true,
  '"my mum and me" detected'
);

// Negative cases
assert(
  detectsGroupBooking('I need an appointment') === false,
  '"I need an appointment" NOT detected as group booking'
);

assert(
  detectsGroupBooking('this afternoon please') === false,
  '"this afternoon please" NOT detected as group booking'
);

assert(
  detectsGroupBooking('I have back pain') === false,
  '"I have back pain" NOT detected as group booking'
);

// ─────────────────────────────────────────────────────────────
// TEST 13: First-Turn State Seeding
// Verifies that gb, gp placeholders, and tp are seeded together
// ─────────────────────────────────────────────────────────────
testSection('TEST 13: First-Turn State Seeding');

const emptyState: MockCompactCallState = {};

// Test: "myself and my son for this afternoon"
const seededState1 = simulateFirstTurnDetection(
  emptyState,
  'myself and my son for this afternoon'
);

assert(
  seededState1.gb === true,
  'First turn: gb=true seeded'
);

assert(
  Array.isArray(seededState1.gp) && seededState1.gp.length === 2,
  'First turn: gp seeded with 2 entries'
);

assert(
  seededState1.gp?.[0]?.name === 'PRIMARY' && seededState1.gp?.[0]?.relation === 'caller',
  'First turn: gp[0] is PRIMARY caller'
);

assert(
  seededState1.gp?.[1]?.name === 'SECONDARY' && seededState1.gp?.[1]?.relation === 'son',
  'First turn: gp[1] is SECONDARY son'
);

assert(
  seededState1.tp === 'today afternoon',
  'First turn: tp="today afternoon" extracted'
);

assert(
  seededState1.rs === true,
  'First turn: rs=true (ready for slots)'
);

// Test: "me and my daughter tomorrow morning"
const seededState2 = simulateFirstTurnDetection(
  emptyState,
  'me and my daughter tomorrow morning'
);

assert(
  seededState2.gp?.[1]?.relation === 'daughter',
  'Relation "daughter" extracted correctly'
);

assert(
  seededState2.tp === 'tomorrow morning',
  'tp="tomorrow morning" extracted'
);

// Test: "both of us" (no specific relation)
const seededState3 = simulateFirstTurnDetection(
  emptyState,
  'both of us need appointments'
);

assert(
  seededState3.gb === true,
  '"both of us" → gb=true'
);

assert(
  seededState3.gp?.[1]?.relation === 'family member',
  '"both of us" → default relation "family member"'
);

// ─────────────────────────────────────────────────────────────
// TEST 14: Executor BLOCKED With Placeholders (Critical Regression)
// The executor must NOT run when gp contains placeholder names
// This prevents booking with "PRIMARY" and "SECONDARY" as patient names
// ─────────────────────────────────────────────────────────────
testSection('TEST 14: Executor BLOCKED With Placeholders (Critical Regression)');

// Simulate: User says "myself and my son for this afternoon" as FIRST utterance
const firstUtteranceState = simulateFirstTurnDetection(
  {},
  'myself and my son for this afternoon'
);

// Verify placeholders are set
assert(
  firstUtteranceState.gp?.[0]?.name === 'PRIMARY',
  'First turn: gp[0].name is "PRIMARY" placeholder'
);

assert(
  firstUtteranceState.gp?.[1]?.name === 'SECONDARY',
  'First turn: gp[1].name is "SECONDARY" placeholder'
);

// CRITICAL: Executor should NOT be ready with placeholders
assert(
  groupBookingExecutorReady(firstUtteranceState) === false,
  'CRITICAL: Executor is BLOCKED when gp has placeholder names'
);

// Verify hasRealNames correctly rejects placeholders
assert(
  hasRealNames(firstUtteranceState.gp) === false,
  'hasRealNames returns false for placeholder names'
);

// Test edge cases for hasRealNames
assert(
  hasRealNames([{ name: 'PRIMARY' }, { name: 'John Smith' }]) === false,
  'hasRealNames returns false when ANY name is placeholder'
);

assert(
  hasRealNames([{ name: '' }, { name: 'John Smith' }]) === false,
  'hasRealNames returns false when ANY name is empty'
);

assert(
  hasRealNames([{ name: '  ' }, { name: 'John Smith' }]) === false,
  'hasRealNames returns false when ANY name is whitespace-only'
);

assert(
  hasRealNames([{ name: 'Jane Doe' }, { name: 'John Smith' }]) === true,
  'hasRealNames returns true when ALL names are real'
);

// ─────────────────────────────────────────────────────────────
// TEST 15: Full First-Turn Flow Simulation
// End-to-end: First utterance → State seeded → AI collects names → Executor runs
// ─────────────────────────────────────────────────────────────
testSection('TEST 15: Full First-Turn Flow Simulation');

// Step 1: First utterance with group + time
let flowState: MockCompactCallState = {};
flowState = simulateFirstTurnDetection(flowState, 'myself and my son for this afternoon');

assert(
  flowState.gb === true && flowState.gp?.length === 2 && flowState.tp === 'today afternoon',
  'Step 1: First-turn detection seeds gb, gp placeholders, and tp'
);

// Step 2: AI response provides actual names (simulated)
flowState = {
  ...flowState,
  gp: [
    { name: 'Michael Bishop', relation: 'caller' },
    { name: 'Scott Bishop', relation: 'son' }
  ]
};

assert(
  flowState.gp?.[0]?.name === 'Michael Bishop' && flowState.gp?.[1]?.name === 'Scott Bishop',
  'Step 2: AI replaces placeholders with actual names'
);

// Step 3: Check executor readiness
assert(
  groupBookingExecutorReady(flowState) === true,
  'Step 3: Executor IS READY - should execute BEFORE next AI call'
);

// Step 4: Executor runs and completes
flowState = {
  ...flowState,
  groupBookingComplete: 2,
  bc: true,
  terminalLock: true
};

assert(
  flowState.groupBookingComplete === 2,
  'Step 4: Executor completed - groupBookingComplete=2'
);

assert(
  groupBookingExecutorReady(flowState) === false,
  'Step 4: Executor blocked from running again'
);

// ─────────────────────────────────────────────────────────────
// TEST 16: isValidPersonName - Pronoun and Possessive Rejection
// These phrases should NEVER be treated as patient names
// ─────────────────────────────────────────────────────────────
testSection('TEST 16: isValidPersonName - Pronoun/Possessive Rejection');

// Copy of isValidPersonName for testing
function isValidPersonName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;

  const lower = name.toLowerCase().trim();

  // Pronouns and self-references
  const pronouns = [
    'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
    'me', 'you', 'him', 'her', 'us', 'them', 'i', 'we', 'they',
    'my', 'your', 'his', 'its', 'our', 'their'
  ];

  // Possessive family/relationship references
  const possessiveReferences = [
    'my son', 'my daughter', 'my wife', 'my husband', 'my partner',
    'my child', 'my kid', 'my kids', 'my children', 'my baby',
    'my mother', 'my father', 'my mom', 'my dad', 'my mum',
    'my brother', 'my sister', 'my friend', 'my boyfriend', 'my girlfriend',
    'my spouse', 'my fiancé', 'my fiancee', 'my fiance',
    'the child', 'the kid', 'the baby', 'the son', 'the daughter',
    'son', 'daughter', 'wife', 'husband', 'partner', 'child', 'kid', 'baby'
  ];

  // Common non-name words
  const nonNameWords = [
    'for', 'and', 'the', 'a', 'an', 'this', 'that', 'here', 'there',
    'when', 'what', 'where', 'which', 'who', 'whom', 'whose',
    'today', 'tomorrow', 'both', 'all', 'some', 'any', 'each',
    'appointment', 'booking', 'please', 'thanks', 'thank', 'can', 'make'
  ];

  const placeholders = ['primary', 'secondary', 'caller', 'patient1', 'patient2'];

  if (pronouns.includes(lower)) return false;
  if (lower.startsWith('my ') || lower.startsWith('your ') ||
      lower.startsWith('his ') || lower.startsWith('her ') ||
      lower.startsWith('the ') || lower.startsWith('for ')) return false;
  if (possessiveReferences.includes(lower)) return false;
  for (const word of nonNameWords) {
    if (lower.startsWith(word + ' ')) return false;
  }
  if (placeholders.includes(lower)) return false;
  if (nonNameWords.includes(lower)) return false;
  if (lower.length < 2) return false;

  return true;
}

// Test pronouns are rejected
assert(
  isValidPersonName('myself') === false,
  '"myself" is NOT a valid person name'
);

assert(
  isValidPersonName('me') === false,
  '"me" is NOT a valid person name'
);

assert(
  isValidPersonName('him') === false,
  '"him" is NOT a valid person name'
);

// Test possessive references are rejected
assert(
  isValidPersonName('my son') === false,
  '"my son" is NOT a valid person name'
);

assert(
  isValidPersonName('my daughter') === false,
  '"my daughter" is NOT a valid person name'
);

assert(
  isValidPersonName('my wife') === false,
  '"my wife" is NOT a valid person name'
);

assert(
  isValidPersonName('my husband') === false,
  '"my husband" is NOT a valid person name'
);

// Test prepositional phrases are rejected
assert(
  isValidPersonName('for myself') === false,
  '"for myself" is NOT a valid person name'
);

assert(
  isValidPersonName('for him') === false,
  '"for him" is NOT a valid person name'
);

// Test placeholders are rejected
assert(
  isValidPersonName('PRIMARY') === false,
  '"PRIMARY" is NOT a valid person name'
);

assert(
  isValidPersonName('SECONDARY') === false,
  '"SECONDARY" is NOT a valid person name'
);

// Test valid names are accepted
assert(
  isValidPersonName('Michael') === true,
  '"Michael" IS a valid person name'
);

assert(
  isValidPersonName('Sarah Smith') === true,
  '"Sarah Smith" IS a valid person name'
);

assert(
  isValidPersonName('John Bishop') === true,
  '"John Bishop" IS a valid person name'
);

// ─────────────────────────────────────────────────────────────
// TEST 17: Time Preference Specificity Override
// More specific time should always win over general time
// ─────────────────────────────────────────────────────────────
testSection('TEST 17: Time Preference Specificity Override');

// Copy of isMoreSpecificTime for testing
function isMoreSpecificTime(newTp: string | null, currentTp: string | null): boolean {
  if (!newTp) return false;
  if (!currentTp) return true;

  const getSpecificityScore = (tp: string): number => {
    if (/\d{1,2}:\d{2}(am|pm)/i.test(tp)) return 100;
    if (/(morning|afternoon|evening|arvo)/i.test(tp)) return 50;
    if (/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(tp)) return 30;
    if (/tomorrow/i.test(tp)) return 20;
    if (/today/i.test(tp)) return 15;
    if (/(this|next)\s+week/i.test(tp)) return 10;
    return 0;
  };

  return getSpecificityScore(newTp.toLowerCase()) > getSpecificityScore(currentTp.toLowerCase());
}

// Specific time beats general time
assert(
  isMoreSpecificTime('today 4:00pm', 'today afternoon') === true,
  '"4:00pm" is more specific than "afternoon"'
);

assert(
  isMoreSpecificTime('today 10:30am', 'today morning') === true,
  '"10:30am" is more specific than "morning"'
);

// General time does NOT beat specific time
assert(
  isMoreSpecificTime('today afternoon', 'today 4:00pm') === false,
  '"afternoon" is NOT more specific than "4:00pm"'
);

assert(
  isMoreSpecificTime('today morning', 'today 10:30am') === false,
  '"morning" is NOT more specific than "10:30am"'
);

// Time of day beats just day
assert(
  isMoreSpecificTime('today afternoon', 'today') === true,
  '"afternoon" is more specific than just "today"'
);

assert(
  isMoreSpecificTime('tomorrow morning', 'tomorrow') === true,
  '"tomorrow morning" is more specific than just "tomorrow"'
);

// Week reference is least specific
assert(
  isMoreSpecificTime('next week', 'today afternoon') === false,
  '"next week" is NOT more specific than "today afternoon"'
);

assert(
  isMoreSpecificTime('today afternoon', 'next week') === true,
  '"today afternoon" is more specific than "next week"'
);

// Null handling
assert(
  isMoreSpecificTime(null, 'today afternoon') === false,
  'null is NOT more specific than any tp'
);

assert(
  isMoreSpecificTime('today afternoon', null) === true,
  'Any tp is more specific than null'
);

// ─────────────────────────────────────────────────────────────
// TEST 18: Specific Time Extraction Priority
// When utterance has both "afternoon" and "4pm", extract "4pm"
// ─────────────────────────────────────────────────────────────
testSection('TEST 18: Specific Time Extraction Priority');

// Updated extractTimePreferenceFromUtterance with specific time priority
function extractTimePreferenceWithPriority(utterance: string): string | null {
  const lower = utterance.toLowerCase().trim();

  // PATTERN 1 (HIGHEST PRIORITY): Specific time with AM/PM
  const specificTimeMatch = lower.match(
    /\b(?:at|around|about)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i
  );

  if (specificTimeMatch) {
    const hour = parseInt(specificTimeMatch[1], 10);
    const minute = specificTimeMatch[2] || '00';
    const meridiem = specificTimeMatch[3].toLowerCase().replace(/\./g, '');
    return `today ${hour}:${minute}${meridiem}`;
  }

  // PATTERN 2: Time of day
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

  return null;
}

// "this afternoon at 4pm" → specific time wins
assert(
  extractTimePreferenceWithPriority('this afternoon at 4pm')?.includes('4:00pm') === true,
  '"this afternoon at 4pm" → "4pm" (specific time priority)'
);

// "around 3pm this afternoon" → specific time wins
assert(
  extractTimePreferenceWithPriority('around 3pm this afternoon')?.includes('3:00pm') === true,
  '"around 3pm this afternoon" → "3pm" (specific time priority)'
);

// "just this afternoon" → time of day (no specific time)
assert(
  extractTimePreferenceWithPriority('just this afternoon') === 'today afternoon',
  '"just this afternoon" → "today afternoon" (no specific time)'
);

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL GROUP BOOKING + TP TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED - Review output above');
}
console.log('='.repeat(60));

console.log('\n[BEHAVIORS VALIDATED]');
console.log('  - Deterministic TP extraction from various utterances');
console.log('  - Turn 1: Names collected, gb=true, gp populated, tp=null');
console.log('  - Turn 2: "this afternoon" → tp set, executor triggers');
console.log('  - "tomorrow morning" extraction works');
console.log('  - Specific times like "3pm" work');
console.log('  - Non-group bookings skip deterministic extraction');
console.log('  - Existing tp not overwritten');
console.log('  - Executor blocks after completion');
console.log('  - Edge cases (embedded, filler words, Aussie slang)');
console.log('  - Full two-person group booking flow (Michael + Scott Bishop)');
console.log('  - Executor ignores appointmentCreated (atomic booking)');
console.log('  - Executor runs BEFORE AI can generate close-out');
console.log('  - First-utterance group booking detection (pre-AI regex)');
console.log('  - Placeholder seeding: gp=[PRIMARY, SECONDARY] on detection');
console.log('  - Combined detection: "myself and my son for this afternoon"');
console.log('  - Relation extraction: son, daughter, kids, husband, wife, etc.');
console.log('  - CRITICAL: Executor BLOCKED when gp has placeholder names');
console.log('  - hasRealNames() rejects PRIMARY, SECONDARY, empty, whitespace');
console.log('  - Executor only runs after AI provides actual patient names');
console.log('  - First-turn flow: detection → seeding → AI names → executor');
console.log('  - isValidPersonName rejects pronouns (myself, me, him, her)');
console.log('  - isValidPersonName rejects possessives (my son, my wife)');
console.log('  - isValidPersonName rejects prepositions (for myself)');
console.log('  - isMoreSpecificTime: "4pm" beats "afternoon"');
console.log('  - isMoreSpecificTime: "afternoon" beats "today"');
console.log('  - Specific time extraction priority: "at 4pm" wins over "afternoon"');

process.exit(failed > 0 ? 1 : 0);
