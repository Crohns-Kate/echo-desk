/**
 * Speech Recognition Helpers
 *
 * Central utilities for interpreting spoken responses in voice calls.
 * These handle variations in how people say yes/no/confirmation.
 */

// Affirmative words and phrases
const AFFIRMATIVE_WORDS = [
  'yes', 'yeah', 'yep', 'yup', 'yea',
  'ok', 'okay', 'o.k.',
  'sure', 'alright', 'all right',
  'correct', 'right', 'that\'s right', 'thats right',
  'absolutely', 'definitely', 'certainly',
  'perfect', 'sounds good', 'that works',
  'uh huh', 'uh-huh', 'mm hmm', 'mhm',
  'affirmative', 'confirmed',
  'that\'s me', 'thats me', 'it is', 'i am',
  'please', 'go ahead', 'proceed', 'proceed ahead',
  'true', 'for sure', 'totally', 'okay then', 'ok then',
  'done', 'let\'s do it', 'lets do it'
];

// Negative words and phrases
const NEGATIVE_WORDS = [
  'no', 'nope', 'nah', 'naw',
  'not', 'don\'t', 'dont', 'do not',
  'wrong', 'incorrect',
  'different', 'other', 'another',
  'neither', 'none',
  'cancel', 'stop', 'never mind', 'nevermind'
];

/**
 * Check if speech contains an affirmative response
 * @param speech - The speech text to analyze (will be lowercased)
 * @returns true if the speech is affirmative
 */
export function isAffirmative(speech: string): boolean {
  if (!speech) return false;
  const text = speech.toLowerCase().trim();

  return AFFIRMATIVE_WORDS.some(word => {
    // Check for exact word match or phrase match
    if (word.includes(' ')) {
      // Multi-word phrase - check if it's contained
      return text.includes(word);
    }
    // Single word - check for word boundary match
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    return regex.test(text);
  });
}

/**
 * Check if speech contains a negative response
 * @param speech - The speech text to analyze (will be lowercased)
 * @returns true if the speech is negative
 */
export function isNegative(speech: string): boolean {
  if (!speech) return false;
  const text = speech.toLowerCase().trim();

  return NEGATIVE_WORDS.some(word => {
    if (word.includes(' ')) {
      return text.includes(word);
    }
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    return regex.test(text);
  });
}

/**
 * Determine if speech is a clear yes/no response with NO-wins precedence
 * Returns 'yes', 'no', or 'unclear'
 * 
 * CRITICAL: If any NO token is present, return NO even if YES tokens also exist
 * This handles cases like "absolutely no", "yeah no", "definitely not"
 */
