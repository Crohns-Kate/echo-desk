export const VOICE_NAME = (process.env.TTS_VOICE ?? "Polly.Matthew") as any;
export const FALLBACK_VOICE = "alice" as any;
export const BUSINESS_TZ = process.env.BUSINESS_TZ || "Australia/Brisbane";

export function sanitizeForSay(text?: string): string {
  if (!text) return "";
  return String(text)
    .replace(/[^\x20-\x7E]/g, " ")  // ASCII only
    .replace(/[""'']/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

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

export function saySafe(node: any, text?: string, voice?: string) {
  const t = sanitizeForSay(text);
  if (!t) return;
  const primary = voice || VOICE_NAME;
  try {
    node.say({ voice: primary }, t);
  } catch {
    node.say({ voice: FALLBACK_VOICE }, t);
  }
}

export function say(node: any, text: string) {
  // If text contains SSML tags (<speak>, <say-as>, etc.), pass it raw
  const isSSML = text.includes("<speak>") || text.includes("<say-as");
  
  if (isSSML) {
    // SSML mode - pass raw text with voice parameter
    if (!text.trim()) return;
    try {
      node.say({ voice: VOICE_NAME }, text);
    } catch {
      node.say({ voice: FALLBACK_VOICE }, text);
    }
  } else {
    // Plain text mode - clean and pass
    const cleaned = ttsClean(text);
    if (!cleaned) return;
    try {
      node.say({ voice: VOICE_NAME }, cleaned);
    } catch {
      node.say({ voice: FALLBACK_VOICE }, cleaned);
    }
  }
}

export function pause(node: any, secs = 1) {
  const n = Number.isInteger(secs) ? secs : 1;
  node.pause({ length: n });
}
