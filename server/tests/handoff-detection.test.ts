/**
 * Handoff Detection Tests
 * 
 * Tests handoff trigger detection for various scenarios
 * 
 * Run: node --import tsx server/tests/handoff-detection.test.ts
 */

import { 
  detectHandoffTrigger, 
  detectExplicitHumanRequest,
  detectProfanity,
  detectRepeatedHello,
  detectFrustrationLoop
} from '../utils/handoff-detector';

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

console.log('\n[Handoff Detection Tests]\n');

// Test 1: Explicit human request detection
console.log('Test 1: Explicit human request detection');
{
  assert(detectExplicitHumanRequest("I want to speak to a human"), 'Detects "speak to a human"');
  assert(detectExplicitHumanRequest("Can I talk to someone?"), 'Detects "talk to someone"');
  assert(detectExplicitHumanRequest("Transfer me to receptionist"), 'Detects "transfer to receptionist"');
  assert(detectExplicitHumanRequest("I need help"), 'Detects "need help"');
  assert(detectExplicitHumanRequest("This isn't working"), 'Detects frustration phrases');
  assert(!detectExplicitHumanRequest("I want to book an appointment"), 'Does NOT trigger on booking request');
  assert(!detectExplicitHumanRequest("What are your hours?"), 'Does NOT trigger on FAQ');
}

// Test 2: Profanity detection
console.log('\nTest 2: Profanity detection');
{
  assert(detectProfanity("This is bloody annoying"), 'Detects profanity');
  assert(detectProfanity("What the hell"), 'Detects profanity');
  assert(!detectProfanity("Hello, I need help"), 'Does NOT trigger on normal speech');
  assert(!detectProfanity("I want to book an appointment"), 'Does NOT trigger on booking');
}

// Test 3: Repeated hello detection
console.log('\nTest 3: Repeated hello detection');
{
  const history1 = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi, how can I help?' },
    { role: 'user', content: 'Hello?' },
    { role: 'assistant', content: 'I\'m here, what can I do?' }
  ];
  assert(detectRepeatedHello(history1), 'Detects repeated hello (2+)');
  
  const history2 = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi, how can I help?' }
  ];
  assert(!detectRepeatedHello(history2), 'Does NOT trigger on single hello');
  
  const history3 = [
    { role: 'user', content: 'I want to book' },
    { role: 'assistant', content: 'Sure, when?' }
  ];
  assert(!detectRepeatedHello(history3), 'Does NOT trigger without hello');
}

// Test 4: Frustration loop detection
console.log('\nTest 4: Frustration loop detection');
{
  const history1 = [
    { role: 'assistant', content: "I didn't catch that" },
    { role: 'assistant', content: "Could you repeat that?" }
  ];
  assert(detectFrustrationLoop(history1, 2), 'Detects 2 consecutive no-match');
  assert(detectFrustrationLoop([], 2), 'Detects noMatchCount >= 2');
  assert(!detectFrustrationLoop([], 1), 'Does NOT trigger on single no-match');
  
  const history2 = [
    { role: 'assistant', content: "I didn't catch that" },
    { role: 'assistant', content: "Here are some times available" }
  ];
  assert(!detectFrustrationLoop(history2, 1), 'Does NOT trigger when match occurs');
}

// Test 5: Full handoff detection - explicit request
console.log('\nTest 5: Full handoff detection - explicit request');
{
  const result = detectHandoffTrigger(
    "I want to speak to a real person",
    [],
    { noMatchCount: 0, confidence: 1.0 }
  );
  assert(result.shouldTrigger === true, 'Triggers on explicit request');
  assert(result.trigger === 'explicit_request', 'Correct trigger type');
  assert(result.confidence > 0.9, 'High confidence for explicit request');
}

// Test 6: Full handoff detection - profanity
console.log('\nTest 6: Full handoff detection - profanity');
{
  const result = detectHandoffTrigger(
    "This is bloody frustrating",
    [],
    { noMatchCount: 0, confidence: 1.0 }
  );
  assert(result.shouldTrigger === true, 'Triggers on profanity');
  assert(result.trigger === 'profanity', 'Correct trigger type');
}

// Test 7: Full handoff detection - frustration loop
console.log('\nTest 7: Full handoff detection - frustration loop');
{
  const history = [
    { role: 'assistant', content: "I didn't catch that" },
    { role: 'assistant', content: "Could you repeat?" }
  ];
  const result = detectHandoffTrigger(
    "I said I want an appointment",
    history,
    { noMatchCount: 2, confidence: 1.0 }
  );
  assert(result.shouldTrigger === true, 'Triggers on frustration loop');
  assert(result.trigger === 'frustration_loop', 'Correct trigger type');
}

// Test 8: Full handoff detection - repeated hello
console.log('\nTest 8: Full handoff detection - repeated hello');
{
  const history = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi, how can I help?' },
    { role: 'user', content: 'Hello?' },
    { role: 'assistant', content: 'I\'m here' }
  ];
  const result = detectHandoffTrigger(
    "Hello?",
    history,
    { noMatchCount: 0, confidence: 1.0 }
  );
  assert(result.shouldTrigger === true, 'Triggers on repeated hello');
  assert(result.trigger === 'repeated_hello', 'Correct trigger type');
}

// Test 9: Full handoff detection - low confidence
console.log('\nTest 9: Full handoff detection - low confidence');
{
  const result = detectHandoffTrigger(
    "Some unclear utterance",
    [],
    { noMatchCount: 0, confidence: 0.3 }
  );
  assert(result.shouldTrigger === true, 'Triggers on low confidence');
  assert(result.trigger === 'low_confidence', 'Correct trigger type');
}

// Test 10: Full handoff detection - out of scope
console.log('\nTest 10: Full handoff detection - out of scope');
{
  const result = detectHandoffTrigger(
    "I need help with my insurance claim",
    [],
    { noMatchCount: 0, confidence: 1.0, isOutOfScope: true }
  );
  assert(result.shouldTrigger === true, 'Triggers on out of scope');
  assert(result.trigger === 'out_of_scope', 'Correct trigger type');
}

// Test 11: Full handoff detection - Cliniko error
console.log('\nTest 11: Full handoff detection - Cliniko error');
{
  const result = detectHandoffTrigger(
    "I want to book",
    [],
    { noMatchCount: 0, confidence: 1.0, hasClinikoError: true }
  );
  assert(result.shouldTrigger === true, 'Triggers on Cliniko error');
  assert(result.trigger === 'cliniko_error', 'Correct trigger type');
}

// Test 12: No trigger - normal conversation
console.log('\nTest 12: No trigger - normal conversation');
{
  const result = detectHandoffTrigger(
    "I'd like to book an appointment for tomorrow",
    [],
    { noMatchCount: 0, confidence: 0.9 }
  );
  assert(result.shouldTrigger === false, 'Does NOT trigger on normal booking request');
}

console.log('\n═══════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(`✅ All ${passed} tests passed!`);
  console.log('\nHandoff detection is working correctly.');
} else {
  console.error(`❌ ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log('═══════════════════════════════════════════════════════════\n');
