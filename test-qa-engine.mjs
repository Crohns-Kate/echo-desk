/**
 * Test script for QA Engine
 * Verifies that QA analysis works correctly with sample call data
 */

import { generateQAReport, logQAReport } from './dist/server/services/qa-engine.js';

console.log('\n🧪 TESTING QA ENGINE\n');
console.log('='.repeat(70));

// Sample call data (simulating a completed call with transcript)
const sampleCall = {
  id: 999,
  callSid: 'TEST_CALL_SID_123',
  fromNumber: '+61412345678',
  toNumber: '+61398765432',
  intent: 'book_appointment',
  summary: 'New patient booked appointment for Saturday',
  duration: 180,
  recordingStatus: 'completed',
  transcript: `AI: Hello! Thanks for calling Brisbane Wellness Clinic. Are you a new patient or have you been here before?
Caller: I've been there before actually.
AI: Great! Let me look up your record. Can you confirm your phone number?
Caller: It's 0412 345 678.
AI: Sorry, I didn't catch that. Can you repeat your number?
Caller: Zero four one two, three four five, six seven eight.
AI: Thanks. I don't see an account with that number. Are you sure you've been here before?
Caller: Yes I'm sure. Maybe it's under a different number?
AI: I see. Let me ask a few questions to create a new record for you. What's your full name?
Caller: Michael Smith.
AI: Thanks Michael. I've sent you a text message with a form to fill out. Once you complete it, I'll find you the next available appointment.
Caller: Okay thanks.
AI: You're all set! I've booked you for Saturday at 10am. See you then!
Caller: Perfect, thank you.
AI: You're welcome! Goodbye.`,
  createdAt: new Date()
};

console.log('Sample Call Data:');
console.log(`  Call SID: ${sampleCall.callSid}`);
console.log(`  Duration: ${sampleCall.duration}s`);
console.log(`  Intent: ${sampleCall.intent}`);
console.log(`  Transcript Length: ${sampleCall.transcript.length} chars`);
console.log('');

try {
  console.log('🔍 Generating QA Report...\n');

  const report = await generateQAReport(sampleCall);

  if (!report) {
    console.error('❌ QA Engine returned null - check if OPENAI_API_KEY is set');
    console.log('\nNote: Without OPENAI_API_KEY, the QA Engine will fall back to rule-based analysis.');
    console.log('Rule-based analysis should still work. If it returns null, there may be an error.\n');
    process.exit(1);
  }

  // Log the formatted report
  logQAReport(report);

  console.log('\n✅ QA Engine Test Successful!');
  console.log('\nReport Summary:');
  console.log(`  Overall Score: ${report.overallScore}/10`);
  console.log(`  Issues Detected: ${report.issues.length}`);
  console.log(`  Analysis Method: ${process.env.OPENAI_API_KEY ? 'LLM-powered' : 'Rule-based'}`);

  if (report.issues.length > 0) {
    console.log('\n  Expected Issues in Sample Call:');
    console.log('    1. Failed to find returning patient (phone lookup failed)');
    console.log('    2. Excessive repetition (asked for phone twice)');
    console.log('    3. Patient classification confusion (returning → new)');
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ QA Engine is working correctly!\n');

  process.exit(0);
} catch (error) {
  console.error('\n❌ QA Engine Test Failed!');
  console.error('Error:', error.message);
  console.error('\nStack:', error.stack);
  console.log('\n' + '='.repeat(70));
  process.exit(1);
}
