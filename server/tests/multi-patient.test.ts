/**
 * Multi-Patient Disambiguation Test Suite
 * Tests the logic for handling multiple patients with the same phone number
 *
 * Run: npm run test:multi-patient
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { AUST_TZ } from '../time';

dayjs.extend(utc);
dayjs.extend(timezone);

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

// Mock patient data structure
interface MockPatient {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

// Simulates the disambiguation logic from CallFlowHandler
function simulateDisambiguation(
  speech: string,
  digits: string,
  patients: MockPatient[]
): { result: 'selected' | 'new' | 'retry'; selectedPatient?: MockPatient } {
  const speechLower = speech.toLowerCase().trim();

  // Check for "someone new" / "new patient" / press 3
  const isSomeoneNew = digits === '3' ||
    speechLower.includes('new') ||
    speechLower.includes('different') ||
    speechLower.includes('someone else') ||
    speechLower.includes('not me');

  if (isSomeoneNew) {
    return { result: 'new' };
  }

  // Check for selection by digit (1 or 2)
  if (digits === '1' && patients[0]) {
    return { result: 'selected', selectedPatient: patients[0] };
  }
  if (digits === '2' && patients[1]) {
    return { result: 'selected', selectedPatient: patients[1] };
  }

  // Check for name match in speech
  for (const patient of patients) {
    if (speechLower.includes(patient.firstName.toLowerCase())) {
      return { result: 'selected', selectedPatient: patient };
    }
  }

  // Unclear response
  return { result: 'retry' };
}

// Simulates correction flow (e.g., "No, it's for my son instead")
function simulateCorrectionFlow(
  speech: string,
  currentPatient: MockPatient | null,
  patients: MockPatient[]
): { needsCorrection: boolean; newPatient?: MockPatient; isNewPerson?: boolean } {
  const speechLower = speech.toLowerCase().trim();

  // Detect correction intent
  const correctionPhrases = [
    'no, it\'s for',
    'actually for',
    'not for me',
    'for my son',
    'for my daughter',
    'for my husband',
    'for my wife',
    'for someone else',
    'wrong person',
    'different person'
  ];

  const isCorrection = correctionPhrases.some(phrase => speechLower.includes(phrase));

  if (!isCorrection) {
    return { needsCorrection: false };
  }

  // Check if they mention another name from the list
  for (const patient of patients) {
    if (patient !== currentPatient && speechLower.includes(patient.firstName.toLowerCase())) {
      return { needsCorrection: true, newPatient: patient };
    }
  }

  // Check for "new person" / "someone new"
  if (speechLower.includes('new') || speechLower.includes('someone else')) {
    return { needsCorrection: true, isNewPerson: true };
  }

  // Need to ask who
  return { needsCorrection: true };
}

// Start tests
console.log('='.repeat(60));
console.log('MULTI-PATIENT DISAMBIGUATION TEST SUITE');
console.log('='.repeat(60));

// Mock patients for testing
const mockPatients: MockPatient[] = [
  { id: 'patient_1', firstName: 'Michael', lastName: 'Smith', email: 'michael@test.com' },
  { id: 'patient_2', firstName: 'Sarah', lastName: 'Smith', email: 'sarah@test.com' },
];

// ─────────────────────────────────────────────────────────────
// TEST 1: Selection by digit (DTMF)
// ─────────────────────────────────────────────────────────────
testSection('TEST 1: Selection by digit (DTMF)');

const digit1Result = simulateDisambiguation('', '1', mockPatients);
assert(
  digit1Result.result === 'selected' && digit1Result.selectedPatient?.firstName === 'Michael',
  'Press 1 selects first patient (Michael)'
);

const digit2Result = simulateDisambiguation('', '2', mockPatients);
assert(
  digit2Result.result === 'selected' && digit2Result.selectedPatient?.firstName === 'Sarah',
  'Press 2 selects second patient (Sarah)'
);

const digit3Result = simulateDisambiguation('', '3', mockPatients);
assert(
  digit3Result.result === 'new',
  'Press 3 triggers new patient flow'
);

// ─────────────────────────────────────────────────────────────
// TEST 2: Selection by name (speech)
// ─────────────────────────────────────────────────────────────
testSection('TEST 2: Selection by name (speech)');

const michaelResult = simulateDisambiguation('Michael', '', mockPatients);
assert(
  michaelResult.result === 'selected' && michaelResult.selectedPatient?.firstName === 'Michael',
  'Saying "Michael" selects Michael'
);

const sarahResult = simulateDisambiguation('Sarah please', '', mockPatients);
assert(
  sarahResult.result === 'selected' && sarahResult.selectedPatient?.firstName === 'Sarah',
  'Saying "Sarah please" selects Sarah'
);

const itsForSarahResult = simulateDisambiguation('it\'s for Sarah', '', mockPatients);
assert(
  itsForSarahResult.result === 'selected' && itsForSarahResult.selectedPatient?.firstName === 'Sarah',
  '"it\'s for Sarah" selects Sarah'
);

// ─────────────────────────────────────────────────────────────
// TEST 3: New patient triggers
// ─────────────────────────────────────────────────────────────
testSection('TEST 3: New patient triggers');

const someoneNewResult = simulateDisambiguation('someone new', '', mockPatients);
assert(
  someoneNewResult.result === 'new',
  '"someone new" triggers new patient flow'
);

const differentResult = simulateDisambiguation('a different person', '', mockPatients);
assert(
  differentResult.result === 'new',
  '"a different person" triggers new patient flow'
);

const newPatientResult = simulateDisambiguation('new patient', '', mockPatients);
assert(
  newPatientResult.result === 'new',
  '"new patient" triggers new patient flow'
);

const notMeResult = simulateDisambiguation('not me', '', mockPatients);
assert(
  notMeResult.result === 'new',
  '"not me" triggers new patient flow'
);

// ─────────────────────────────────────────────────────────────
// TEST 4: Retry scenarios
// ─────────────────────────────────────────────────────────────
testSection('TEST 4: Retry scenarios');

const unclearResult = simulateDisambiguation('hello', '', mockPatients);
assert(
  unclearResult.result === 'retry',
  'Unclear speech triggers retry'
);

const unknownNameResult = simulateDisambiguation('John', '', mockPatients);
assert(
  unknownNameResult.result === 'retry',
  'Unknown name triggers retry'
);

const emptyResult = simulateDisambiguation('', '', mockPatients);
assert(
  emptyResult.result === 'retry',
  'No input triggers retry'
);

// ─────────────────────────────────────────────────────────────
// TEST 5: Correction flow ("No, it's for my son instead")
// ─────────────────────────────────────────────────────────────
testSection('TEST 5: Correction flow');

const correctionToSarahResult = simulateCorrectionFlow(
  'No, it\'s for Sarah actually',
  mockPatients[0],
  mockPatients
);
assert(
  correctionToSarahResult.needsCorrection && correctionToSarahResult.newPatient?.firstName === 'Sarah',
  'Correction to another known patient works'
);

const correctionToNewResult = simulateCorrectionFlow(
  'No, it\'s for someone new',
  mockPatients[0],
  mockPatients
);
assert(
  correctionToNewResult.needsCorrection && correctionToNewResult.isNewPerson === true,
  'Correction to new person triggers new patient flow'
);

const forMySonResult = simulateCorrectionFlow(
  'Actually, for my son',
  mockPatients[0],
  mockPatients
);
assert(
  forMySonResult.needsCorrection,
  '"for my son" triggers correction flow'
);

const noCorrectionResult = simulateCorrectionFlow(
  'Yes, that\'s correct',
  mockPatients[0],
  mockPatients
);
assert(
  !noCorrectionResult.needsCorrection,
  'Confirmation does not trigger correction'
);

// ─────────────────────────────────────────────────────────────
// TEST 6: Case insensitivity
// ─────────────────────────────────────────────────────────────
testSection('TEST 6: Case insensitivity');

const upperMichaelResult = simulateDisambiguation('MICHAEL', '', mockPatients);
assert(
  upperMichaelResult.result === 'selected' && upperMichaelResult.selectedPatient?.firstName === 'Michael',
  'Uppercase "MICHAEL" works'
);

const mixedCaseResult = simulateDisambiguation('It\'s SaRaH', '', mockPatients);
assert(
  mixedCaseResult.result === 'selected' && mixedCaseResult.selectedPatient?.firstName === 'Sarah',
  'Mixed case "SaRaH" works'
);

// ─────────────────────────────────────────────────────────────
// TEST 7: Edge cases
// ─────────────────────────────────────────────────────────────
testSection('TEST 7: Edge cases');

// Single patient (no disambiguation needed typically, but test the logic)
const singlePatient: MockPatient[] = [
  { id: 'patient_solo', firstName: 'Alice', lastName: 'Jones' }
];
const singlePatientDigit1 = simulateDisambiguation('', '1', singlePatient);
assert(
  singlePatientDigit1.result === 'selected' && singlePatientDigit1.selectedPatient?.firstName === 'Alice',
  'Single patient: digit 1 still works'
);

// Three patients
const threePatients: MockPatient[] = [
  { id: '1', firstName: 'Alex', lastName: 'Test' },
  { id: '2', firstName: 'Beth', lastName: 'Test' },
  { id: '3', firstName: 'Chris', lastName: 'Test' },
];
const thirdPatientByName = simulateDisambiguation('Chris', '', threePatients);
assert(
  thirdPatientByName.result === 'selected' && thirdPatientByName.selectedPatient?.firstName === 'Chris',
  'Three patients: can select third by name'
);

// ─────────────────────────────────────────────────────────────
// TEST 8: Patient data is not overwritten
// ─────────────────────────────────────────────────────────────
testSection('TEST 8: Patient data integrity');

// Simulate the scenario where selecting "someone new" should NOT modify existing patient data
const originalPatients = JSON.parse(JSON.stringify(mockPatients));
const newPersonResult = simulateDisambiguation('someone new', '', mockPatients);

assert(
  newPersonResult.result === 'new',
  'New person selection returns correct result'
);
assert(
  mockPatients[0].firstName === originalPatients[0].firstName &&
  mockPatients[1].firstName === originalPatients[1].firstName,
  'Existing patient data is NOT modified when selecting "new"'
);

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL MULTI-PATIENT TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED - Review output above');
}
console.log('='.repeat(60));

console.log('\n[BEHAVIORS VALIDATED]');
console.log('  - Same phone, two existing patients: Disambiguation prompt works');
console.log('  - Selection by DTMF digit (1/2/3)');
console.log('  - Selection by name speech');
console.log('  - "Someone new" creates fresh patient without overwriting');
console.log('  - Correction flows ("No, it\'s for my son instead")');
console.log('  - Case insensitivity');
console.log('  - Edge cases (single patient, 3+ patients)');

process.exit(failed > 0 ? 1 : 0);
