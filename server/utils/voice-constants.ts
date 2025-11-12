export const VOICE_NAME = (process.env.TTS_VOICE ?? "Polly.Nicole-Neural") as any;
export const FALLBACK_VOICE = "alice" as any;
export const BUSINESS_TZ = process.env.BUSINESS_TZ || "Australia/Brisbane";

export function sanitizeForSay(text?: string): string {
  if (!text) return "";
  return String(text)
    .replace(/[^\x00-\x7F]/g, '') // strip non-ASCII
    .replace(/\s+/g, ' ')
    .trim();
}

// Optional: chunk very long strings to avoid provider limits (~3000 chars)
export function chunkForSay(text: string, max = 1200): string[] {
  const t = sanitizeForSay(text);
  if (t.length <= max) return [t];
  const parts: string[] = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + max, t.length);
    // try to break on sentence boundary
    const dot = t.lastIndexOf(". ", end);
    if (dot > i + 100) end = dot + 1;
    parts.push(t.slice(i, end).trim());
    i = end;
  }
  return parts;
}

export function saySafe(node: any, text?: string, voice?: any) {
  const chunks = chunkForSay(text ?? "");
  const v = (voice ?? VOICE_NAME) as any;
  for (const c of chunks) {
    if (!c) continue;
    try {
      node.say({ voice: v, language: "en-AU" }, c);
    } catch {
      node.say({ voice: FALLBACK_VOICE, language: "en-AU" }, c);
    }
  }
}

export function pause(node: any, secs = 1) {
  const n = Number.isFinite(secs) && secs > 0 ? Math.min(10, Math.floor(secs)) : 1;
  node.pause({ length: n });
}
