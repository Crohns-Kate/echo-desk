/**
 * AI Dialogue Flow Tests
 * End-to-end conversation flow testing
 */

import {
  processUtterance,
  type DialogueContext,
  type DialogueResponse
} from '../ai/dialogueManager';
import {
  initializeMemory,
  getMemory,
  clearMemory
} from '../ai/stateMemory';

interface ConversationStep {
  callerSays: string;
  expectIntent?: string;
  expectActionType?: string;
  expectResponseContains?: string[];
  expectNextStep?: string;
}

interface ConversationTest {
  name: string;
  description: string;
  steps: ConversationStep[];
}

// Test conversations
const conversationTests: ConversationTest[] = [
  {
    name: 'new_patient_booking',
    description: 'New patient booking flow',
    steps: [
      {
        callerSays: "Hi, I'd like to book an appointment. I'm a new patient.",
        expectIntent: 'booking_new_patient',
        expectResponseContains: ['first', 'new']
      },
      {
        callerSays: "Yes that's right",
        expectIntent: 'confirmation',
        expectResponseContains: ['text', 'number']
      },
      {
        callerSays: "Next Monday would be great",
        expectIntent: 'booking_new_patient',
        expectNextStep: 'appointment_search'
      }
    ]
  },
  {
    name: 'returning_patient_booking',
    description: 'Returning patient booking flow',
    steps: [
      {
        callerSays: "I need to book a follow up appointment",
        expectIntent: 'booking_standard',
        expectActionType: 'lookup_patient'
      },
      {
        callerSays: "Tomorrow afternoon if possible",
        expectIntent: 'booking_standard',
        expectNextStep: 'appointment_search'
      }
    ]
  },
  {
    name: 'faq_then_booking',
    description: 'FAQ question followed by booking',
    steps: [
      {
        callerSays: "How much does a first visit cost?",
        expectIntent: 'faq_prices',
        expectResponseContains: ['$', 'cost', 'price']
      },
      {
        callerSays: "Yes I'd like to book please",
        expectIntent: 'confirmation',
        expectResponseContains: ['book', 'appointment']
      }
    ]
  },
  {
    name: 'date_change_mid_flow',
    description: 'Caller changing their mind on date',
    steps: [
      {
        callerSays: "I want to book for Monday",
        expectIntent: 'booking_standard',
        expectNextStep: 'appointment_search'
      },
      {
        callerSays: "Actually, make it Thursday instead",
        expectIntent: 'booking_standard',
        expectNextStep: 'appointment_search'
      }
    ]
  },
  {
    name: 'transfer_to_human',
    description: 'Caller requests human transfer',
    steps: [
      {
        callerSays: "Hello",
        expectIntent: 'greeting'
      },
      {
        callerSays: "Can I just speak to a person?",
        expectIntent: 'ask_human',
        expectActionType: 'transfer_to_human'
      }
    ]
  },
  {
    name: 'emergency_handling',
    description: 'Emergency detection and handling',
    steps: [
      {
        callerSays: "I'm having chest pain and difficulty breathing",
        expectIntent: 'emergency',
        expectResponseContains: ['000', 'emergency'],
        expectActionType: 'transfer_to_human'
      }
    ]
  },
  {
    name: 'multiple_questions',
    description: 'Multiple FAQ questions in sequence',
    steps: [
      {
        callerSays: "What are your hours?",
        expectIntent: 'faq_hours',
        expectResponseContains: ['open', 'Monday', 'Friday']
      },
      {
        callerSays: "And where are you located?",
        expectIntent: 'faq_location',
        expectResponseContains: ['address', 'parking']
      },
      {
        callerSays: "Do you take health insurance?",
        expectIntent: 'faq_insurance',
        expectResponseContains: ['health fund', 'HICAPS']
      }
    ]
  }
];

/**
 * Run a single conversation test
 */
async function runConversationTest(test: ConversationTest): Promise<{
  passed: boolean;
  failures: string[];
}> {
  const callSid = `test_${test.name}_${Date.now()}`;
  const failures: string[] = [];

  // Initialize memory for this test
  initializeMemory(callSid, 1);

  const context: DialogueContext = {
    callSid,
    tenantId: 1,
    clinicName: 'Test Clinic',
    timezone: 'Australia/Brisbane',
    callerPhone: '+61400000000'
  };

  console.log(`\n--- ${test.name}: ${test.description} ---`);

  for (let i = 0; i < test.steps.length; i++) {
    const step = test.steps[i];
    console.log(`\nStep ${i + 1}: "${step.callerSays}"`);

    try {
      const response = await processUtterance(step.callerSays, context);
      console.log(`  Intent: ${response.intent} (${response.confidence.toFixed(2)})`);
      console.log(`  Response: "${response.speech.substring(0, 80)}..."`);

      // Check intent
      if (step.expectIntent && response.intent !== step.expectIntent) {
        failures.push(`Step ${i + 1}: Expected intent '${step.expectIntent}', got '${response.intent}'`);
      }

      // Check action type
      if (step.expectActionType && response.action?.type !== step.expectActionType) {
        failures.push(`Step ${i + 1}: Expected action '${step.expectActionType}', got '${response.action?.type || 'none'}'`);
      }

      // Check response contains
      if (step.expectResponseContains) {
        for (const phrase of step.expectResponseContains) {
          if (!response.speech.toLowerCase().includes(phrase.toLowerCase())) {
            failures.push(`Step ${i + 1}: Response should contain '${phrase}'`);
          }
        }
      }

      // Check next step
      if (step.expectNextStep && response.nextStep !== step.expectNextStep) {
        failures.push(`Step ${i + 1}: Expected nextStep '${step.expectNextStep}', got '${response.nextStep || 'none'}'`);
      }

    } catch (error) {
      failures.push(`Step ${i + 1}: Error - ${error}`);
    }
  }

  // Clean up
  clearMemory(callSid);

  return {
    passed: failures.length === 0,
    failures
  };
}

/**
 * Run all conversation tests
 */
export async function runDialogueTests(): Promise<{
  passed: number;
  failed: number;
  results: Array<{ test: string; passed: boolean; failures: string[] }>
}> {
  const results: Array<{ test: string; passed: boolean; failures: string[] }> = [];
  let passed = 0;
  let failed = 0;

  console.log('\n=== Running Dialogue Flow Tests ===');

  for (const test of conversationTests) {
    const result = await runConversationTest(test);

    if (result.passed) {
      passed++;
      console.log(`\n✅ ${test.name} PASSED`);
    } else {
      failed++;
      console.log(`\n❌ ${test.name} FAILED:`);
      for (const failure of result.failures) {
        console.log(`   - ${failure}`);
      }
    }

    results.push({
      test: test.name,
      passed: result.passed,
      failures: result.failures
    });
  }

  console.log(`\n=== Dialogue Test Results: ${passed} passed, ${failed} failed ===\n`);

  return { passed, failed, results };
}

// Export for running from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  runDialogueTests().then(({ passed, failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}
