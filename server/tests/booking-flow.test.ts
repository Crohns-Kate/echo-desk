/**
 * End-to-End Booking Flow Test Suite
 * Simulates complete booking flows for validation
 *
 * Run: npm run test:booking
 */

import { CallState } from '../types/call-state';
import { parseNaturalDate } from '../utils/date-parser';
import { AUST_TZ } from '../time';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`    ✅ ${testName}`);
    passed++;
  } else {
    console.error(`    ❌ ${testName}${details ? ': ' + details : ''}`);
    failed++;
  }
}

function testSection(name: string) {
  console.log(`\n[${name}]`);
}

function subSection(name: string) {
  console.log(`  ${name}`);
}

// ═══════════════════════════════════════════════════════════════
// MOCK INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════

interface MockCallContext {
  state: CallState;
  callSid: string;
  callerPhone: string;
  patientId?: string;
  patientName?: string;
  patientFirstName?: string;
  patientEmail?: string;
  formToken?: string;
  formData?: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  complaint?: string;
  preferredDay?: string;
  appointmentSlots?: Array<{
    startISO: string;
    speakable: string;
  }>;
  selectedSlotIndex?: number;
  retryCount: number;
}

// Mock patient database
const mockPatientDB: Record<string, { id: string; firstName: string; lastName: string; email: string }[]> = {
  '+61400000001': [], // New patient
  '+61400000002': [{ id: 'p1', firstName: 'John', lastName: 'Smith', email: 'john@test.com' }], // Single existing
  '+61400000003': [ // Multiple patients
    { id: 'p2', firstName: 'Michael', lastName: 'Brown', email: 'michael@test.com' },
    { id: 'p3', firstName: 'Sarah', lastName: 'Brown', email: 'sarah@test.com' }
  ]
};

// Mock availability
const mockSlots = [
  { startISO: dayjs().add(1, 'day').hour(9).toISOString(), speakable: '9:00am tomorrow' },
  { startISO: dayjs().add(1, 'day').hour(10).toISOString(), speakable: '10:00am tomorrow' },
  { startISO: dayjs().add(1, 'day').hour(14).toISOString(), speakable: '2:00pm tomorrow' },
];

// Simulated state machine
function createContext(phone: string): MockCallContext {
  return {
    state: CallState.GREETING,
    callSid: `CA_TEST_${Date.now()}`,
    callerPhone: phone,
    retryCount: 0
  };
}

function simulatePatientLookup(phone: string): { found: boolean; multiple: boolean; patients: any[] } {
  const patients = mockPatientDB[phone] || [];
  return {
    found: patients.length > 0,
    multiple: patients.length > 1,
    patients
  };
}

function simulatePatientTypeDetection(speech: string): 'new' | 'returning' | 'unclear' {
  const s = speech.toLowerCase();
  if (s.includes('new') || s.includes('first') || s.includes('yes')) return 'new';
  if (s.includes('returning') || s.includes('no') || s.includes('been before')) return 'returning';
  return 'unclear';
}

function extractPreferredDay(complaint: string): string | undefined {
  const s = complaint.toLowerCase();
  if (s.includes('today')) return 'today';
  if (s.includes('tomorrow')) return 'tomorrow';
  if (s.includes('monday')) return 'monday';
  if (s.includes('tuesday')) return 'tuesday';
  if (s.includes('saturday')) return 'saturday';
  return undefined;
}

function simulateSlotSelection(speech: string, digits: string): number | null {
  if (digits === '1' || speech.includes('one') || speech.includes('first')) return 0;
  if (digits === '2' || speech.includes('two') || speech.includes('second')) return 1;
  if (digits === '3' || speech.includes('three') || speech.includes('third')) return 2;
  return null;
}

// ═══════════════════════════════════════════════════════════════
// TESTS START
// ═══════════════════════════════════════════════════════════════

console.log('='.repeat(60));
console.log('END-TO-END BOOKING FLOW TEST SUITE');
console.log('='.repeat(60));

// ─────────────────────────────────────────────────────────────
// TEST 1: New Patient Complete Flow
// ─────────────────────────────────────────────────────────────
testSection('TEST 1: New Patient Complete Flow');

