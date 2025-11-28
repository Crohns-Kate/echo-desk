import { env } from '../utils/env';
import { storage } from '../storage';
import type { CallLog } from '@shared/schema';

export interface QualityMetrics {
  callSid: string;
  overallScore: number; // 0-100
  clarity: number; // 0-100
  efficiency: number; // 0-100
  successfulResolution: boolean;
  issues: QualityIssue[];
  suggestions: string[];
  conversationFlow: ConversationFlowAnalysis;
}

export interface QualityIssue {
  type: 'misunderstanding' | 'repetition' | 'unclear_intent' | 'escalation' | 'timeout' | 'technical_error' | 'poor_flow';
  severity: 'low' | 'medium' | 'high';
  description: string;
  timestamp?: string;
}

export interface ConversationFlowAnalysis {
  totalTurns: number;
  averageTurnLength: number;
  intentRecognitionSuccess: boolean;
  dataCollectionSuccess: boolean;
  appointmentBookingSuccess: boolean;
  customerSatisfactionIndicators: {
    frustrationDetected: boolean;
    positiveLanguage: boolean;
    completedSuccessfully: boolean;
  };
}

/**
 * Analyze call quality using AI to identify improvement areas
 */
export async function analyzeCallQuality(call: CallLog): Promise<QualityMetrics | null> {
  if (!call.transcript || call.transcript.length < 10) {
    console.log('[QUALITY] Skipping analysis - no transcript available');
    return null;
  }

  console.log('[QUALITY] 🔍 Analyzing call quality for:', call.callSid);

  try {
    // Use LLM to analyze communication quality
    const llmAnalysis = await analyzeWithLLM(call);

    // Combine with rule-based analysis
    const ruleBasedAnalysis = analyzeWithRules(call);

    // Merge results
    const metrics: QualityMetrics = {
      callSid: call.callSid || '',
      overallScore: Math.round((llmAnalysis.overallScore + ruleBasedAnalysis.overallScore) / 2),
      clarity: Math.round((llmAnalysis.clarity + ruleBasedAnalysis.clarity) / 2),
      efficiency: Math.round((llmAnalysis.efficiency + ruleBasedAnalysis.efficiency) / 2),
      successfulResolution: llmAnalysis.successfulResolution || ruleBasedAnalysis.successfulResolution,
      issues: [...llmAnalysis.issues, ...ruleBasedAnalysis.issues],
      suggestions: [...llmAnalysis.suggestions, ...ruleBasedAnalysis.suggestions],
      conversationFlow: {
        ...llmAnalysis.conversationFlow,
        // Merge satisfaction indicators
        customerSatisfactionIndicators: {
          frustrationDetected: llmAnalysis.conversationFlow.customerSatisfactionIndicators.frustrationDetected ||
                               ruleBasedAnalysis.conversationFlow.customerSatisfactionIndicators.frustrationDetected,
          positiveLanguage: llmAnalysis.conversationFlow.customerSatisfactionIndicators.positiveLanguage ||
                           ruleBasedAnalysis.conversationFlow.customerSatisfactionIndicators.positiveLanguage,
          completedSuccessfully: llmAnalysis.conversationFlow.customerSatisfactionIndicators.completedSuccessfully &&
                                ruleBasedAnalysis.conversationFlow.customerSatisfactionIndicators.completedSuccessfully,
        }
      }
    };

    console.log('[QUALITY] ✅ Analysis complete:', {
      overallScore: metrics.overallScore,
      issuesFound: metrics.issues.length,
      suggestions: metrics.suggestions.length
    });

    return metrics;
  } catch (error: any) {
    console.error('[QUALITY] ❌ Analysis failed:', error.message);
    // Fall back to rule-based only
    return analyzeWithRules(call);
  }
}

/**
 * AI-powered analysis using LLM
 */
