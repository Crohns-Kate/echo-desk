/**
 * Date Parser Test Suite
 * Validates natural language date parsing for appointment booking
 *
 * Run: npm run test:dates
 */

import { parseNaturalDate, formatDateRange } from '../utils/date-parser';
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

// Start tests
console.log('='.repeat(60));
console.log('DATE PARSER TEST SUITE');
console.log('='.repeat(60));

const now = dayjs().tz(AUST_TZ);
console.log(`\nCurrent time: ${now.format('YYYY-MM-DD HH:mm:ss')} (${AUST_TZ})`);
console.log(`Current day: ${now.format('dddd')}`);

// ─────────────────────────────────────────────────────────────
// TEST 1: "today" parsing
// ─────────────────────────────────────────────────────────────
testSection('TEST 1: "today" parsing');

const todayResult = parseNaturalDate('today', AUST_TZ);
assert(
  todayResult.description.includes('today'),
  '"today" returns correct description'
);
assert(
  todayResult.from.isSame(now, 'day'),
  '"today" starts on current date'
);
assert(
  todayResult.to.isSame(now, 'day'),
  '"today" ends on current date'
);
assert(
  todayResult.from.hour() >= now.hour() - 1, // Allow 1 hour tolerance for test execution
  '"today" starts from current time (not midnight)',
  `from hour: ${todayResult.from.hour()}, now hour: ${now.hour()}`
);

// ─────────────────────────────────────────────────────────────
// TEST 2: "tomorrow" parsing
// ─────────────────────────────────────────────────────────────
testSection('TEST 2: "tomorrow" parsing');

const tomorrow = now.add(1, 'day').startOf('day');
const tomorrowResult = parseNaturalDate('tomorrow', AUST_TZ);
assert(
  tomorrowResult.description.includes('tomorrow'),
  '"tomorrow" returns correct description'
);
assert(
  tomorrowResult.from.isSame(tomorrow, 'day'),
  '"tomorrow" is correct date'
);
assert(
  tomorrowResult.from.hour() === 0 && tomorrowResult.from.minute() === 0,
  '"tomorrow" starts at midnight'
);

// ─────────────────────────────────────────────────────────────
// TEST 3: Weekday parsing (saturday, monday, etc.)
// ─────────────────────────────────────────────────────────────
testSection('TEST 3: Weekday parsing');

const saturdayResult = parseNaturalDate('saturday', AUST_TZ);
assert(
  saturdayResult.from.day() === 6,
  '"saturday" resolves to Saturday (day 6)',
  `got day ${saturdayResult.from.day()}`
);

const mondayResult = parseNaturalDate('monday', AUST_TZ);
assert(
  mondayResult.from.day() === 1,
  '"monday" resolves to Monday (day 1)',
  `got day ${mondayResult.from.day()}`
);

const sundayResult = parseNaturalDate('sunday', AUST_TZ);
assert(
  sundayResult.from.day() === 0,
  '"sunday" resolves to Sunday (day 0)',
  `got day ${sundayResult.from.day()}`
);

// ─────────────────────────────────────────────────────────────
// TEST 4: "this saturday" vs "next saturday"
// ─────────────────────────────────────────────────────────────
testSection('TEST 4: "this saturday" vs "next saturday"');

const thisSaturdayResult = parseNaturalDate('this saturday', AUST_TZ);
const nextSaturdayResult = parseNaturalDate('next saturday', AUST_TZ);

assert(
  thisSaturdayResult.from.day() === 6,
  '"this saturday" is a Saturday'
);
assert(
  nextSaturdayResult.from.day() === 6,
  '"next saturday" is a Saturday'
);
assert(
  nextSaturdayResult.from.isAfter(thisSaturdayResult.from),
  '"next saturday" is after "this saturday"',
  `this: ${thisSaturdayResult.from.format('MMM D')}, next: ${nextSaturdayResult.from.format('MMM D')}`
);
const daysBetween = nextSaturdayResult.from.diff(thisSaturdayResult.from, 'days');
assert(
  daysBetween === 7,
  '"next saturday" is exactly 7 days after "this saturday"',
  `days between: ${daysBetween}`
);

// ─────────────────────────────────────────────────────────────
// TEST 5: "next week" parsing
// ─────────────────────────────────────────────────────────────
testSection('TEST 5: "next week" parsing');

const nextWeekResult = parseNaturalDate('next week', AUST_TZ);
assert(
  nextWeekResult.from.day() === 1,
  '"next week" starts on Monday',
  `starts on day ${nextWeekResult.from.day()}`
);
assert(
  nextWeekResult.to.day() === 5,
  '"next week" ends on Friday',
  `ends on day ${nextWeekResult.to.day()}`
);
assert(
  nextWeekResult.from.isAfter(now),
  '"next week" is in the future'
);

// ─────────────────────────────────────────────────────────────
// TEST 6: Explicit date - day only ("23rd", "the 23rd")
// ─────────────────────────────────────────────────────────────
testSection('TEST 6: Explicit date - day only');

