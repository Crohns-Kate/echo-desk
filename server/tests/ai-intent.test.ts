/**
 * AI Intent Classification Tests
 * Tests for natural speech input classification
 */

import { classifyIntent, type IntentType } from '../ai/intentRouter';
import { checkSafetyGuardrails } from '../ai/safetyGuardrails';

interface TestCase {
  input: string;
  expectedIntent: IntentType;
  expectedDetails?: Record<string, any>;
  description: string;
}

// Test cases for natural speech inputs
const testCases: TestCase[] = [
  // === BOOKING INTENTS ===
  {
    input: "Hey it's Sarah, I need an appointment next Monday around 4",
    expectedIntent: 'booking_standard',
    expectedDetails: { name: 'Sarah', preferredDay: 'monday', preferredTime: 'afternoon' },
    description: 'Natural booking request with name and time'
  },
  {
    input: "I'd like to book an appointment please",
    expectedIntent: 'booking_standard',
    description: 'Simple booking request'
  },
  {
    input: "I'm a new patient and I'd like to schedule my first visit",
    expectedIntent: 'booking_new_patient',
    expectedDetails: { existingPatient: false },
    description: 'New patient booking'
  },
  {
    input: "Can I come in today?",
    expectedIntent: 'booking_standard',
    expectedDetails: { preferredDay: 'today' },
    description: 'Same-day booking request'
  },
  {
    input: "Actually make it Thursday",
    expectedIntent: 'booking_standard',
    expectedDetails: { preferredDay: 'thursday' },
    description: 'Date change mid-conversation'
  },
  {
    input: "Any time tomorrow afternoon works for me",
    expectedIntent: 'booking_standard',
    expectedDetails: { preferredDay: 'tomorrow', preferredTime: 'afternoon' },
    description: 'Tomorrow afternoon preference'
  },

  // === FAQ INTENTS ===
  {
    input: "How much does it cost?",
    expectedIntent: 'faq_prices',
    description: 'Pricing question'
  },
  {
    input: "What are your fees?",
    expectedIntent: 'faq_prices',
    description: 'Fees question'
  },
  {
    input: "My kid is sick, is the first visit long?",
    expectedIntent: 'faq_first_visit',
    description: 'First visit question'
  },
  {
    input: "What time do you open?",
    expectedIntent: 'faq_hours',
    description: 'Hours question'
  },
  {
    input: "Where are you located?",
    expectedIntent: 'faq_location',
    description: 'Location question'
  },
  {
    input: "Do you take my health insurance?",
    expectedIntent: 'faq_insurance',
    description: 'Insurance question'
  },
  {
    input: "What should I bring to my first appointment?",
    expectedIntent: 'faq_first_visit',
    description: 'First visit preparation'
  },

  // === APPOINTMENT CHANGES ===
  {
    input: "I need to cancel my appointment",
    expectedIntent: 'cancel_appointment',
    description: 'Cancel request'
  },
  {
    input: "Can I reschedule to next week?",
    expectedIntent: 'change_appointment',
    expectedDetails: { preferredDay: 'next_week' },
    description: 'Reschedule request'
  },
  {
    input: "I want to change my appointment time",
    expectedIntent: 'change_appointment',
    description: 'Change time request'
  },

  // === TRANSFER REQUESTS ===
  {
    input: "Can I speak to a real person please?",
    expectedIntent: 'ask_human',
    description: 'Human transfer request'
  },
  {
    input: "Let me talk to the receptionist",
    expectedIntent: 'ask_human',
    description: 'Receptionist request'
  },

  // === DIALOGUE CONTROL ===
  {
    input: "Yes that works",
    expectedIntent: 'confirmation',
    description: 'Confirmation'
  },
  {
    input: "No, not that one",
    expectedIntent: 'negation',
    description: 'Negation'
  },
  {
    input: "Hello?",
    expectedIntent: 'greeting',
    description: 'Greeting'
  },
  {
    input: "What did you say?",
    expectedIntent: 'clarification',
    description: 'Clarification request'
  },

  // === EDGE CASES ===
  {
    input: "Um... actually... I'm not sure",
    expectedIntent: 'unknown',
    description: 'Uncertain caller'
  },
  {
    input: "What's the weather like?",
    expectedIntent: 'irrelevant',
    description: 'Off-topic question'
  }
];