async function analyzeWithLLM(call: CallLog): Promise<QualityMetrics> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const prompt = `You are a communication quality analyst for a medical clinic's AI phone assistant. Analyze this call transcript and provide detailed quality metrics.

Call Details:
- Duration: ${call.duration || 0} seconds
- Intent: ${call.intent || 'unknown'}
- Summary: ${call.summary || 'N/A'}

Transcript:
${call.transcript}

Analyze the conversation for:
1. **Clarity**: Was the AI clear and easy to understand? Did it explain things well?
2. **Efficiency**: Was the conversation concise without unnecessary back-and-forth?
3. **Success**: Was the caller's need successfully addressed?
4. **Issues**: Any misunderstandings, repetitions, frustration, or unclear moments?
5. **Flow**: How well did the conversation flow? Was intent recognized? Data collected properly?

Return ONLY a JSON object with this exact schema:
{
  "overallScore": number (0-100),
  "clarity": number (0-100),
  "efficiency": number (0-100),
  "successfulResolution": boolean,
  "issues": [
    {
      "type": "misunderstanding" | "repetition" | "unclear_intent" | "escalation" | "timeout" | "technical_error" | "poor_flow",
      "severity": "low" | "medium" | "high",
      "description": "Brief description of the issue"
    }
  ],
  "suggestions": ["Specific actionable suggestion 1", "Suggestion 2"],
  "conversationFlow": {
    "totalTurns": number,
    "averageTurnLength": number,
    "intentRecognitionSuccess": boolean,
    "dataCollectionSuccess": boolean,
    "appointmentBookingSuccess": boolean,
    "customerSatisfactionIndicators": {
      "frustrationDetected": boolean,
      "positiveLanguage": boolean,
      "completedSuccessfully": boolean
    }
  }
}`;

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
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  const result = JSON.parse(content);

  return {
    callSid: call.callSid || '',
    overallScore: result.overallScore || 50,
    clarity: result.clarity || 50,
    efficiency: result.efficiency || 50,
    successfulResolution: result.successfulResolution || false,
    issues: result.issues || [],
    suggestions: result.suggestions || [],
    conversationFlow: result.conversationFlow || {
      totalTurns: 0,
      averageTurnLength: 0,
      intentRecognitionSuccess: false,
      dataCollectionSuccess: false,
      appointmentBookingSuccess: false,
      customerSatisfactionIndicators: {
        frustrationDetected: false,
        positiveLanguage: false,
        completedSuccessfully: false
      }
    }
  };
}

/**
 * Rule-based analysis as fallback
 */
function analyzeWithRules(call: CallLog): QualityMetrics {
  const transcript = call.transcript || '';
  const issues: QualityIssue[] = [];
  const suggestions: string[] = [];

  // Check for common issues
  const lowerTranscript = transcript.toLowerCase();

  // Frustration indicators
  const frustrationWords = ['frustrated', 'annoying', 'ridiculous', 'stupid', 'angry', 'upset'];
  const frustrationDetected = frustrationWords.some(word => lowerTranscript.includes(word));
  if (frustrationDetected) {
    issues.push({
      type: 'escalation',
      severity: 'high',
      description: 'Customer frustration detected in conversation'
    });
    suggestions.push('Review conversation flow to identify friction points');
  }

  // Repetition detection
  const sorryCount = (lowerTranscript.match(/sorry|apologize/g) || []).length;
  if (sorryCount > 3) {
    issues.push({
      type: 'repetition',
      severity: 'medium',
      description: 'Excessive apologies detected - may indicate confusion or errors'
    });
    suggestions.push('Improve error handling and reduce need for repeated apologies');
  }

  // Unclear intent
  if (!call.intent || call.intent === 'unknown') {
    issues.push({
      type: 'unclear_intent',
      severity: 'medium',
      description: 'Could not clearly identify caller intent'
    });
    suggestions.push('Improve intent recognition prompts or training');
  }

  // Check for operator transfer
  const operatorTransfer = lowerTranscript.includes('transferring you') ||
                          lowerTranscript.includes('speak to someone') ||
                          call.intent === 'operator';
  if (operatorTransfer) {
    issues.push({
      type: 'escalation',
      severity: 'low',
      description: 'Call required human operator intervention'
    });
    suggestions.push('Analyze why AI could not handle this request independently');
  }

  // Short call without resolution
  const duration = call.duration || 0;
  if (duration < 30 && !call.summary) {
    issues.push({
      type: 'timeout',
      severity: 'high',
      description: 'Very short call with no outcome recorded'
    });
    suggestions.push('Investigate potential technical issues or caller hangups');
  }

  // Calculate scores
  let overallScore = 80;
  let clarity = 85;
  let efficiency = 80;

  // Deduct points for issues
  issues.forEach(issue => {
    const penalty = issue.severity === 'high' ? 15 : issue.severity === 'medium' ? 10 : 5;
    overallScore -= penalty;
    if (issue.type === 'unclear_intent' || issue.type === 'poor_flow') clarity -= penalty;
    if (issue.type === 'repetition' || issue.type === 'timeout') efficiency -= penalty;
  });

  // Ensure scores are in valid range
  overallScore = Math.max(0, Math.min(100, overallScore));
  clarity = Math.max(0, Math.min(100, clarity));
  efficiency = Math.max(0, Math.min(100, efficiency));

  // Positive indicators
  const positiveWords = ['thank', 'great', 'perfect', 'wonderful', 'excellent', 'good'];
  const positiveLanguage = positiveWords.some(word => lowerTranscript.includes(word));

  // Success indicators
  const appointmentBooked = !!(call.intent?.includes('book') && call.summary?.includes('booked'));
  const successfulResolution = !!(appointmentBooked || (call.summary && call.summary.length > 10));

  return {
    callSid: call.callSid || '',
    overallScore,
    clarity,
    efficiency,
    successfulResolution,
    issues,
    suggestions,
    conversationFlow: {
      totalTurns: Math.ceil(transcript.length / 200), // Rough estimate
      averageTurnLength: transcript.length / Math.max(1, Math.ceil(transcript.length / 200)),
      intentRecognitionSuccess: !!call.intent && call.intent !== 'unknown',
      dataCollectionSuccess: !!call.summary,
      appointmentBookingSuccess: appointmentBooked,
      customerSatisfactionIndicators: {
        frustrationDetected,
        positiveLanguage,
        completedSuccessfully: successfulResolution
      }
    }
  };
}

