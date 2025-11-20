import { env } from '../utils/env';
import type { CallLog } from '@shared/schema';

export interface QAIssue {
  issue: string;
  cause: string;
  locationInTranscript: string;
  recommendedFix: string;
}

export interface QAReport {
  callSid: string;
  identityDetectionScore: number; // 0-10
  patientClassificationScore: number; // 0-10
  emailCaptureScore: number; // 0-10
  appointmentTypeScore: number; // 0-10
  promptClarityScore: number; // 0-10
  overallScore: number; // 0-10
  issues: QAIssue[];
}

/**
 * Analyze a completed call and generate a detailed QA report
 * Uses LLM to analyze transcript and call context
 */
export async function generateQAReport(call: CallLog): Promise<QAReport | null> {
  if (!call.transcript || call.transcript.length < 10) {
    console.log('[QA_ENGINE] ⏭️  Skipping QA - no transcript available for call:', call.callSid);
    return null;
  }

  console.log('[QA_ENGINE] 🔍 Generating QA report for call:', call.callSid);

  try {
    // Use LLM to analyze the call
    const report = await analyzeWithLLM(call);

    console.log('[QA_ENGINE] ✅ QA Report generated:', {
      callSid: call.callSid,
      overallScore: report.overallScore,
      issuesFound: report.issues.length
    });

    return report;
  } catch (error: any) {
    console.error('[QA_ENGINE] ❌ Failed to generate QA report:', error.message);
    console.error('[QA_ENGINE]   Stack:', error.stack);

    // Fall back to rule-based analysis
    return analyzeWithRules(call);
  }
}

/**
 * LLM-powered QA analysis using OpenAI
 */
async function analyzeWithLLM(call: CallLog): Promise<QAReport> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const prompt = `You are a QA analyst for an AI voice receptionist system used by medical clinics. Your task is to analyze this call transcript and generate a detailed quality assurance report.

**Call Metadata:**
- Call SID: ${call.callSid}
- Duration: ${call.duration || 0} seconds
- Intent: ${call.intent || 'unknown'}
- Summary: ${call.summary || 'N/A'}
- From: ${call.fromNumber || 'unknown'}
- Recording Status: ${call.recordingStatus || 'N/A'}

**Transcript:**
${call.transcript}

**Your Task:**
Analyze this call across 5 key dimensions and provide scores from 0-10 for each:

1. **Identity Detection Score (0-10)**: How well did the system identify and verify the caller?
   - Did it correctly determine if they were a new or returning patient?
   - If returning, did it successfully look up their record?
   - If new, did it properly collect their information?

2. **Patient Classification Score (0-10)**: How accurately did the system classify the patient type?
   - Was the new vs returning detection accurate?
   - Were there any misclassifications or confusion?

3. **Email Capture Score (0-10)**: How well did the system capture email information?
   - For new patients: Was email collected via the form?
   - Was it validated properly?
   - (Score 10 if email not needed for this call type)

4. **Appointment Type Score (0-10)**: How well did the system select the correct appointment type?
   - Was the right appointment duration chosen (new patient vs standard)?
   - Did it match the patient type correctly?
   - (Score 10 if no appointment was booked but process was correct)

5. **Prompt Clarity Score (0-10)**: How clear and effective were the AI's prompts?
   - Were questions easy to understand?
   - Did the caller understand what was being asked?
   - Were there repetitions or confusions?

**Overall Score (0-10)**: Weighted average based on all dimensions.

**Issues Detection:**
Identify specific issues that occurred during the call. For each issue provide:
- **issue**: Brief title (e.g., "Failed to recognize returning patient")
- **cause**: Root cause analysis (e.g., "Phone number lookup returned no results")
- **locationInTranscript**: Quote from transcript showing where this happened (max 100 chars)
- **recommendedFix**: Specific actionable fix (e.g., "Add fuzzy phone matching or DOB verification")

Return **ONLY** a JSON object with this exact structure:
{
  "identityDetectionScore": number (0-10),
  "patientClassificationScore": number (0-10),
  "emailCaptureScore": number (0-10),
  "appointmentTypeScore": number (0-10),
  "promptClarityScore": number (0-10),
  "overallScore": number (0-10),
  "issues": [
    {
      "issue": "string",
      "cause": "string",
      "locationInTranscript": "string (quote from transcript, max 100 chars)",
      "recommendedFix": "string"
    }
  ]
}

**Important Guidelines:**
- Be objective and specific
- If a dimension doesn't apply to this call, score it 10/10
- Focus on systemic issues, not one-off caller mistakes
- Provide actionable fixes, not vague suggestions
- Quote actual phrases from the transcript in locationInTranscript`;

  const baseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2, // Low temperature for consistent analysis
      max_tokens: 2000,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';

  let result;
  try {
    result = JSON.parse(content);
  } catch (parseError) {
    console.error('[QA_ENGINE] Failed to parse LLM response:', content);
    throw new Error('Invalid JSON response from LLM');
  }

  return {
    callSid: call.callSid || '',
    identityDetectionScore: result.identityDetectionScore || 5,
    patientClassificationScore: result.patientClassificationScore || 5,
    emailCaptureScore: result.emailCaptureScore || 5,
    appointmentTypeScore: result.appointmentTypeScore || 5,
    promptClarityScore: result.promptClarityScore || 5,
    overallScore: result.overallScore || 5,
    issues: result.issues || []
  };
}

