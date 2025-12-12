/**
 * Safety Guardrails - Ensures AI responses stay within safe boundaries
 * Prevents medical advice, handles emergencies, and maintains appropriate limits
 */

export interface SafetyCheckResult {
  isSafe: boolean;
  shouldOverride: boolean;
  suggestedIntent?: string;
  warningMessage?: string;
  responseOverride?: string;
}

// Emergency keywords that should immediately trigger emergency handling
const EMERGENCY_KEYWORDS = [
  'emergency',
  'ambulance',
  '000',           // Australian emergency number
  '911',           // US emergency number
  'heart attack',
  'chest pain',
  'can\'t breathe',
  'cannot breathe',
  'difficulty breathing',
  'choking',
  'unconscious',
  'not breathing',
  'stroke',
  'seizure',
  'severe bleeding',
  'bleeding badly',
  'dying',
  'overdose',
  'suicide',
  'kill myself',
  'want to die'
];

// Medical advice keywords - things we should NOT provide advice on
const MEDICAL_ADVICE_KEYWORDS = [
  'should i take',
  'what medication',
  'is it serious',
  'is this dangerous',
  'diagnose',
  'what\'s wrong with me',
  'what do i have',
  'prescription',
  'how much medication should i take',  // Changed from 'how much should i take' to avoid matching pricing questions
  'how many pills should i take',
  'dosage',
  'side effects',
  'drug interaction',
  'symptoms of',
  'do i need surgery',
  'is it cancer',
  'treatment for cancer',
  'treatment for heart',
  'treatment for diabetes'
];

// Price negotiation keywords
const NEGOTIATION_KEYWORDS = [
  'discount',
  'cheaper',
  'too expensive',
  'negotiate',
  'deal',
  'bargain',
  'lower price',
  'can\'t afford'
];

// Off-limits topics
const OFFLIMITS_TOPICS = [
  'politics',
  'religion',
  'lawsuit',
  'sue',
  'lawyer',
  'legal action',
  'malpractice',
  'complaint about doctor'
];

/**
 * Check utterance against safety rules
 */
export function checkSafetyGuardrails(utterance: string): SafetyCheckResult {
  const text = utterance.toLowerCase().trim();

  // Check for emergency - highest priority
  for (const keyword of EMERGENCY_KEYWORDS) {
    if (text.includes(keyword)) {
      return {
        isSafe: true, // Safe to respond, but with emergency handling
        shouldOverride: true,
        suggestedIntent: 'emergency',
        responseOverride: getEmergencyResponse()
      };
    }
  }

  // Check for medical advice requests
  for (const keyword of MEDICAL_ADVICE_KEYWORDS) {
    if (text.includes(keyword)) {
      return {
        isSafe: false,
        shouldOverride: true,
        suggestedIntent: 'ask_human',
        warningMessage: 'Medical advice request detected',
        responseOverride: getMedicalAdviceResponse()
      };
    }
  }

  // Check for price negotiation
  for (const keyword of NEGOTIATION_KEYWORDS) {
    if (text.includes(keyword)) {
      return {
        isSafe: true,
        shouldOverride: false,
        warningMessage: 'Price negotiation detected - standard fees apply',
        responseOverride: getPriceNegotiationResponse()
      };
    }
  }

  // Check for off-limits topics
  for (const keyword of OFFLIMITS_TOPICS) {
    if (text.includes(keyword)) {
      return {
        isSafe: false,
        shouldOverride: true,
        suggestedIntent: 'ask_human',
        warningMessage: 'Off-limits topic detected',
        responseOverride: getOffLimitsResponse()
      };
    }
  }

  // All clear
  return {
    isSafe: true,
    shouldOverride: false
  };
}

/**
 * Get emergency response script
 */
function getEmergencyResponse(): string {
  return `I'm hearing that this may be an emergency. If this is a medical emergency, please hang up and call 000 immediately. Emergency services can help you right away. If you'd like to speak with our staff about an urgent but non-emergency matter, I can transfer you now. Is this a medical emergency requiring 000?`;
}

/**
 * Get medical advice refusal response
 */
function getMedicalAdviceResponse(): string {
  return `I'm not able to provide medical advice or diagnosis. For any medical concerns, please speak directly with our practitioner during your appointment, or if it's urgent, please call 000 for emergencies. Would you like me to help you book an appointment instead?`;
}

/**
 * Get price negotiation response
 */
function getPriceNegotiationResponse(): string {
  return `I understand cost is important. Our fees are set to reflect the quality of care we provide. We do offer HICAPS for instant health fund rebates, and some services may be claimable. For specific payment arrangements, our reception team can discuss options with you. Would you like me to book an appointment, and you can discuss this further with our team?`;
}

/**
 * Get off-limits topic response
 */
function getOffLimitsResponse(): string {
  return `I'm not the best person to help with that topic. Let me transfer you to our reception team who can assist you further. One moment please.`;
}

/**
 * Validate AI-generated response before sending
 * Returns sanitized response or null if response should be blocked
 */
export function validateResponse(response: string): { valid: boolean; sanitized: string; reason?: string } {
  const text = response.toLowerCase();

  // Block any response that sounds like medical diagnosis
  const diagnosisPatterns = [
    /you (have|might have|probably have|could have)/,
    /sounds like (a|you have)/,
    /this is (likely|probably)/,
    /i think you (have|need)/,
    /you should take/,
    /increase your dosage/,
    /stop taking/
  ];

  for (const pattern of diagnosisPatterns) {
    if (pattern.test(text)) {
      return {
        valid: false,
        sanitized: getMedicalAdviceResponse(),
        reason: 'Response contained medical advice pattern'
      };
    }
  }

  // Block specific mentions of drugs/medications
  const drugPatterns = [
    /take (aspirin|ibuprofen|paracetamol|tylenol|advil)/,
    /\d+\s*mg/,
    /prescription for/
  ];

  for (const pattern of drugPatterns) {
    if (pattern.test(text)) {
      return {
        valid: false,
        sanitized: getMedicalAdviceResponse(),
        reason: 'Response contained medication advice'
      };
    }
  }

  // Ensure emergency numbers are properly handled
  if (text.includes('000') || text.includes('emergency')) {
    // This is okay if it's directing to call 000
    if (!text.includes('call 000') && !text.includes('dial 000')) {
      return {
        valid: false,
        sanitized: response + ' If this is a medical emergency, please call 000 immediately.',
        reason: 'Emergency mention without proper direction'
      };
    }
  }

  return {
    valid: true,
    sanitized: response
  };
}

/**
 * Get safe fallback response for any situation
 */
export function getSafeFallback(): string {
  return `I'm not quite sure how to help with that. Would you like me to transfer you to our reception team? They can assist you further.`;
}

/**
 * Check if response is appropriate length for voice
 * Voice responses should be concise - under 30 seconds of speech
 */
export function checkResponseLength(response: string): { ok: boolean; truncated?: string } {
  // Roughly 150 words per minute for natural speech
  // 30 seconds = ~75 words max
  const words = response.split(/\s+/).length;
  const maxWords = 75;

  if (words <= maxWords) {
    return { ok: true };
  }

  // Truncate to fit
  const truncatedWords = response.split(/\s+/).slice(0, maxWords);
  // Try to end on a sentence
  let truncated = truncatedWords.join(' ');
  const lastPeriod = truncated.lastIndexOf('.');
  if (lastPeriod > truncated.length * 0.5) {
    truncated = truncated.slice(0, lastPeriod + 1);
  } else {
    truncated += '...';
  }

  return { ok: false, truncated };
}
