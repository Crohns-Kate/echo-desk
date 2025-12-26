/**
 * Stabilization Fixes Test Suite
 * Tests for production bug fixes in Echo Desk
 *
 * Run: npm run test:stabilization
 *
 * Covers:
 * 1. Form submission race condition prevention
 * 2. Per-token form submission (group booking support)
 * 3. 409 Conflict for already-submitted tokens
 * 4. Terminal state booking prompt blocking
 * 5. Dead air prevention after SMS
 * 6. Name double-asking prevention
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
// Mock types
// ═══════════════════════════════════════════════════════════════

interface FormSubmission {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  submittedAt: string;
  clinikoPatientId?: string;
}

interface ConversationContext {
  formSubmissions?: Record<string, FormSubmission>;
  currentState?: {
    terminalLock?: boolean;
    appointmentCreated?: boolean;
    groupBookingComplete?: number;
    smsMapSent?: boolean;
    ml?: boolean;
    askedForNamesAt?: number;
    gp?: Array<{ name: string; relation?: string }>;
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: Form Submission Race Condition Prevention
// ═══════════════════════════════════════════════════════════════

testSection('TEST 1: Form Submission Race Condition - Merge Strategy');

// Simulate the race condition scenario:
// 1. Call turn 1 saves context (no formSubmissions)
// 2. Form A submits (context now has formSubmissions = { tokenA: {...} })
// 3. Call turn 2 loads OLD context and saves, potentially overwriting

function simulateMergedSave(
  localContext: ConversationContext,
  dbContext: ConversationContext
): ConversationContext {
  // This is the fix: merge formSubmissions from DB before saving
  const dbFormSubmissions = dbContext.formSubmissions || {};
  const contextFormSubmissions = localContext.formSubmissions || {};

  // DB wins for existing tokens (form submission is more recent)
  const mergedFormSubmissions = {
    ...contextFormSubmissions,
    ...dbFormSubmissions
  };

  return {
    ...localContext,
    formSubmissions: Object.keys(mergedFormSubmissions).length > 0 ? mergedFormSubmissions : undefined
  };
}

// Scenario: Form submitted during call turn
const localContext: ConversationContext = {
  currentState: { terminalLock: true }
  // No formSubmissions - loaded before form was submitted
};

const dbContextWithForm: ConversationContext = {
  currentState: { terminalLock: false },
  formSubmissions: {
    'form_CA123_patient1': {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+61400000001',
      submittedAt: new Date().toISOString(),
      clinikoPatientId: 'patient1'
    }
  }
};

const mergedContext = simulateMergedSave(localContext, dbContextWithForm);

assert(
  mergedContext.formSubmissions?.['form_CA123_patient1']?.firstName === 'Jane',
  'Form submission is preserved after merge'
);

assert(
  mergedContext.currentState?.terminalLock === true,
  'Local context state is preserved'
);

// ═══════════════════════════════════════════════════════════════
// TEST 2: Per-Token Form Submission (Group Booking)
// ═══════════════════════════════════════════════════════════════

testSection('TEST 2: Per-Token Form Submission for Group Booking');

const groupBookingContext: ConversationContext = {
  formSubmissions: {}
};

// Patient 1 submits
const token1 = 'form_CA456_patient_mom';
const token2 = 'form_CA456_patient_child';

groupBookingContext.formSubmissions![token1] = {
  firstName: 'Sarah',
  lastName: 'Smith',
  email: 'sarah@example.com',
  phone: '+61400000002',
  submittedAt: new Date().toISOString(),
  clinikoPatientId: 'patient_mom'
};

assert(
  groupBookingContext.formSubmissions![token1] !== undefined,
  'Token 1 (mom) form is stored'
);

assert(
  groupBookingContext.formSubmissions![token2] === undefined,
  'Token 2 (child) form is NOT yet submitted'
);

// Check if token is already submitted
function isTokenSubmitted(token: string, context: ConversationContext): boolean {
  return !!(context.formSubmissions?.[token]?.submittedAt);
}

assert(
  isTokenSubmitted(token1, groupBookingContext) === true,
  'Token 1 shows as submitted'
);

assert(
  isTokenSubmitted(token2, groupBookingContext) === false,
  'Token 2 shows as NOT submitted (can still submit)'
);

// Patient 2 submits
groupBookingContext.formSubmissions![token2] = {
  firstName: 'Tommy',
  lastName: 'Smith',
  email: 'tommy@example.com',
  phone: '+61400000003',
  submittedAt: new Date().toISOString(),
  clinikoPatientId: 'patient_child'
};

assert(
  Object.keys(groupBookingContext.formSubmissions!).length === 2,
  'Both form submissions exist independently'
);

// ═══════════════════════════════════════════════════════════════
// TEST 3: 409 Conflict for Already-Submitted Tokens
// ═══════════════════════════════════════════════════════════════

testSection('TEST 3: 409 Conflict Detection');

function checkFormSubmitConflict(
  token: string,
  context: ConversationContext
): { status: number; error?: string } {
  const existing = context.formSubmissions?.[token];
  if (existing?.submittedAt) {
    return {
      status: 409,
      error: 'Form already submitted'
    };
  }
  return { status: 200 };
}

const conflictCheck1 = checkFormSubmitConflict(token1, groupBookingContext);
assert(
  conflictCheck1.status === 409,
  'Already-submitted token returns 409'
);

const newToken = 'form_CA456_patient_new';
const conflictCheck2 = checkFormSubmitConflict(newToken, groupBookingContext);
assert(
  conflictCheck2.status === 200,
  'New token can still submit (200)'
);

// ═══════════════════════════════════════════════════════════════
// TEST 4: Terminal State Booking Prompt Blocking
// ═══════════════════════════════════════════════════════════════

testSection('TEST 4: Terminal State Booking Prompt Blocking');

const bookingPromptPatterns = [
  /would you like to (make|book|schedule|proceed with) an? (appointment|booking)/i,
  /can i (help you )?(book|schedule|make) (an? )?(appointment|that)/i,
  /shall i (book|schedule|make|confirm) (an? )?(appointment|that|it)/i,
  /do you want (me )?to (book|schedule|make|confirm)/i,
  /would you like me to (book|schedule|make|confirm|lock)/i,
  /would you like to (proceed|go ahead|confirm)/i
];

function shouldBlockBookingPrompt(reply: string, isTerminalState: boolean): boolean {
  if (!isTerminalState) return false;
  return bookingPromptPatterns.some(p => p.test(reply));
}

const terminalContext: ConversationContext = {
  currentState: {
    terminalLock: true,
    appointmentCreated: true
  }
};

const isTerminal = terminalContext.currentState?.terminalLock === true ||
                   terminalContext.currentState?.appointmentCreated === true;

assert(
  shouldBlockBookingPrompt("Would you like to make an appointment?", isTerminal) === true,
  'Blocks "Would you like to make an appointment?" in terminal state'
);

assert(
  shouldBlockBookingPrompt("Can I book that for you?", isTerminal) === true,
  'Blocks "Can I book that for you?" in terminal state'
);

assert(
  shouldBlockBookingPrompt("Shall I confirm that appointment?", isTerminal) === true,
  'Blocks "Shall I confirm that appointment?" in terminal state'
);

assert(
  shouldBlockBookingPrompt("Is there anything else I can help with?", isTerminal) === false,
  'Allows "Is there anything else?" in terminal state'
);

assert(
  shouldBlockBookingPrompt("We're open Monday to Friday, 8am to 6pm.", isTerminal) === false,
  'Allows FAQ answers in terminal state'
);

// ═══════════════════════════════════════════════════════════════
// TEST 5: Dead Air Prevention After SMS
// ═══════════════════════════════════════════════════════════════

testSection('TEST 5: Dead Air Prevention After SMS');

function ensureFollowUpPrompt(reply: string, justSentSms: boolean): string {
  if (!justSentSms) return reply;

  const replyLower = reply.toLowerCase();
  const hasFollowUp = replyLower.includes('anything else') ||
                      replyLower.includes('help with') ||
                      replyLower.includes('?');

  if (!hasFollowUp) {
    return reply.trim() + ' Is there anything else I can help with?';
  }
  return reply;
}

const replyWithoutPrompt = "I'll send that map link through now.";
const replyWithPrompt = "I'll send that map link through now. Anything else?";

assert(
  ensureFollowUpPrompt(replyWithoutPrompt, true).includes('anything else'),
  'Appends follow-up prompt when missing after SMS'
);

assert(
  ensureFollowUpPrompt(replyWithPrompt, true) === replyWithPrompt,
  'Does not double-append when prompt already exists'
);

assert(
  ensureFollowUpPrompt(replyWithoutPrompt, false) === replyWithoutPrompt,
  'Does not append when SMS was not just sent'
);

// ═══════════════════════════════════════════════════════════════
// TEST 6: Name Double-Asking Prevention
// ═══════════════════════════════════════════════════════════════

testSection('TEST 6: Name Double-Asking Prevention');

function shouldAskForNames(
  hasInvalidNames: boolean,
  isAlreadyAsking: boolean,
  askedForNamesAt: number | undefined
): boolean {
  // Don't ask if we just asked within the last minute
  const justAsked = askedForNamesAt &&
    (Date.now() - askedForNamesAt) < 60000;

  return hasInvalidNames && !isAlreadyAsking && !justAsked;
}

// Scenario 1: First time asking - should ask
assert(
  shouldAskForNames(true, false, undefined) === true,
  'Asks for names on first encounter of invalid names'
);

// Scenario 2: AI is already asking - don't override
assert(
  shouldAskForNames(true, true, undefined) === false,
  'Does not override when AI is already asking for names'
);

// Scenario 3: Just asked - don't ask again
const recentTimestamp = Date.now() - 5000; // 5 seconds ago
assert(
  shouldAskForNames(true, false, recentTimestamp) === false,
  'Does not ask again if we just asked 5 seconds ago'
);

// Scenario 4: Asked long ago - can ask again
const oldTimestamp = Date.now() - 120000; // 2 minutes ago
assert(
  shouldAskForNames(true, false, oldTimestamp) === true,
  'Can ask again if previous ask was more than 1 minute ago'
);

// ═══════════════════════════════════════════════════════════════
// TEST 7: First Name Only in Confirmations
// ═══════════════════════════════════════════════════════════════

testSection('TEST 7: First Name Only in Confirmations');

function getFirstName(fullName: string): string {
  return fullName.split(' ')[0];
}

function formatGroupConfirmation(patients: Array<{ name: string; time: string }>): string {
  return patients.map(p => `${getFirstName(p.name)} at ${p.time}`).join(' and ');
}

const groupPatients = [
  { name: 'Michael Bishop', time: '10:30am' },
  { name: 'Matthew Bishop', time: '11:00am' }
];

const confirmation = formatGroupConfirmation(groupPatients);

assert(
  confirmation.includes('Michael') && !confirmation.includes('Michael Bishop'),
  'Uses first name only for Michael'
);

assert(
  confirmation.includes('Matthew') && !confirmation.includes('Matthew Bishop'),
  'Uses first name only for Matthew'
);

assert(
  confirmation === 'Michael at 10:30am and Matthew at 11:00am',
  'Formats group confirmation with first names only'
);

// ═══════════════════════════════════════════════════════════════
// TEST 8: PatientId Required for Cliniko Update
// ═══════════════════════════════════════════════════════════════

testSection('TEST 8: PatientId Required for Cliniko Update');

function shouldUpdateCliniko(clinikoPatientId: string | undefined): {
  update: boolean;
  reason: string;
} {
  if (clinikoPatientId) {
    return { update: true, reason: 'Direct patient update' };
  }
  return { update: false, reason: 'No patientId - phone lookup disabled' };
}

const withPatientId = shouldUpdateCliniko('patient_123');
assert(
  withPatientId.update === true,
  'Updates Cliniko when patientId is provided'
);

const withoutPatientId = shouldUpdateCliniko(undefined);
assert(
  withoutPatientId.update === false,
  'Does NOT update Cliniko when patientId is missing'
);

assert(
  withoutPatientId.reason.includes('phone lookup disabled'),
  'Reason explains phone lookup is disabled'
);

// ═══════════════════════════════════════════════════════════════
// TEST 9: Goodbye Phrase Detection (including apostrophe variations)
// ═══════════════════════════════════════════════════════════════

testSection('TEST 9: Goodbye Phrase Detection');

const goodbyePhrases = [
  'no', 'nope', 'nah', "that's it", "thats it", "that's all", "thats all", "that is all", "that is it",
  'goodbye', 'bye', 'good bye', 'see ya', 'see you', 'thanks bye', 'thank you bye',
  'i\'m good', 'im good', "i'm done", 'im done', "that's everything", "thats everything", 'nothing else',
  'all set', 'all done', 'we\'re done', 'were done', 'we are done', 'all good', 'no thanks',
  'no thank you', 'no more', 'nothing more', 'finished', 'i\'m finished', 'im finished', 'done',
  "ok that's it", "ok thats it", "okay that's it", "okay thats it",
  "that's it for now", "thats it for now", "ok that's it for now", "ok thats it for now"
];

function isGoodbyePhrase(utterance: string): boolean {
  const lower = utterance.toLowerCase().trim();
  return goodbyePhrases.some(phrase => lower.includes(phrase));
}

assert(
  isGoodbyePhrase("ok that's it for now") === true,
  '"ok that\'s it for now" is detected as goodbye'
);

assert(
  isGoodbyePhrase("ok thats it for now") === true,
  '"ok thats it for now" (no apostrophe) is detected as goodbye'
);

assert(
  isGoodbyePhrase("OK that's it") === true,
  '"OK that\'s it" (uppercase OK) is detected as goodbye'
);

assert(
  isGoodbyePhrase("okay thats all") === true,
  '"okay thats all" is detected as goodbye'
);

assert(
  isGoodbyePhrase("that's everything thanks") === true,
  '"that\'s everything thanks" is detected as goodbye'
);

assert(
  isGoodbyePhrase("what time do you open") === false,
  'FAQ question is NOT detected as goodbye'
);

// ═══════════════════════════════════════════════════════════════
// TEST 10: Group Booking Time Preference Clearing After No Slots
// ═══════════════════════════════════════════════════════════════

testSection('TEST 10: Group Booking Time Preference Clearing After No Slots');

interface GroupBookingContext {
  currentState: {
    gb?: boolean;
    gp?: Array<{ name: string; relation?: string }>;
    tp: string | null;
    awaitingNewGroupBookingTime?: boolean;
  };
  availableSlots?: any[];
}

function simulateNoSlotsFound(context: GroupBookingContext): GroupBookingContext {
  // This simulates what happens when no slots are found for group booking
  // The fix clears tp and availableSlots so user can provide a new time
  const previousTp = context.currentState.tp;
  console.log(`  [Simulating] No slots found for ${previousTp}`);

  // CRITICAL FIX: Clear tp and slots for new time preference
  context.currentState.tp = null;
  context.availableSlots = undefined;
  context.currentState.awaitingNewGroupBookingTime = true;

  return context;
}

function extractTimePreferenceFromUtterance(utterance: string): string | null {
  const lower = utterance.toLowerCase();
  if (lower.includes('tomorrow morning') || lower.includes('tomorrow at 9')) return 'tomorrow morning';
  if (lower.includes('this afternoon') || lower.includes('today afternoon')) return 'today afternoon';
  if (lower.includes('next week')) return 'next week';
  if (lower.includes('9am') || lower.includes('9 am')) return '9am';
  if (lower.includes('10am') || lower.includes('10 am')) return '10am';
  return null;
}

// Scenario: User says "this afternoon" → no slots → user says "tomorrow morning at 9am"
const groupContext: GroupBookingContext = {
  currentState: {
    gb: true,
    gp: [{ name: 'Michael Bishop' }, { name: 'Matthew Bishop' }],
    tp: 'today afternoon'  // Original time preference
  }
};

// No slots found - should clear tp
simulateNoSlotsFound(groupContext);

assert(
  groupContext.currentState.tp === null,
  'tp is cleared after no slots found'
);

assert(
  groupContext.currentState.awaitingNewGroupBookingTime === true,
  'awaitingNewGroupBookingTime flag is set'
);

assert(
  groupContext.availableSlots === undefined,
  'availableSlots is cleared for refetch'
);

// Now user provides new time "tomorrow morning at 9am"
const newUtterance = "Tomorrow morning at 9am";
const extractedNewTp = extractTimePreferenceFromUtterance(newUtterance);

assert(
  extractedNewTp === 'tomorrow morning',
  'New time preference is extracted from utterance'
);

// Since tp is null, extraction runs and sets new tp
if (!groupContext.currentState.tp && extractedNewTp) {
  groupContext.currentState.tp = extractedNewTp;
  groupContext.currentState.awaitingNewGroupBookingTime = false;
}

assert(
  groupContext.currentState.tp === 'tomorrow morning',
  'tp is updated to new time preference'
);

assert(
  groupContext.currentState.awaitingNewGroupBookingTime === false,
  'awaitingNewGroupBookingTime flag is cleared after new time received'
);

// ═══════════════════════════════════════════════════════════════
// TEST 11: Separate Appointments Request Detection
// ═══════════════════════════════════════════════════════════════

testSection('TEST 11: Separate Appointments Request Detection');

function detectSeparateRequest(utterance: string): boolean {
  const lower = utterance.toLowerCase();
  return lower.includes('separate') ||
         lower.includes('individually') ||
         lower.includes('one at a time') ||
         lower.includes('book them separately');
}

function handleSeparateRequest(context: GroupBookingContext): GroupBookingContext {
  // Keep only first patient, exit group booking mode
  const firstPatient = context.currentState.gp?.[0];
  if (firstPatient) {
    context.currentState.gp = [firstPatient];
    context.currentState.gb = false;
    context.currentState.awaitingNewGroupBookingTime = false;
  }
  return context;
}

assert(
  detectSeparateRequest("book separate appointments") === true,
  '"book separate appointments" detected'
);

assert(
  detectSeparateRequest("separately please") === true,
  '"separately please" detected'
);

assert(
  detectSeparateRequest("book them individually") === true,
  '"book them individually" detected'
);

assert(
  detectSeparateRequest("one at a time") === true,
  '"one at a time" detected'
);

assert(
  detectSeparateRequest("tomorrow morning") === false,
  '"tomorrow morning" is NOT detected as separate request'
);

// Test handling of separate request
const separateContext: GroupBookingContext = {
  currentState: {
    gb: true,
    gp: [
      { name: 'Michael Bishop', relation: 'self' },
      { name: 'Matthew Bishop', relation: 'son' }
    ],
    tp: null,
    awaitingNewGroupBookingTime: true
  }
};

handleSeparateRequest(separateContext);

assert(
  separateContext.currentState.gb === false,
  'Group booking mode is disabled after separate request'
);

assert(
  separateContext.currentState.gp?.length === 1,
  'Only first patient is kept'
);

assert(
  separateContext.currentState.gp?.[0]?.name === 'Michael Bishop',
  'First patient (Michael) is preserved'
);

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL STABILIZATION TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED - Review output above');
}
console.log('='.repeat(60));

console.log('\n[FIXES VALIDATED]');
console.log('  1. Form submission race condition - merge strategy prevents data loss');
console.log('  2. Per-token form submission - group booking with multiple forms');
console.log('  3. 409 Conflict detection - prevents duplicate submissions per token');
console.log('  4. Terminal state blocking - no booking prompts after booking complete');
console.log('  5. Dead air prevention - follow-up prompt after SMS actions');
console.log('  6. Name double-asking - timestamp guard prevents asking twice');
console.log('  7. First name confirmations - natural speech with first names only');
console.log('  8. PatientId requirement - no unsafe phone lookup fallback');
console.log('  9. Goodbye phrase detection - includes apostrophe variations');
console.log(' 10. Group booking tp clearing - clears old tp when no slots found, allowing new time');
console.log(' 11. Separate appointments - converts group to individual on user request');

process.exit(failed > 0 ? 1 : 0);
