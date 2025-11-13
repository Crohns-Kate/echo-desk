export const VOICE_NAME = (process.env.TTS_VOICE ?? "Polly.Olivia-Neural") as any;
export const FALLBACK_VOICE = "alice" as any;
export const BUSINESS_TZ = process.env.BUSINESS_TZ || "Australia/Brisbane";

export function sanitizeForSay(text?: string): string {
  if (!text) return "";
  return String(text)
    .replace(/[^\x00-\x7F]/g, '') // strip non-ASCII
    .replace(/\s+/g, ' ')
    .trim();
}

// Enhanced TTS cleaning - removes problematic characters that cause Twilio 13520 errors
export function ttsClean(text?: string): string {
  if (!text) return "";
  return String(text)
    // Remove all unicode including emojis, smart quotes, curly apostrophes
    .replace(/[\u2018\u2019]/g, "'")  // smart single quotes → straight apostrophe
    .replace(/[\u201C\u201D]/g, '"')  // smart double quotes → straight quotes
    .replace(/[\u2013\u2014]/g, '-')  // en-dash, em-dash → hyphen
    .replace(/[\u2026]/g, '...')      // ellipsis → three dots
    .replace(/[^\x00-\x7F]/g, '')     // strip ALL remaining non-ASCII
    .replace(/\s+/g, ' ')             // collapse whitespace
    .replace(/[\x00-\x1F\x7F]/g, '')  // remove control characters
    .trim();
}

// Optional: chunk very long strings to avoid provider limits (~3000 chars)
export function chunkForSay(text: string, max = 1200): string[] {
  // Use ttsClean for enhanced sanitization
  const t = ttsClean(text);
  if (!t) return [];
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
  return parts.filter(p => p.length > 0);
}

export function saySafe(node: any, text?: string, voice?: any) {
  // Double-clean the text through ttsClean (which is used in chunkForSay)
  const cleaned = ttsClean(text);
  if (!cleaned || cleaned.length === 0) {
    console.warn("[VOICE] Attempted to speak empty/invalid text:", text);
    return; // Never pass empty string to <Say>
  }

  const chunks = chunkForSay(cleaned);
  const v = (voice ?? VOICE_NAME) as any;

  // Polly voices don't support the language parameter - it causes 13520 errors
  const isPollyVoice = (voiceName: string) => String(voiceName).toLowerCase().includes('polly');
  const isPrimary = isPollyVoice(v);
  const isFallback = isPollyVoice(FALLBACK_VOICE);

  console.log(`[VOICE][saySafe] voice="${v}" isPolly=${isPrimary} text="${cleaned}" chunks=${chunks.length}`);

  for (const c of chunks) {
    if (!c || c.trim().length === 0) continue;
    console.log(`[VOICE][saySafe] Speaking chunk: "${c}" (length: ${c.length})`);
    try {
      // Polly voices: no language parameter. Standard voices: include language.
      if (isPrimary) {
        node.say({ voice: v }, c);
      } else {
        node.say({ voice: v, language: "en-AU" }, c);
      }
    } catch (err) {
      console.error("[VOICE] Say failed with primary voice, using fallback:", err);
      try {
        if (isFallback) {
          node.say({ voice: FALLBACK_VOICE }, c);
        } else {
          node.say({ voice: FALLBACK_VOICE, language: "en-AU" }, c);
        }
      } catch (fallbackErr) {
        console.error("[VOICE] Fallback voice also failed:", fallbackErr);
      }
    }
  }
}

export function pause(node: any, secs = 1) {
  const n = Number.isFinite(secs) && secs > 0 ? Math.min(10, Math.floor(secs)) : 1;
  node.pause({ length: n });
}
