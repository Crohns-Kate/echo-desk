/**
 * TwiML Single Gather Test
 *
 * Ensures that TwiML responses contain only ONE <Gather> element.
 * Multiple gathers in a single response break Twilio call UX because
 * they execute sequentially (greeting + "are you still there?" back-to-back).
 *
 * Rule: actionOnEmptyResult should be used instead of stacking gathers.
 */

import twilio from 'twilio';

// Simple TwiML parser to count Gather elements
function countGatherElements(twiml: string): number {
  const matches = twiml.match(/<Gather\b/gi);
  return matches ? matches.length : 0;
}

// Check if TwiML has enhanced without phone_call model
function hasEnhancedWithoutPhoneCall(twiml: string): boolean {
  // Look for enhanced="true" or enhanced without speechModel="phone_call" nearby
  const gatherRegex = /<Gather[^>]*>/gi;
  const gathers = twiml.match(gatherRegex) || [];

  for (const gather of gathers) {
    const hasEnhanced = /enhanced="true"/i.test(gather) || /enhanced(?!=)/i.test(gather);
    const hasPhoneCallModel = /speechModel="phone_call"/i.test(gather);

    if (hasEnhanced && !hasPhoneCallModel) {
      return true; // Bad: enhanced without phone_call model
    }
  }
  return false;
}

console.log('============================================================');
console.log('TWIML SINGLE GATHER TEST SUITE');
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

// Test 1: Single gather detection
console.log('[TEST 1: Single Gather Detection]');

const singleGatherTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" timeout="8" action="/continue" enhanced="true" speechModel="phone_call">
    <Say>Hello, how can I help you?</Say>
  </Gather>
</Response>`;

test('Single gather TwiML should have count of 1', () => {
  return countGatherElements(singleGatherTwiml) === 1;
});

// Test 2: Double gather detection (the bug we're preventing)
console.log('\n[TEST 2: Double Gather Detection]');

const doubleGatherTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" timeout="8" action="/continue">
    <Say>Hello, how can I help you?</Say>
  </Gather>
  <Gather input="speech" timeout="10" action="/continue">
    <Say>Are you still there?</Say>
  </Gather>
  <Say>Goodbye!</Say>
  <Hangup/>
</Response>`;

test('Double gather TwiML should be detected (count > 1)', () => {
  return countGatherElements(doubleGatherTwiml) > 1;
});

test('Double gather is a bug - should fail validation', () => {
  const count = countGatherElements(doubleGatherTwiml);
  // This test documents the bug we fixed - double gather should fail
  return count !== 1;
});

// Test 3: Enhanced attribute validation
console.log('\n[TEST 3: Enhanced Attribute Validation]');

const enhancedWithPhoneCall = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" enhanced="true" speechModel="phone_call" action="/continue">
    <Say>Hello</Say>
  </Gather>
</Response>`;

const enhancedWithoutPhoneCall = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" enhanced="true" action="/continue">
    <Say>Hello</Say>
  </Gather>
</Response>`;

test('Enhanced with phone_call model is valid', () => {
  return !hasEnhancedWithoutPhoneCall(enhancedWithPhoneCall);
});

test('Enhanced without phone_call model should be flagged', () => {
  return hasEnhancedWithoutPhoneCall(enhancedWithoutPhoneCall);
});

// Test 4: Real TwiML generation simulation
console.log('\n[TEST 4: Real TwiML Generation]');

function generateGreetingTwiml(): string {
  const vr = new twilio.twiml.VoiceResponse();

  const gather = vr.gather({
    input: ['speech'],
    timeout: 8,
    speechTimeout: 'auto',
    action: '/api/voice/openai-continue?callSid=test123',
    method: 'POST',
    enhanced: true,
    speechModel: 'phone_call',
    bargeIn: true,
    actionOnEmptyResult: true,
    hints: 'appointment, booking'
  });

  gather.say({ voice: 'Polly.Olivia' }, 'Hello, how can I help you today?');

  // NO second gather - this is the fix
  return vr.toString();
}

const generatedTwiml = generateGreetingTwiml();

test('Generated greeting TwiML has exactly one Gather', () => {
  return countGatherElements(generatedTwiml) === 1;
});

test('Generated TwiML has actionOnEmptyResult', () => {
  return generatedTwiml.includes('actionOnEmptyResult="true"');
});

test('Generated TwiML has phone_call model with enhanced', () => {
  return !hasEnhancedWithoutPhoneCall(generatedTwiml);
});

// Test 5: Empty speech handler simulation
console.log('\n[TEST 5: Empty Speech Handler]');

function generateEmptySpeechResponse(emptyCount: number): string {
  const vr = new twilio.twiml.VoiceResponse();

  if (emptyCount >= 2) {
    vr.say({ voice: 'Polly.Olivia' }, 'Thanks for calling. Have a great day!');
    vr.hangup();
    return vr.toString();
  }

  const gather = vr.gather({
    input: ['speech'],
    timeout: 10,
    speechTimeout: 'auto',
    action: `/api/voice/openai-continue?callSid=test123&emptyCount=${emptyCount + 1}`,
    method: 'POST',
    enhanced: true,
    speechModel: 'phone_call',
    bargeIn: true,
    actionOnEmptyResult: true,
    hints: 'yes, no, goodbye'
  });

  gather.say({ voice: 'Polly.Olivia' }, 'Are you still there?');

  // NO second gather or hangup after gather
  return vr.toString();
}

test('Empty speech handler (count=0) has exactly one Gather', () => {
  const twiml = generateEmptySpeechResponse(0);
  return countGatherElements(twiml) === 1;
});

test('Empty speech handler (count=1) has exactly one Gather', () => {
  const twiml = generateEmptySpeechResponse(1);
  return countGatherElements(twiml) === 1;
});

test('Empty speech handler (count=2) has NO Gather (hangup)', () => {
  const twiml = generateEmptySpeechResponse(2);
  return countGatherElements(twiml) === 0 && twiml.includes('<Hangup');
});

test('Empty speech handler increments emptyCount in action URL', () => {
  const twiml = generateEmptySpeechResponse(0);
  return twiml.includes('emptyCount=1');
});

// Summary
console.log('\n============================================================');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL TWIML SINGLE GATHER TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
console.log('============================================================');