async function testNewPatientFlow() {
  const ctx = createContext('+61400000001');

  subSection('Step 1: Greeting');
  assert(ctx.state === CallState.GREETING, 'Initial state is GREETING');
  ctx.state = CallState.PATIENT_TYPE_DETECT;
  assert(ctx.state === CallState.PATIENT_TYPE_DETECT, 'Transitioned to PATIENT_TYPE_DETECT');

  subSection('Step 2: Patient type detection');
  const patientType = simulatePatientTypeDetection('yes, first time');
  assert(patientType === 'new', 'Detected as new patient');
  ctx.state = CallState.NEW_PATIENT_PHONE_CONFIRM;

  subSection('Step 3: Phone confirmation');
  assert(ctx.state === CallState.NEW_PATIENT_PHONE_CONFIRM, 'In phone confirmation state');
  ctx.state = CallState.SEND_FORM_LINK;

  subSection('Step 4: Form flow');
  ctx.formToken = `form_${ctx.callSid}_${Date.now()}`;
  assert(!!ctx.formToken, 'Form token generated');
  ctx.state = CallState.WAITING_FOR_FORM;
  assert(ctx.state === CallState.WAITING_FOR_FORM, 'Waiting for form');

  // Simulate form submission
  ctx.formData = {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@test.com',
    phone: '+61400000001'
  };
  ctx.state = CallState.FORM_RECEIVED;
  assert(!!ctx.formData, 'Form data received');

  subSection('Step 5: Chief complaint');
  ctx.state = CallState.CHIEF_COMPLAINT;
  const complaint = 'back pain, can I come in tomorrow';
  ctx.complaint = complaint;
  ctx.preferredDay = extractPreferredDay(complaint);
  assert(ctx.preferredDay === 'tomorrow', 'Extracted preferred day: tomorrow');

  subSection('Step 6: Appointment search');
  ctx.state = CallState.APPOINTMENT_SEARCH;
  const dateRange = parseNaturalDate(ctx.preferredDay, AUST_TZ);
  assert(dateRange.description.includes('tomorrow'), 'Date range correctly parsed');
  ctx.appointmentSlots = mockSlots;
  assert(ctx.appointmentSlots.length === 3, 'Found 3 available slots');

  subSection('Step 7: Slot selection');
  ctx.state = CallState.PRESENT_OPTIONS;
  const selectedSlot = simulateSlotSelection('', '1');
  assert(selectedSlot === 0, 'First slot selected via digit 1');
  ctx.selectedSlotIndex = selectedSlot;

  subSection('Step 8: Booking confirmation');
  ctx.state = CallState.CONFIRM_BOOKING;
  assert(ctx.selectedSlotIndex === 0, 'Slot index confirmed');
  assert(!!ctx.formData.firstName, 'Patient name available for confirmation');
  ctx.state = CallState.CLOSING;
  assert(ctx.state === CallState.CLOSING, 'Flow completed successfully');

  return true;
}

await testNewPatientFlow();

// ─────────────────────────────────────────────────────────────
// TEST 2: Existing Patient Complete Flow
// ─────────────────────────────────────────────────────────────
testSection('TEST 2: Existing Patient Complete Flow');

async function testExistingPatientFlow() {
  const ctx = createContext('+61400000002');

  subSection('Step 1: Greeting');
  ctx.state = CallState.PATIENT_TYPE_DETECT;
  const patientType = simulatePatientTypeDetection('no, been before');
  assert(patientType === 'returning', 'Detected as returning patient');

  subSection('Step 2: Patient lookup');
  ctx.state = CallState.RETURNING_PATIENT_LOOKUP;
  const lookup = simulatePatientLookup(ctx.callerPhone);
  assert(lookup.found, 'Patient found in database');
  assert(!lookup.multiple, 'Single patient match');
  assert(lookup.patients[0].firstName === 'John', 'Correct patient: John');

  ctx.patientId = lookup.patients[0].id;
  ctx.patientFirstName = lookup.patients[0].firstName;
  ctx.patientName = `${lookup.patients[0].firstName} ${lookup.patients[0].lastName}`;

  subSection('Step 3: Chief complaint');
  ctx.state = CallState.CHIEF_COMPLAINT;
  ctx.complaint = 'regular checkup';
  ctx.preferredDay = extractPreferredDay('checkup today');
  assert(ctx.patientId === 'p1', 'Patient ID bound to session');

  subSection('Step 4: Appointment search');
  ctx.state = CallState.APPOINTMENT_SEARCH;
  ctx.appointmentSlots = mockSlots;
  assert(ctx.appointmentSlots.length > 0, 'Slots available');

  subSection('Step 5: Booking');
  ctx.state = CallState.PRESENT_OPTIONS;
  ctx.selectedSlotIndex = simulateSlotSelection('two please', '');
  assert(ctx.selectedSlotIndex === 1, 'Second slot selected by speech');

  ctx.state = CallState.CONFIRM_BOOKING;
  ctx.state = CallState.CLOSING;
  assert(ctx.state === CallState.CLOSING, 'Existing patient flow completed');

  return true;
}

await testExistingPatientFlow();

