/**
 * Handoff Detection Utility
 * 
 * Detects when a caller needs human assistance based on:
 * - Explicit requests for human
 * - Frustration/loop detection
 * - Low confidence/out-of-scope/errors
 */

export type HandoffTrigger = 
  | 'explicit_request'
  | 'frustration_loop'
  | 'repeated_hello'
  | 'profanity'
  | 'low_confidence'
  | 'out_of_scope'
  | 'cliniko_error'
  | 'no_match_consecutive';

export interface HandoffDetectionResult {
  shouldTrigger: boolean;
  trigger?: HandoffTrigger;
  reason?: string;
  confidence: number; // 0-1
}

/**
 * Phrases that indicate caller wants to speak to a human
 */
const HUMAN_REQUEST_PATTERNS = [
  /\b(speak to|talk to|connect with|transfer to|put me through to)\s+(a\s+)?(human|person|real person|receptionist|staff|someone|somebody|agent|operator)\b/i,
  /\b(can I|can we|I want to|I need to|I'd like to)\s+(speak|talk)\s+(to|with)\s+(a\s+)?(human|person|real person|receptionist|staff|someone|somebody|agent|operator)\b/i,
  /\b(get|let me|I want|I need)\s+(a\s+)?(human|person|real person|receptionist|staff|someone|somebody|agent|operator)\b/i,
  /\b(not working|doesn't work|broken|stupid|useless|frustrated|give up)\b/i,
  /\b(help me|I need help|can't do this|can't understand)\b/i,
];

/**
 * Profanity patterns (basic detection)
 */
const PROFANITY_PATTERNS = [
  /\b(shit|damn|hell|fuck|bloody|bugger)\b/i,
];

/**
 * Repeated "hello" detection (indicates confusion/frustration)
 */
const REPEATED_HELLO_THRESHOLD = 2; // 2+ "hello" in recent turns

/**
 * Detect if caller explicitly requests human
 */
export function detectExplicitHumanRequest(utterance: string): boolean {
  if (!utterance || utterance.trim().length === 0) return false;
  
  const normalized = utterance.toLowerCase().trim();
  
  for (const pattern of HUMAN_REQUEST_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect profanity in utterance
 */
export function detectProfanity(utterance: string): boolean {
  if (!utterance) return false;
  
  for (const pattern of PROFANITY_PATTERNS) {
    if (pattern.test(utterance)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect repeated "hello" in conversation history
 */
export function detectRepeatedHello(history: Array<{ role: string; content: string }>): boolean {
  if (!history || history.length === 0) return false;
  
  // Check last 5 user turns for "hello" patterns
  const userTurns = history
    .filter(t => t.role === 'user')
    .slice(-5)
    .map(t => t.content.toLowerCase());
  
  const helloCount = userTurns.filter(turn => 
    /\b(hello|hi|hey|hi there|hello there)\b/i.test(turn)
  ).length;
  
  return helloCount >= REPEATED_HELLO_THRESHOLD;
}

/**
 * Detect frustration loop (2+ consecutive no-match responses)
 */
export function detectFrustrationLoop(
  history: Array<{ role: string; content: string }>,
  noMatchCount: number
): boolean {
  // Check if we have 2+ consecutive no-match responses
  if (noMatchCount >= 2) {
    return true;
  }
  
  // Also check recent history for patterns indicating confusion
  if (!history || history.length < 4) return false;
  
  const recentTurns = history.slice(-4);
  let consecutiveNoMatch = 0;
  
  for (let i = recentTurns.length - 1; i >= 0; i--) {
    const turn = recentTurns[i];
    if (turn.role === 'assistant') {
      // Check if assistant response indicates no-match
      const content = turn.content.toLowerCase();
      if (content.includes("didn't catch") || 
          content.includes("didn't understand") ||
          content.includes("could you repeat") ||
          content.includes("say that again")) {
        consecutiveNoMatch++;
      } else {
        break; // Reset on successful match
      }
    }
  }
  
  return consecutiveNoMatch >= 2;
}

/**
 * Main handoff detection function
 */
export function detectHandoffTrigger(
  utterance: string,
  history: Array<{ role: string; content: string }> = [],
  options: {
    noMatchCount?: number;
    confidence?: number;
    isOutOfScope?: boolean;
    hasClinikoError?: boolean;
  } = {}
): HandoffDetectionResult {
  const { noMatchCount = 0, confidence = 1.0, isOutOfScope = false, hasClinikoError = false } = options;
  
  // 1. Explicit human request (highest priority)
  if (detectExplicitHumanRequest(utterance)) {
    return {
      shouldTrigger: true,
      trigger: 'explicit_request',
      reason: 'Caller explicitly requested to speak with a human',
      confidence: 0.95
    };
  }
  
  // 2. Profanity (indicates frustration)
  if (detectProfanity(utterance)) {
    return {
      shouldTrigger: true,
      trigger: 'profanity',
      reason: 'Profanity detected, indicating frustration',
      confidence: 0.85
    };
  }
  
  // 3. Cliniko error
  if (hasClinikoError) {
    return {
      shouldTrigger: true,
      trigger: 'cliniko_error',
      reason: 'Cliniko API error occurred',
      confidence: 0.90
    };
  }
  
  // 4. Out of scope
  if (isOutOfScope) {
    return {
      shouldTrigger: true,
      trigger: 'out_of_scope',
      reason: 'Request is out of scope for AI assistant',
      confidence: 0.80
    };
  }
  
  // 5. Low confidence
  if (confidence < 0.5) {
    return {
      shouldTrigger: true,
      trigger: 'low_confidence',
      reason: `Low confidence in understanding (${(confidence * 100).toFixed(0)}%)`,
      confidence: 0.75
    };
  }
  
  // 6. Frustration loop (2+ consecutive no-match)
  if (detectFrustrationLoop(history, noMatchCount)) {
    return {
      shouldTrigger: true,
      trigger: 'frustration_loop',
      reason: `Multiple consecutive no-match responses (${noMatchCount})`,
      confidence: 0.80
    };
  }
  
  // 7. Repeated "hello" (indicates confusion)
  if (detectRepeatedHello(history)) {
    return {
      shouldTrigger: true,
      trigger: 'repeated_hello',
      reason: 'Repeated "hello" detected, indicating confusion',
      confidence: 0.70
    };
  }
  
  // No trigger detected
  return {
    shouldTrigger: false,
    confidence: 1.0 - (noMatchCount * 0.1) // Lower confidence with more no-matches
  };
}