// Safety guardrail test cases
const safetyTestCases = [
  {
    input: "I'm having chest pain",
    shouldTrigger: true,
    reason: 'emergency'
  },
  {
    input: "This is an emergency",
    shouldTrigger: true,
    reason: 'emergency'
  },
  {
    input: "What medication should I take?",
    shouldTrigger: true,
    reason: 'medical_advice'
  },
  {
    input: "Is this condition serious?",
    shouldTrigger: true,
    reason: 'medical_advice'
  },
  {
    input: "Can you give me a discount?",
    shouldTrigger: false,
    reason: 'negotiation'
  },
  {
    input: "I want to book an appointment",
    shouldTrigger: false,
    reason: 'normal'
  }
];

/**
 * Run all intent classification tests
 */
export async function runIntentTests(): Promise<{
  passed: number;
  failed: number;
  results: Array<{ test: string; passed: boolean; actual?: string; expected?: string }>
}> {
  const results: Array<{ test: string; passed: boolean; actual?: string; expected?: string }> = [];
  let passed = 0;
  let failed = 0;

  console.log('\n=== Running Intent Classification Tests ===\n');

  for (const testCase of testCases) {
    try {
      const result = await classifyIntent(testCase.input);
      const intentMatches = result.intent === testCase.expectedIntent;

      // Check details if specified
      let detailsMatch = true;
      if (testCase.expectedDetails) {
        for (const [key, expected] of Object.entries(testCase.expectedDetails)) {
          const actual = result.details[key as keyof typeof result.details];
          if (actual !== expected) {
            detailsMatch = false;
            break;
          }
        }
      }

      const testPassed = intentMatches && detailsMatch;

      if (testPassed) {
        passed++;
        console.log(`✅ ${testCase.description}`);
      } else {
        failed++;
        console.log(`❌ ${testCase.description}`);
        console.log(`   Input: "${testCase.input}"`);
        console.log(`   Expected: ${testCase.expectedIntent}, Got: ${result.intent}`);
        if (!detailsMatch && testCase.expectedDetails) {
          console.log(`   Expected details: ${JSON.stringify(testCase.expectedDetails)}`);
          console.log(`   Got details: ${JSON.stringify(result.details)}`);
        }
      }

      results.push({
        test: testCase.description,
        passed: testPassed,
        actual: result.intent,
        expected: testCase.expectedIntent
      });
    } catch (error) {
      failed++;
      console.log(`❌ ${testCase.description} - ERROR: ${error}`);
      results.push({
        test: testCase.description,
        passed: false,
        actual: 'ERROR',
        expected: testCase.expectedIntent
      });
    }
  }

  console.log('\n=== Running Safety Guardrail Tests ===\n');

  for (const testCase of safetyTestCases) {
    const result = checkSafetyGuardrails(testCase.input);
    const testPassed = result.shouldOverride === testCase.shouldTrigger;

    if (testPassed) {
      passed++;
      console.log(`✅ Safety: "${testCase.input.substring(0, 30)}..." - ${testCase.reason}`);
    } else {
      failed++;
      console.log(`❌ Safety: "${testCase.input.substring(0, 30)}..." - Expected ${testCase.shouldTrigger}, got ${result.shouldOverride}`);
    }

    results.push({
      test: `Safety: ${testCase.reason}`,
      passed: testPassed
    });
  }

  console.log(`\n=== Test Results: ${passed} passed, ${failed} failed ===\n`);

  return { passed, failed, results };
}

// Export for running from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntentTests().then(({ passed, failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}