/**
 * Rule-based QA analysis as fallback when LLM is unavailable
 */
function analyzeWithRules(call: CallLog): QAReport {
  const transcript = call.transcript || '';
  const lowerTranscript = transcript.toLowerCase();
  const issues: QAIssue[] = [];

  let identityDetectionScore = 8;
  let patientClassificationScore = 8;
  let emailCaptureScore = 10;
  let appointmentTypeScore = 10;
  let promptClarityScore = 8;

  // Check for identity detection issues
  if (lowerTranscript.includes("don't see an account") || lowerTranscript.includes("couldn't find")) {
    if (call.intent?.includes('returning') || lowerTranscript.includes('been here before')) {
      identityDetectionScore = 4;
      issues.push({
        issue: 'Failed to find returning patient record',
        cause: 'Phone lookup returned no results despite caller indicating they are returning',
        locationInTranscript: extractQuote(transcript, ["don't see an account", "couldn't find"]),
        recommendedFix: 'Improve phone number matching (fuzzy search, try without country code, check alternate formats)'
      });
    }
  }

  // Check for multiple patient disambiguation
  if (lowerTranscript.includes('few accounts') || lowerTranscript.includes('which one are you')) {
    identityDetectionScore = 7;
    issues.push({
      issue: 'Multiple patients found with same phone',
      cause: 'Phone number shared between multiple patient records',
      locationInTranscript: extractQuote(transcript, ['few accounts', 'which one are you']),
      recommendedFix: 'Implement DOB verification or ask for additional identifying information'
    });
  }

  // Check for patient classification issues
  const hasNewPatientConfusion = lowerTranscript.includes('first visit') && lowerTranscript.includes("don't see an account");
  if (hasNewPatientConfusion) {
    patientClassificationScore = 6;
    // Already captured in identity detection, so we don't duplicate the issue
  }

  // Check for email capture issues (for new patients)
  if (lowerTranscript.includes('new patient') || lowerTranscript.includes('first visit')) {
    if (lowerTranscript.includes('sent you a text') || lowerTranscript.includes('fill out')) {
      emailCaptureScore = 10; // Form was sent, assume email will be captured
    } else {
      emailCaptureScore = 5;
      issues.push({
        issue: 'New patient email may not have been captured',
        cause: 'No indication of form being sent for new patient intake',
        locationInTranscript: extractQuote(transcript, ['new patient', 'first visit']),
        recommendedFix: 'Ensure new patient form link is always sent via SMS'
      });
    }
  }

  // Check for appointment type issues
  const appointmentBooked = call.summary?.toLowerCase().includes('booked') ||
                            call.summary?.toLowerCase().includes('appointment') ||
                            lowerTranscript.includes("you're all set");
  if (appointmentBooked) {
    // Check if correct appointment type was used based on patient type
    const isNewPatient = lowerTranscript.includes('new patient') || lowerTranscript.includes('first visit');
    // We can't verify this without call context, so assume correct
    appointmentTypeScore = 9;
  }

  // Check for prompt clarity issues
  const sorryCount = (lowerTranscript.match(/sorry|apologize|didn't catch/g) || []).length;
  if (sorryCount > 3) {
    promptClarityScore = 5;
    issues.push({
      issue: 'Excessive repetitions and apologies',
      cause: 'Multiple failed attempts to understand caller responses',
      locationInTranscript: `[${sorryCount} instances of "sorry" or "didn't catch"]`,
      recommendedFix: 'Improve speech recognition hints, simplify prompts, add DTMF fallback options'
    });
  }

  // Check for confusion or frustration
  const frustrationWords = ['frustrated', 'confused', 'what', 'unclear', 'don\'t understand'];
  const frustrationDetected = frustrationWords.some(word => lowerTranscript.includes(word));
  if (frustrationDetected) {
    promptClarityScore = Math.max(3, promptClarityScore - 2);
    issues.push({
      issue: 'Caller confusion or frustration detected',
      cause: 'Prompts may be unclear or caller expectations not met',
      locationInTranscript: extractQuote(transcript, frustrationWords),
      recommendedFix: 'Review prompt wording, add more context, offer human transfer earlier'
    });
  }

  // Check for technical errors
  if (lowerTranscript.includes('having trouble') || lowerTranscript.includes('error') ||
      lowerTranscript.includes('not working')) {
    promptClarityScore = Math.max(2, promptClarityScore - 3);
    issues.push({
      issue: 'Technical error occurred during call',
      cause: 'System error or integration failure',
      locationInTranscript: extractQuote(transcript, ['having trouble', 'error', 'not working']),
      recommendedFix: 'Review system logs, check Cliniko API status, improve error handling'
    });
  }

  // Calculate overall score (weighted average)
  const overallScore = Math.round(
    (identityDetectionScore * 0.25 +
     patientClassificationScore * 0.20 +
     emailCaptureScore * 0.15 +
     appointmentTypeScore * 0.20 +
     promptClarityScore * 0.20)
  );

  return {
    callSid: call.callSid || '',
    identityDetectionScore,
    patientClassificationScore,
    emailCaptureScore,
    appointmentTypeScore,
    promptClarityScore,
    overallScore,
    issues
  };
}

/**
 * Extract a relevant quote from transcript containing one of the keywords
 */
function extractQuote(transcript: string, keywords: string[]): string {
  const maxLength = 100;

  for (const keyword of keywords) {
    const index = transcript.toLowerCase().indexOf(keyword.toLowerCase());
    if (index !== -1) {
      // Extract surrounding context
      const start = Math.max(0, index - 30);
      const end = Math.min(transcript.length, index + 70);
      let quote = transcript.substring(start, end).trim();

      // Add ellipsis if truncated
      if (start > 0) quote = '...' + quote;
      if (end < transcript.length) quote = quote + '...';

      // Truncate if still too long
      if (quote.length > maxLength) {
        quote = quote.substring(0, maxLength) + '...';
      }

      return quote;
    }
  }

  // If no keyword found, return first part of transcript
  return transcript.substring(0, Math.min(maxLength, transcript.length)) + '...';
}

/**
 * Print QA report to console for monitoring
 */
export function logQAReport(report: QAReport): void {
  console.log('[QA_ENGINE] 📊 ═══════════════════════════════════════════════');
  console.log('[QA_ENGINE] 📊 QA REPORT FOR CALL:', report.callSid);
  console.log('[QA_ENGINE] 📊 ═══════════════════════════════════════════════');
  console.log('[QA_ENGINE]');
  console.log('[QA_ENGINE] 🎯 SCORES (0-10 scale):');
  console.log(`[QA_ENGINE]   Overall Score:              ${formatScore(report.overallScore)}/10`);
  console.log(`[QA_ENGINE]   Identity Detection:         ${formatScore(report.identityDetectionScore)}/10`);
  console.log(`[QA_ENGINE]   Patient Classification:     ${formatScore(report.patientClassificationScore)}/10`);
  console.log(`[QA_ENGINE]   Email Capture:              ${formatScore(report.emailCaptureScore)}/10`);
  console.log(`[QA_ENGINE]   Appointment Type:           ${formatScore(report.appointmentTypeScore)}/10`);
  console.log(`[QA_ENGINE]   Prompt Clarity:             ${formatScore(report.promptClarityScore)}/10`);
  console.log('[QA_ENGINE]');

  if (report.issues.length > 0) {
    console.log(`[QA_ENGINE] ⚠️  ISSUES DETECTED (${report.issues.length}):`);
    report.issues.forEach((issue, index) => {
      console.log(`[QA_ENGINE]   ${index + 1}. ${issue.issue}`);
      console.log(`[QA_ENGINE]      Cause: ${issue.cause}`);
      console.log(`[QA_ENGINE]      Location: "${issue.locationInTranscript}"`);
      console.log(`[QA_ENGINE]      Fix: ${issue.recommendedFix}`);
      console.log('[QA_ENGINE]');
    });
  } else {
    console.log('[QA_ENGINE] ✅ No issues detected - excellent call quality!');
    console.log('[QA_ENGINE]');
  }

  console.log('[QA_ENGINE] 📊 ═══════════════════════════════════════════════');
}

/**
 * Format score with color indicator
 */
function formatScore(score: number): string {
  if (score >= 9) return `${score} ✅`;
  if (score >= 7) return `${score} 👍`;
  if (score >= 5) return `${score} ⚠️`;
  return `${score} ❌`;
}