/**
 * Store quality metrics in database (extend schema as needed)
 * For now, we'll log them and could add to context or a new table
 */
export async function storeQualityMetrics(metrics: QualityMetrics): Promise<void> {
  console.log('[QUALITY] 📊 Quality Metrics Summary:');
  console.log(`  Call: ${metrics.callSid}`);
  console.log(`  Overall Score: ${metrics.overallScore}/100`);
  console.log(`  Clarity: ${metrics.clarity}/100`);
  console.log(`  Efficiency: ${metrics.efficiency}/100`);
  console.log(`  Successful: ${metrics.successfulResolution ? '✅' : '❌'}`);
  console.log(`  Issues Found: ${metrics.issues.length}`);

  if (metrics.issues.length > 0) {
    console.log('  Issues:');
    metrics.issues.forEach(issue => {
      console.log(`    - [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description}`);
    });
  }

  if (metrics.suggestions.length > 0) {
    console.log('  Suggestions:');
    metrics.suggestions.forEach((suggestion, i) => {
      console.log(`    ${i + 1}. ${suggestion}`);
    });
  }

  console.log('  Conversation Flow:');
  console.log(`    - Total Turns: ${metrics.conversationFlow.totalTurns}`);
  console.log(`    - Intent Recognition: ${metrics.conversationFlow.intentRecognitionSuccess ? '✅' : '❌'}`);
  console.log(`    - Data Collection: ${metrics.conversationFlow.dataCollectionSuccess ? '✅' : '❌'}`);
  console.log(`    - Booking Success: ${metrics.conversationFlow.appointmentBookingSuccess ? '✅' : '❌'}`);
  console.log(`    - Frustration Detected: ${metrics.conversationFlow.customerSatisfactionIndicators.frustrationDetected ? '⚠️' : '✅'}`);
  console.log(`    - Positive Language: ${metrics.conversationFlow.customerSatisfactionIndicators.positiveLanguage ? '✅' : '➖'}`);

  // TODO: Store in database - could add quality_metrics table or extend callLogs with jsonb column
  // For now, metrics are logged for monitoring and can be retrieved from logs
}

/**
 * Get aggregate quality insights across multiple calls
 */
export async function getQualityInsights(tenantId?: number, limit: number = 50): Promise<{
  averageScore: number;
  totalCalls: number;
  commonIssues: { type: string; count: number }[];
  successRate: number;
}> {
  const calls = await storage.listCalls(tenantId, limit);

  const callsWithTranscripts = calls.filter(c => c.transcript && c.transcript.length > 10);

  if (callsWithTranscripts.length === 0) {
    return {
      averageScore: 0,
      totalCalls: 0,
      commonIssues: [],
      successRate: 0
    };
  }

  // Analyze each call (use rule-based for performance)
  const allMetrics = callsWithTranscripts.map(analyzeWithRules);

  // Calculate aggregates
  const averageScore = allMetrics.reduce((sum, m) => sum + m.overallScore, 0) / allMetrics.length;
  const successRate = allMetrics.filter(m => m.successfulResolution).length / allMetrics.length;

  // Count common issues
  const issueMap = new Map<string, number>();
  allMetrics.forEach(metrics => {
    metrics.issues.forEach(issue => {
      issueMap.set(issue.type, (issueMap.get(issue.type) || 0) + 1);
    });
  });

  const commonIssues = Array.from(issueMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  console.log('[QUALITY] 📈 Aggregate Insights:');
  console.log(`  Analyzed Calls: ${callsWithTranscripts.length}`);
  console.log(`  Average Score: ${averageScore.toFixed(1)}/100`);
  console.log(`  Success Rate: ${(successRate * 100).toFixed(1)}%`);
  console.log(`  Common Issues:`, commonIssues);

  return {
    averageScore,
    totalCalls: callsWithTranscripts.length,
    commonIssues,
    successRate
  };
}
