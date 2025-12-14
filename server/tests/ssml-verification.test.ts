/**
 * SSML Verification Test
 * Ensures SSML is properly rendered in TwiML (not escaped)
 * 
 * Run: node --import tsx server/tests/ssml-verification.test.ts
 */

import twilio from 'twilio';
import { saySafeSSML, ttsGreeting } from '../utils/voice-constants';
import { getTwimlXml } from '../utils/twiml-helper';

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

console.log('\n[SSML Verification Tests]\n');

// Test 1: Verify SSML is included in TwiML output (not escaped)
console.log('Test 1: SSML tags in TwiML output');
{
  const vr = new twilio.twiml.VoiceResponse();
  const greeting = ttsGreeting('Test Clinic');
  
  // Call saySafeSSML (SSML will be escaped by Twilio SDK)
  saySafeSSML(vr, greeting);
  
  // Get the TwiML XML string with SSML unescaped
  const twimlXml = getTwimlXml(vr);
  
  console.log('Generated TwiML (after unescape):');
  console.log(twimlXml);
  console.log('');
  
  // Check that SSML tags are present (not HTML-escaped)
  assert(twimlXml.includes('<break'), 'TwiML contains <break tag');
  assert(twimlXml.includes('<prosody'), 'TwiML contains <prosody tag');
  assert(twimlXml.includes('<speak>'), 'TwiML contains <speak> wrapper');
  
  // Check that tags are NOT escaped
  assert(!twimlXml.includes('&lt;break'), 'TwiML does NOT contain escaped &lt;break');
  assert(!twimlXml.includes('&lt;prosody'), 'TwiML does NOT contain escaped &lt;prosody');
  assert(!twimlXml.includes('&lt;speak'), 'TwiML does NOT contain escaped &lt;speak');
}

// Test 2: Verify break tags work
console.log('\nTest 2: Break tags in SSML');
{
  const vr = new twilio.twiml.VoiceResponse();
  const testSSML = '<speak>Hello<break time="300ms"/>World</speak>';
  
  saySafeSSML(vr, testSSML);
  const twimlXml = getTwimlXml(vr);
  
  assert(twimlXml.includes('<break time="300ms"/>'), 'Break tag preserved with time attribute');
  assert(!twimlXml.includes('&lt;break'), 'Break tag not HTML-escaped');
}

// Test 3: Verify prosody tags work
console.log('\nTest 3: Prosody tags in SSML');
{
  const vr = new twilio.twiml.VoiceResponse();
  const testSSML = '<speak><prosody pitch="+5%">Hello</prosody></speak>';
  
  saySafeSSML(vr, testSSML);
  const twimlXml = getTwimlXml(vr);
  
  assert(twimlXml.includes('<prosody pitch="+5%">'), 'Prosody tag preserved with pitch attribute');
  assert(!twimlXml.includes('&lt;prosody'), 'Prosody tag not HTML-escaped');
}

// Test 4: Verify only one <speak> wrapper
console.log('\nTest 4: Single speak wrapper');
{
  const vr = new twilio.twiml.VoiceResponse();
  const testSSML = '<speak>Already wrapped</speak>';
  
  saySafeSSML(vr, testSSML);
  const twimlXml = getTwimlXml(vr);
  
  // Count occurrences of <speak>
  const speakMatches = (twimlXml.match(/<speak>/g) || []).length;
  assert(speakMatches === 1, `Exactly one <speak> wrapper (found ${speakMatches})`);
}

// Test 5: Verify actual greeting helper output
console.log('\nTest 5: ttsGreeting helper output');
{
  const greeting = ttsGreeting('Spinalogic');
  assert(greeting.includes('<prosody'), 'Greeting contains prosody tag');
  assert(greeting.includes('<break'), 'Greeting contains break tag');
  assert(greeting.includes('pitch="+5%"'), 'Greeting contains pitch lift');
}

console.log('\n═══════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(`✅ All ${passed} tests passed!`);
  console.log('\nSSML is properly rendered in TwiML (not escaped).');
} else {
  console.error(`❌ ${failed} test(s) failed, ${passed} passed`);
  console.error('\n⚠️  SSML may be getting escaped - check Twilio SDK implementation.');
  process.exit(1);
}
console.log('═══════════════════════════════════════════════════════════\n');
