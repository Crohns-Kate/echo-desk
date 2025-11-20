/**
 * QA Engine Demo Script
 * Creates a mock call with transcript and runs QA analysis
 */

import { storage } from './server/storage.ts';
import { generateQAReport, logQAReport } from './server/services/qa-engine.ts';

// Create a mock call with a realistic transcript
const mockCall = {
  id: 999,
  callSid: 'QA_DEMO_CALL_001',
  fromNumber: '+61412345678',
  toNumber: '+61712345678',
  intent: 'book_appointment',
  summary: 'New patient booked appointment',
  duration: 180,
  recordingStatus: 'completed',
  transcript: `
AI: Thanks for calling. Is this your first visit with us?

Caller: Yes, it's my first time.

AI: Perfect! I'll send you a text with a link to fill out a quick form. Is the number ending in 678 the best one to text you at? Press 1 for yes, 2 for no.

Caller: Yes, that's fine.

AI: Great! I've sent you a text with a link. I'll wait right here while you fill it out - takes about 30 seconds.

[Caller fills out form]

AI: Got it! Thanks Sarah. What brings you in today?

Caller: I've been having some lower back pain for about a week now.

AI: Sorry to hear about your back pain. Let me find the next available appointment.

AI: I have 3 options available. Option 1: 9:00am tomorrow morning. Option 2: 2:30pm tomorrow afternoon. Option 3: 10:00am Monday morning. Which works best? Press 1, 2, or 3.

Caller: I'll take option 1, 9am tomorrow.

AI: Sarah, perfect! You're all set for 9:00am tomorrow with Dr. Michael. I'll text you a confirmation now.

Caller: Great, thank you!

AI: Anything else I can help with?

Caller: No, that's all. Thanks!

AI: Perfect! See you soon. Bye!
`.trim()
};

console.log('\n🎯 QA ENGINE DEMO\n');
console.log('='.repeat(60));
console.log('Analyzing mock call with transcript...\n');

// Run QA analysis
const report = await generateQAReport(mockCall);

if (report) {
  // Log the report to console
  logQAReport(report);

  console.log('\n📋 ANALYSIS SUMMARY:');
  console.log('='.repeat(60));
  console.log(`Overall Score: ${report.overallScore}/10`);
  console.log(`Issues Found: ${report.issues.length}`);
  console.log('\nScore Breakdown:');
  console.log(`  - Identity Detection:      ${report.identityDetectionScore}/10`);
  console.log(`  - Patient Classification:  ${report.patientClassificationScore}/10`);
  console.log(`  - Email Capture:           ${report.emailCaptureScore}/10`);
  console.log(`  - Appointment Type:        ${report.appointmentTypeScore}/10`);
  console.log(`  - Prompt Clarity:          ${report.promptClarityScore}/10`);

  if (report.issues.length > 0) {
    console.log('\n⚠️  Issues Detected:');
    report.issues.forEach((issue, i) => {
      console.log(`\n${i + 1}. ${issue.issue}`);
      console.log(`   📍 Location: "${issue.locationInTranscript}"`);
      console.log(`   🔍 Cause: ${issue.cause}`);
      console.log(`   💡 Fix: ${issue.recommendedFix}`);
    });
  }

  console.log('\n✅ Demo complete! This is what the QA Engine will produce for every real call.\n');
} else {
  console.log('❌ Failed to generate QA report\n');
}

process.exit(0);
