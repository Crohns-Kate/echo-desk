/**
 * Clinic-specific information configured via environment variables
 * This allows easy customization per clinic without code changes
 */

/**
 * Get the clinic's new patient info blurb from environment variables.
 * This describes what happens during a new patient's first visit.
 *
 * @returns The new patient info blurb, or a sensible default if not configured
 */
export function getNewPatientInfoBlurb(): string {
  return process.env.ECHO_NEW_PATIENT_INFO
    || "On your first visit, you'll have a full consultation and assessment so the chiropractor can understand what's going on and recommend the best plan for you.";
}

/**
 * Get the clinic's new patient fees blurb from environment variables.
 * This describes the pricing for new patient visits.
 *
 * @returns The new patient fees blurb, or a sensible default if not configured
 */
export function getNewPatientFeesBlurb(): string {
  return process.env.ECHO_NEW_PATIENT_FEES
    || "Our initial consultation fee and standard visit fees will be explained when you arrive, and we'll give you a receipt for your health fund if you're covered.";
}

/**
 * Split a blurb into segments suitable for TTS (Text-to-Speech).
 * This prevents overly long chunks that might break STT or sound too heavy.
 *
 * Splits on sentence boundaries (periods, question marks, exclamation marks).
 *
 * @param text The text to split
 * @returns Array of text segments
 */
export function splitBlurbIntoSaySegments(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Split on sentence boundaries: ., ?, !
  // Keep the punctuation with the sentence
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  // Trim each sentence and filter out empty ones
  return sentences
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