export function classifyYesNo(speech: string): 'yes' | 'no' | 'unclear' {
  if (!speech) return 'unclear';
  
  const text = speech.toLowerCase().trim();
  const normalized = text.replace(/[.,!?;:'"]/g, ' ').replace(/\s+/g, ' ');
  
  // CRITICAL: Check for multi-word NO phrases FIRST (before single-word patterns)
  // This ensures "absolutely no" matches before "absolutely" alone
  const noPhrases = [
    /\babsolutely\s+no\b/,
    /\bdefinitely\s+not\b/,
    /\bnot\s+me\b/,
    /\bthat'?s\s+not\s+me\b/,
    /\bthat\s+is\s+not\s+me\b/,
    /\bi'?m\s+not\b/,
    /\bi\s+am\s+not\b/,
    /\bdon'?t\s+think\s+so\b/,
    /\bdifferent\s+person\b/,
    /\bsomeone\s+else\b/,
    /\bsomebody\s+else\b/,
    /\bfor\s+(somebody\s+else|someone\s+else)\b/,
    /\bbooking\s+for\s+(someone|somebody)\b/,
    /\bcalling\s+for\s+(someone|somebody)\b/,
    /\bon\s+behalf\s+of\b/,
    /\bfor\s+my\s+(mom|mother|dad|father|husband|wife|son|daughter|child|kid|partner|friend)\b/,
    /\bfor\s+(him|her|them)\b/,
    /\bno[,\s]+i'?m\s+calling\s+for\s+(someone|somebody|somebody\s+else|someone\s+else)\b/,
    /\bno[,\s]+i'?m\s+doing\s+it\s+for\s+(someone|somebody)\b/
  ];
  
  // Check for NO phrases first
  const hasNoPhrase = noPhrases.some(pattern => pattern.test(normalized));
  if (hasNoPhrase) {
    console.log('[classifyYesNo] Detected NO phrase:', normalized);
    return 'no';
  }
  
  // Single-word NO tokens
  const noTokens = [
    /\bno\b/,
    /\bnope\b/,
    /\bnah\b/,
    /\bnegative\b/,
    /\bwrong\b/,
    /\bincorrect\b/,
    /\bnot\b/ // Only matches standalone "not", not part of phrases already checked
  ];
  
  // YES tokens/phrases - explicit affirmatives
  const yesPatterns = [
    /\byes\b/,
    /\byeah\b/,
    /\byep\b/,
    /\byup\b/,
    /\bcorrect\b/,
    /\bthat'?s\s+me\b/,
    /\bthats\s+me\b/,
    /\bit'?s\s+me\b/,
    /\bits\s+me\b/,
    /\bi\s+am\b/,
    /\bi'?m\b/,
    /\bim\b/,
    /\bsure\b/,
    /\babsolutely\b/, // Only matches if NOT part of "absolutely no" (already checked above)
    /\baffirmative\b/,
    /\bok\b/,
    /\bokay\b/,
    /\bthat'?s\s+right\b/,
    /\bthats\s+right\b/
  ];
  
  // Check for single-word NO tokens
  const hasNoToken = noTokens.some(pattern => pattern.test(normalized));
  
  // Check for YES (but exclude if it's part of a NO phrase)
  const hasYes = yesPatterns.some(pattern => {
    const match = normalized.match(pattern);
    if (!match) return false;
    
    // Special case: "absolutely" should NOT count as yes if followed by "no" or "not"
    // (This is a safety check, but phrases should already be caught above)
    if (pattern.source === '\\babsolutely\\b') {
      const index = normalized.indexOf(match[0]);
      const after = normalized.substring(index + match[0].length).trim();
      if (after.match(/^(no|not)\b/)) {
        return false; // "absolutely no" or "absolutely not" = NO
      }
    }
    
    return true;
  });
  
  // NO wins precedence - if any NO token present, return NO
  if (hasNoToken) {
    console.log('[classifyYesNo] Detected NO token:', normalized);
    return 'no';
  }
  
  // Only return YES if NO is not present
  if (hasYes) {
    console.log('[classifyYesNo] Detected YES:', normalized);
    return 'yes';
  }
  
  console.log('[classifyYesNo] Unclear:', normalized);
  return 'unclear';
}

/**
 * Check if speech indicates the caller is confirming their identity
 * More specific than general affirmative - includes name-related confirmations
 */
export function isIdentityConfirmation(speech: string, expectedName?: string): boolean {
  const text = speech.toLowerCase().trim();

  // Check general affirmatives
  if (isAffirmative(speech) && !isNegative(speech)) {
    return true;
  }

  // Check if they said their expected name
  if (expectedName) {
    const nameLower = expectedName.toLowerCase();
    const firstName = nameLower.split(/\s+/)[0];
    if (text.includes(firstName) || text === firstName) {
      return true;
    }
  }

  return false;
}

/**
 * Check if the caller wants to book an appointment
 */
export function wantsToBook(speech: string): boolean {
  const text = speech.toLowerCase().trim();

  // Explicit booking words
  const bookingWords = ['book', 'appointment', 'schedule', 'reserve'];
  if (bookingWords.some(w => text.includes(w))) {
    return true;
  }

  // Affirmative in response to booking question
  if (isAffirmative(speech) && !isNegative(speech)) {
    return true;
  }

  return false;
}

// Export the word lists for testing
export { AFFIRMATIVE_WORDS, NEGATIVE_WORDS };
