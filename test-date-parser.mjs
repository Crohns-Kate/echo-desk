/**
 * Test script for date parser
 * Verifies that date parsing works correctly for common scenarios
 */

import { parseNaturalDate, formatDateRange } from './dist/index.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const AUST_TZ = 'Australia/Brisbane';

console.log('\n🧪 TESTING DATE PARSER\n');
console.log('='.repeat(70));
console.log(`Current time (${AUST_TZ}): ${dayjs().tz(AUST_TZ).format('dddd, MMM D, YYYY h:mm A')}`);
console.log('='.repeat(70));

// Test cases
const testCases = [
  { input: undefined, description: 'No day specified (default)' },
  { input: 'today', description: 'Today' },
  { input: 'tomorrow', description: 'Tomorrow' },
  { input: 'saturday', description: 'Saturday (next upcoming)' },
  { input: 'monday', description: 'Monday (next upcoming)' },
  { input: 'this saturday', description: 'This Saturday' },
  { input: 'next saturday', description: 'Next Saturday' },
  { input: 'friday', description: 'Friday (next upcoming)' }
];

testCases.forEach((test, index) => {
  console.log(`\n${index + 1}. Testing: ${test.description}`);
  console.log(`   Input: "${test.input || 'undefined'}"`);

  try {
    const result = parseNaturalDate(test.input, AUST_TZ);
    console.log(`   From:  ${result.from.format('ddd, MMM D, YYYY h:mm A')}`);
    console.log(`   To:    ${result.to.format('ddd, MMM D, YYYY h:mm A')}`);
    console.log(`   Range: ${result.description}`);
    console.log(`   ✅ Success`);
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
  }
});

console.log('\n' + '='.repeat(70));
console.log('✅ Date parser test complete\n');

process.exit(0);
