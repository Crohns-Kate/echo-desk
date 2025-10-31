export const VOICE_NAME = process.env.VOICE_NAME || "Polly.Olivia-Neural";
export const FALLBACK_VOICE = "alice";

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

export function say(node: any, text: string) {
  const cleaned = ttsClean(text);
  if (!cleaned) return;
  try {
    node.say({ voice: VOICE_NAME }, cleaned);
  } catch {
    node.say({ voice: FALLBACK_VOICE }, cleaned);
  }
}

export function pause(node: any, secs = 1) {
  const n = Number.isInteger(secs) ? secs : 1;
  node.pause({ length: n });
}
