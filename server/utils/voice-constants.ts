export const PRIMARY_VOICE = "Polly.Nicole-Neural";  // AU neural
export const FALLBACK_VOICE = "alice";               // safe fallback

// Extremely conservative sanitizer for Twilio <Say>:
// - strips any SSML angle brackets
// - removes non-ascii and fancy quotes
// - removes punctuation that sometimes trips Polly
// - collapses whitespace
export function ttsSafe(text: string | undefined | null): string {
  if (!text) return "";
  return String(text)
    .replace(/<[^>]*>/g, " ")       // strip tags if someone passed SSML by accident
    .replace(/[^\x20-\x7E]/g, " ")  // ascii only
    .replace(/[""'']/g, '"')
    .replace(/[?!,:;()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// small helper to speak with fallback and skip empty strings
export function saySafe(node: any, text: string) {
  const cleaned = ttsSafe(text);
  if (!cleaned) return;
  try {
    node.say({ voice: PRIMARY_VOICE, language: "en-AU" }, cleaned);
  } catch {
    node.say({ voice: FALLBACK_VOICE, language: "en-AU" }, cleaned);
  }
}