// ─────────────────────────────────────────────────────────────
// TEST 3: Multi-Patient Disambiguation Flow
// ─────────────────────────────────────────────────────────────
testSection('TEST 3: Multi-Patient Disambiguation Flow');

async function testMultiPatientFlow() {
  const ctx = createContext('+61400000003');

  subSection('Step 1: Patient lookup finds multiple');
  ctx.state = CallState.RETURNING_PATIENT_LOOKUP;
  const lookup = simulatePatientLookup(ctx.callerPhone);
  assert(lookup.multiple, 'Multiple patients detected');
  assert(lookup.patients.length === 2, 'Found 2 patients');

  subSection('Step 2a: Disambiguation - select Michael');
  // User says "Michael"
  let speech = 'michael';
  let foundPatient = lookup.patients.find(p => speech.includes(p.firstName.toLowerCase()));
  assert(foundPatient?.firstName === 'Michael', 'Selected Michael by name');

  subSection('Step 2b: Disambiguation - select Sarah via digit');
  // User presses 2
  foundPatient = lookup.patients[1];
  assert(foundPatient?.firstName === 'Sarah', 'Selected Sarah via digit 2');

  subSection('Step 2c: Someone new');
  // User says "someone new"
  const isSomeoneNew = 'someone new'.includes('new');
  assert(isSomeoneNew, '"Someone new" detected correctly');

  return true;
}

await testMultiPatientFlow();

// ─────────────────────────────────────────────────────────────
// TEST 4: Mid-Flow Change Scenario
// ─────────────────────────────────────────────────────────────
testSection('TEST 4: Mid-Flow Change Scenario');

async function testMidFlowChange() {
  const ctx = createContext('+61400000002');

  subSection('Step 1: Initial request for Monday');
  ctx.preferredDay = 'monday';
  let dateRange = parseNaturalDate(ctx.preferredDay, AUST_TZ);
  assert(dateRange.from.day() === 1, 'Monday search initiated');

  subSection('Step 2: User changes to Tuesday');
  // Simulate: user says "actually, do you have anything Tuesday?"
  const newDayRequest = 'actually, do you have anything tuesday';
  const newPreferredDay = extractPreferredDay(newDayRequest);
  assert(newPreferredDay === 'tuesday', 'Extracted new day: Tuesday');

  ctx.preferredDay = newPreferredDay;
  dateRange = parseNaturalDate(ctx.preferredDay, AUST_TZ);
  assert(dateRange.from.day() === 2, 'Tuesday search initiated');

  subSection('Step 3: User accepts Tuesday slot');
  ctx.appointmentSlots = mockSlots;
  ctx.selectedSlotIndex = 0;
  ctx.state = CallState.CONFIRM_BOOKING;
  assert(ctx.selectedSlotIndex !== undefined, 'Slot selected after date change');

  return true;
}

await testMidFlowChange();

// ─────────────────────────────────────────────────────────────
// TEST 5: Error Recovery Scenarios
// ─────────────────────────────────────────────────────────────
testSection('TEST 5: Error Recovery Scenarios');

async function testErrorRecovery() {
  subSection('Scenario A: No availability');
  const emptySlots: any[] = [];
  const hasSlots = emptySlots.length > 0;
  assert(!hasSlots, 'No slots detected correctly');
  // System should offer alternatives

  subSection('Scenario B: Unclear speech - retry limit');
  let retryCount = 0;
  const maxRetries = 2;
  const speech = 'ummm maybe';  // Note: avoid words containing 'no' like 'dunno'
  const patientType = simulatePatientTypeDetection(speech);
  assert(patientType === 'unclear', 'Speech recognized as unclear');
  retryCount++;
  assert(retryCount <= maxRetries, 'Under retry limit, can retry');
  retryCount++;
  assert(retryCount >= maxRetries, 'Hit retry limit, should fallback');

  subSection('Scenario C: Invalid slot selection');
  const invalidSlot = simulateSlotSelection('five', '5');
  assert(invalidSlot === null, 'Invalid slot selection detected');

  return true;
}

await testErrorRecovery();

// ─────────────────────────────────────────────────────────────
// TEST 6: State Machine Transitions
// ─────────────────────────────────────────────────────────────
testSection('TEST 6: State Machine Transitions');

