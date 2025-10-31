export const PRIMARY_VOICE = "Polly.Nicole-Neural";
export const FALLBACK_VOICE = "alice";

// Clean text so Polly doesn't choke
export function ttsClean(s: string | null | undefined) {
  if (!s) return "";
  return String(s)
    .replace(/<[^>]*>/g, " ")       // strip any SSML
    .replace(/[^\x20-\x7E]/g, " ")  // ASCII only
    .replace(/[""'']/g, '"')
    .replace(/[?!,:;()]/g, "")      // keep it simple
    .replace(/\s+/g, " ")
    .trim();
}

export function say(node: any, text: string, opts: { bargeIn?: boolean } = {}) {
  const cleaned = ttsClean(text);
  if (!cleaned) return;
  try {
    node.say({ voice: PRIMARY_VOICE, ...(opts.bargeIn ? { bargeIn: true } : {}) }, cleaned);
  } catch {
    node.say({ voice: FALLBACK_VOICE, ...(opts.bargeIn ? { bargeIn: true } : {}) }, cleaned);
  }
}
