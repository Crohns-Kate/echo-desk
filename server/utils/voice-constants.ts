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

// ═══════════════════════════════════════════════════════════════════════════
// SSML & Emotional Expression Support
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enhanced say function with conversational improvements
 * Strips SSML tags and uses natural language instead
 *
 * Note: Direct SSML doesn't work well with Twilio's Node SDK as it gets escaped.
 * Instead, we strip tags and rely on Polly's natural prosody and our word choices.
 */
export function saySafeSSML(node: any, text?: string, voice?: any) {
  if (!text || text.trim().length === 0) {
    console.warn("[VOICE] Attempted to speak empty text:", text);
    return;
  }

  // Strip all SSML tags and convert to natural speech
  let cleanedText = text.trim();

  // Remove all SSML tags but keep the text content
  cleanedText = cleanedText.replace(/<[^>]*>/g, '');

  // Clean up extra whitespace created by tag removal
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

  if (!cleanedText || cleanedText.length === 0) {
    console.warn("[VOICE] Text became empty after cleaning:", text);
    return;
  }

  const v = (voice ?? VOICE_NAME) as any;
  const isPollyVoice = (voiceName: string) => String(voiceName).toLowerCase().includes('polly');
  const isPrimary = isPollyVoice(v);

  console.log(`[VOICE][saySafeSSML] voice="${v}" cleaned="${cleanedText.substring(0, 100)}..."`);

  try {
    if (isPrimary) {
      node.say({ voice: v }, cleanedText);
    } else {
      node.say({ voice: v, language: "en-AU" }, cleanedText);
    }
  } catch (err) {
    console.error("[VOICE] Say failed with primary voice:", err);
    saySafe(node, cleanedText, FALLBACK_VOICE);
  }
}

/**
 * Conversational helpers that add emotional expressiveness
 * Polly Neural voices interpret these naturally through word choice and punctuation
 *
 * Note: We use conversational fillers and punctuation instead of SSML
 * because Twilio's Node SDK escapes SSML tags, making them unreadable.
 */
export const EMOTIONS = {
  // Emotional tones - add warmth and expressiveness through word choice
  empathetic: (text: string, intensity: 'low' | 'medium' | 'high' = 'medium') => {
    const prefixes = {
      low: ['I understand,', 'I see,', 'I hear you,'],
      medium: ['I completely understand,', 'I really appreciate that,', 'That makes perfect sense,'],
      high: ['I completely hear you on that,', 'I really, really appreciate that,', 'That makes total sense,']
    };
    const prefix = prefixes[intensity][Math.floor(Math.random() * prefixes[intensity].length)];
    return `${prefix} ${text}`;
  },

  excited: (text: string, intensity: 'low' | 'medium' | 'high' = 'medium') => {
    const prefixes = {
      low: ['Great!', 'Wonderful!', 'Lovely!'],
      medium: ['That\'s fantastic!', 'How exciting!', 'Brilliant!'],
      high: ['Oh that\'s absolutely wonderful!', 'How absolutely exciting!', 'That\'s just brilliant!']
    };
    const prefix = prefixes[intensity][Math.floor(Math.random() * prefixes[intensity].length)];
    return `${prefix} ${text}`;
  },

  disappointed: (text: string, intensity: 'low' | 'medium' | 'high' = 'medium') => {
    const prefixes = {
      low: ['Oh,', 'Hmm,', 'I see,'],
      medium: ['Oh dear,', 'Oh no,', 'I\'m so sorry,'],
      high: ['Oh I\'m really sorry about that,', 'Oh dear, that\'s not ideal,', 'I\'m so sorry to hear that,']
    };
    const prefix = prefixes[intensity][Math.floor(Math.random() * prefixes[intensity].length)];
    return `${prefix} ${text}`;
  },

  // Warm acknowledgments
  warmAcknowledge: () => {
    const phrases = [
      'Absolutely!',
      'Of course!',
      'Definitely!',
      'You bet!',
      'For sure!',
      'No worries at all!'
    ];
    return phrases[Math.floor(Math.random() * phrases.length)];
  },

  // Enthusiastic confirmations
  enthusiasticConfirm: () => {
    const phrases = [
      'Perfect!',
      'Brilliant!',
      'Wonderful!',
      'Excellent!',
      'Lovely!',
      'Fantastic!'
    ];
    return phrases[Math.floor(Math.random() * phrases.length)];
  },

  // Natural thinking/processing fillers
  thinking: () => {
    const phrases = [
      'Let me see...',
      'One moment...',
      'Just checking that for you...',
      'Bear with me...',
      'Let me just pull that up...'
    ];
    return phrases[Math.floor(Math.random() * phrases.length)];
  },

  // Pauses - use ellipsis and commas for natural pausing
  pause: (ms: number) => ms > 500 ? '...' : ',',
  shortPause: () => ',',
  mediumPause: () => '...',
  longPause: () => '...',

  // Emphasis - use caps or exclamation
  emphasize: (text: string, level: 'strong' | 'moderate' | 'reduced' = 'moderate') =>
    level === 'strong' ? text.toUpperCase() : text,

  // Speech rate - just return text (can't control without SSML)
  faster: (text: string) => text,
  slower: (text: string) => text,

  // Whisper - just return text (can't control without SSML)
  whisper: (text: string) => text,
};