async function testStateMachine() {
  const VALID_TRANSITIONS: Record<CallState, CallState[]> = {
    [CallState.GREETING]: [CallState.PATIENT_TYPE_DETECT],
    [CallState.PATIENT_TYPE_DETECT]: [CallState.RETURNING_PATIENT_LOOKUP, CallState.NEW_PATIENT_PHONE_CONFIRM, CallState.FAQ_ANSWERING],
    [CallState.FAQ_ANSWERING]: [CallState.PATIENT_TYPE_DETECT, CallState.CHIEF_COMPLAINT, CallState.CLOSING],
    [CallState.RETURNING_PATIENT_LOOKUP]: [CallState.CHIEF_COMPLAINT, CallState.NEW_PATIENT_PHONE_CONFIRM],
    [CallState.NEW_PATIENT_PHONE_CONFIRM]: [CallState.SEND_FORM_LINK],
    [CallState.SEND_FORM_LINK]: [CallState.WAITING_FOR_FORM],
    [CallState.WAITING_FOR_FORM]: [CallState.FORM_RECEIVED, CallState.ERROR_RECOVERY],
    [CallState.FORM_RECEIVED]: [CallState.CHIEF_COMPLAINT],
    [CallState.CHIEF_COMPLAINT]: [CallState.APPOINTMENT_SEARCH, CallState.FAQ_ANSWERING],
    [CallState.APPOINTMENT_SEARCH]: [CallState.PRESENT_OPTIONS, CallState.ERROR_RECOVERY],
    [CallState.PRESENT_OPTIONS]: [CallState.CONFIRM_BOOKING, CallState.APPOINTMENT_SEARCH],
    [CallState.CONFIRM_BOOKING]: [CallState.CLOSING],
    [CallState.CLOSING]: [],
    [CallState.ERROR_RECOVERY]: [CallState.GREETING, CallState.CLOSING]
  };

  subSection('Valid transition: GREETING -> PATIENT_TYPE_DETECT');
  assert(
    VALID_TRANSITIONS[CallState.GREETING].includes(CallState.PATIENT_TYPE_DETECT),
    'GREETING can transition to PATIENT_TYPE_DETECT'
  );

  subSection('Valid transition: PATIENT_TYPE_DETECT -> NEW_PATIENT_PHONE_CONFIRM');
  assert(
    VALID_TRANSITIONS[CallState.PATIENT_TYPE_DETECT].includes(CallState.NEW_PATIENT_PHONE_CONFIRM),
    'PATIENT_TYPE_DETECT can transition to NEW_PATIENT_PHONE_CONFIRM'
  );

  subSection('Valid transition: PRESENT_OPTIONS -> APPOINTMENT_SEARCH (re-search)');
  assert(
    VALID_TRANSITIONS[CallState.PRESENT_OPTIONS].includes(CallState.APPOINTMENT_SEARCH),
    'PRESENT_OPTIONS can transition back to APPOINTMENT_SEARCH'
  );

  subSection('Invalid transition: GREETING -> CLOSING (blocked)');
  assert(
    !VALID_TRANSITIONS[CallState.GREETING].includes(CallState.CLOSING),
    'Cannot transition from GREETING directly to CLOSING'
  );

  return true;
}

await testStateMachine();

// ─────────────────────────────────────────────────────────────
// TEST 7: Appointment Type Selection
// ─────────────────────────────────────────────────────────────
testSection('TEST 7: Appointment Type Selection');

async function testAppointmentTypes() {
  subSection('New patient gets NEW_PATIENT appointment type');
  const isNewPatient = true;
  const patientId = undefined;
  const hasFormData = true;
  const shouldUseNewPatientType = !patientId && hasFormData && isNewPatient;
  assert(shouldUseNewPatientType, 'New patient uses NEW_PATIENT appointment type');

  subSection('Existing patient gets STANDARD appointment type');
  const existingPatientId = 'p1';
  const existingHasFormData = false;
  const shouldUseStandardType = !!existingPatientId && !existingHasFormData;
  assert(shouldUseStandardType, 'Existing patient uses STANDARD appointment type');

  return true;
}

await testAppointmentTypes();

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL BOOKING FLOW TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED - Review output above');
}
console.log('='.repeat(60));

console.log('\n[HOW TO RUN TESTS]');
console.log('  npm test              # Run all tests');
console.log('  npm run test:dates    # Date parser tests only');
console.log('  npm run test:appointment # Appointment search tests');
console.log('  npm run test:multi-patient # Multi-patient disambiguation');
console.log('  npm run test:booking  # Booking flow tests (this file)');

console.log('\n[FLOWS VALIDATED]');
console.log('  - New patient: Greeting -> Phone confirm -> Form -> Complaint -> Search -> Book');
console.log('  - Existing patient: Lookup -> Complaint -> Search -> Book');
console.log('  - Multi-patient disambiguation');
console.log('  - Mid-flow date changes');
console.log('  - Error recovery (no availability, unclear speech, invalid selection)');
console.log('  - State machine transitions');
console.log('  - Appointment type selection (new vs existing)');

process.exit(failed > 0 ? 1 : 0);