const the23rdResult = parseNaturalDate('23rd', AUST_TZ);
assert(
  the23rdResult.from.date() === 23,
  '"23rd" resolves to 23rd of month',
  `got date ${the23rdResult.from.date()}`
);
assert(
  the23rdResult.from.isAfter(now) || the23rdResult.from.isSame(now, 'day'),
  '"23rd" is today or in the future'
);

const the1stResult = parseNaturalDate('1st', AUST_TZ);
assert(
  the1stResult.from.date() === 1,
  '"1st" resolves to 1st of month',
  `got date ${the1stResult.from.date()}`
);

const onThe15thResult = parseNaturalDate('on the 15th', AUST_TZ);
assert(
  onThe15thResult.from.date() === 15,
  '"on the 15th" resolves to 15th',
  `got date ${onThe15thResult.from.date()}`
);

// ─────────────────────────────────────────────────────────────
// TEST 7: Explicit date with month ("may 23rd", "23rd of may")
// ─────────────────────────────────────────────────────────────
testSection('TEST 7: Explicit date with month');

const may23rdResult = parseNaturalDate('may 23rd', AUST_TZ);
assert(
  may23rdResult.from.month() === 4 && may23rdResult.from.date() === 23,
  '"may 23rd" resolves to May 23',
  `got ${may23rdResult.from.format('MMM D')}`
);

const dec15Result = parseNaturalDate('december 15', AUST_TZ);
assert(
  dec15Result.from.month() === 11 && dec15Result.from.date() === 15,
  '"december 15" resolves to December 15',
  `got ${dec15Result.from.format('MMM D')}`
);

const ofMayResult = parseNaturalDate('23rd of may', AUST_TZ);
assert(
  ofMayResult.from.month() === 4 && ofMayResult.from.date() === 23,
  '"23rd of may" resolves to May 23',
  `got ${ofMayResult.from.format('MMM D')}`
);

// ─────────────────────────────────────────────────────────────
// TEST 8: Slash format dates ("23/5", "15/12")
// ─────────────────────────────────────────────────────────────
testSection('TEST 8: Slash format dates (DD/MM)');

const slash23_5Result = parseNaturalDate('23/5', AUST_TZ);
assert(
  slash23_5Result.from.date() === 23 && slash23_5Result.from.month() === 4,
  '"23/5" resolves to 23 May (DD/MM)',
  `got ${slash23_5Result.from.format('D MMM')}`
);

const slash15_12Result = parseNaturalDate('15/12', AUST_TZ);
assert(
  slash15_12Result.from.date() === 15 && slash15_12Result.from.month() === 11,
  '"15/12" resolves to 15 December',
  `got ${slash15_12Result.from.format('D MMM')}`
);

// ─────────────────────────────────────────────────────────────
// TEST 9: Fallback behavior
// ─────────────────────────────────────────────────────────────
testSection('TEST 9: Fallback behavior');

const noDateResult = parseNaturalDate(undefined, AUST_TZ);
assert(
  noDateResult.description.includes('2 weeks'),
  'No date specified returns 2 week range'
);
const daysDiff = noDateResult.to.diff(noDateResult.from, 'days');
assert(
  daysDiff === 14,
  'Default range is 14 days',
  `got ${daysDiff} days`
);

const unknownResult = parseNaturalDate('someday whenever', AUST_TZ);
assert(
  unknownResult.description.includes("couldn't parse"),
  'Unknown expression falls back gracefully'
);

// ─────────────────────────────────────────────────────────────
// TEST 10: Timezone consistency
// ─────────────────────────────────────────────────────────────
testSection('TEST 10: Timezone consistency');

const todayRange = parseNaturalDate('today', AUST_TZ);
const tomorrowRange = parseNaturalDate('tomorrow', AUST_TZ);

// Tomorrow should start the day after today ends
const todayEnd = todayRange.to;
const tomorrowStart = tomorrowRange.from;

assert(
  tomorrowStart.isAfter(todayEnd) || tomorrowStart.isSame(todayEnd.add(1, 'second'), 'minute'),
  'Tomorrow starts after today ends',
  `today ends: ${todayEnd.format('HH:mm')}, tomorrow starts: ${tomorrowStart.format('HH:mm')}`
);

// All results should be in the correct timezone
assert(
  todayRange.from.tz() === AUST_TZ || todayRange.from.utcOffset() === dayjs().tz(AUST_TZ).utcOffset(),
  'Date results use correct timezone'
);

// ─────────────────────────────────────────────────────────────
// TEST 11: Edge cases
// ─────────────────────────────────────────────────────────────
testSection('TEST 11: Edge cases');

// Test Feb 30 (invalid date)
const feb30Result = parseNaturalDate('30/2', AUST_TZ);
assert(
  feb30Result.from.isValid(),
  'Invalid date (Feb 30) handled gracefully'
);

// Test month abbreviations
const janResult = parseNaturalDate('jan 15', AUST_TZ);
assert(
  janResult.from.month() === 0 && janResult.from.date() === 15,
  'Month abbreviation "jan" works',
  `got ${janResult.from.format('MMM D')}`
);

// Test case insensitivity
const SATURDAY = parseNaturalDate('SATURDAY', AUST_TZ);
assert(
  SATURDAY.from.day() === 6,
  'Uppercase "SATURDAY" works'
);

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL DATE PARSER TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED - Review output above');
}
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
