#!/usr/bin/env node
/**
 * AI Layer Test Runner
 * Run with: node test-ai-layer.mjs
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('========================================');
  console.log('Echo Desk AI Layer Test Suite');
  console.log('========================================\n');

  // Check for OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️  OPENAI_API_KEY not set - tests will use keyword fallback\n');
  } else {
    console.log('✓ OpenAI API key detected\n');
  }

  try {
    // Dynamic import of test modules (requires tsx or ts-node)
    const { runIntentTests } = await import('./server/tests/ai-intent.test.ts');
    const { runDialogueTests } = await import('./server/tests/ai-dialogue.test.ts');

    // Run intent tests
    console.log('\n📋 Intent Classification Tests');
    console.log('================================\n');
    const intentResults = await runIntentTests();

    // Run dialogue tests
    console.log('\n💬 Dialogue Flow Tests');
    console.log('================================\n');
    const dialogueResults = await runDialogueTests();

    // Summary
    console.log('\n========================================');
    console.log('FINAL SUMMARY');
    console.log('========================================');
    console.log(`Intent Tests: ${intentResults.passed} passed, ${intentResults.failed} failed`);
    console.log(`Dialogue Tests: ${dialogueResults.passed} passed, ${dialogueResults.failed} failed`);

    const totalPassed = intentResults.passed + dialogueResults.passed;
    const totalFailed = intentResults.failed + dialogueResults.failed;
    console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed`);

    if (totalFailed > 0) {
      console.log('\n❌ Some tests failed');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ Test runner error:', error);
    console.log('\nMake sure to run with tsx:');
    console.log('  npx tsx test-ai-layer.mjs');
    process.exit(1);
  }
}

main();
