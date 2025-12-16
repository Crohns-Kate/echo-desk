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
 * Determine if speech is a clear yes/no response
 * Returns 'yes', 'no', or 'unclear'
 */
export function classifyYesNo(speech: string): 'yes' | 'no' | 'unclear' {
  const isYes = isAffirmative(speech);
  const isNo = isNegative(speech);

  // If both or neither, it's unclear
  if (isYes === isNo) return 'unclear';

  return isYes ? 'yes' : 'no';
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
