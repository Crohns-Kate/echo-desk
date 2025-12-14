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
 * Post-process TwiML XML to unescape SSML for Polly
 * Call this on the final TwiML string before sending to Twilio
 */
export function unescapeSSMLInTwiml(twimlXml: string): string {
  // Twilio SDK escapes SSML as &lt;speak&gt;, &lt;break&gt;, etc.
  // Unescape only within <Say> tags for Polly voices
  
  // Match Say tags with Polly voices (voice attribute can be in any order)
  return twimlXml.replace(
    /<Say([^>]*voice="Polly\.[^"]*"[^>]*|[^>]*voice='Polly\.[^']*'[^>]*)>([\s\S]*?)<\/Say>/g,
    (fullMatch, sayAttributes, content) => {
      // Unescape all XML entities in the content (SSML tags)
      // Order matters: unescape &amp; last to avoid double-unescaping
      let unescaped = content
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&'); // Do this last
      
      // Reconstruct the Say tag with unescaped SSML content
      return `<Say${sayAttributes}>${unescaped}</Say>`;
    }
  );
}

/**
 * Say function that properly supports SSML with Amazon Polly
 * CRITICAL: Twilio's Node SDK escapes SSML tags in say() content.
 * Solution: Parse SSML, extract breaks/prosody, use Twilio Pause verbs and natural speech
 * Then post-process TwiML to unescape SSML for Polly voices
 */
export function saySafeSSML(node: any, ssmlText?: string, voice?: any) {
  if (!ssmlText || ssmlText.trim().length === 0) {
    console.warn("[VOICE] Attempted to speak empty SSML text:", ssmlText);
    return;
  }

  const v = (voice ?? VOICE_NAME) as any;
  const isPollyVoice = (voiceName: string) => String(voiceName).toLowerCase().includes('polly');
  const isPrimary = isPollyVoice(v);

  if (!isPrimary) {
    // For non-Polly voices, strip SSML and use plain text
    const cleanedText = ssmlText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    saySafe(node, cleanedText, FALLBACK_VOICE);
    return;
  }

  // Ensure SSML is wrapped in <speak> tags
  let ssml = ssmlText.trim();
  if (!ssml.startsWith('<speak>')) {
    ssml = `<speak>${ssml}</speak>`;
  }

  // Clean SSML: remove control characters
  ssml = ssml.replace(/[\x00-\x1F\x7F]/g, '');

  console.log(`[VOICE][saySafeSSML] voice="${v}" ssml="${ssml.substring(0, 150)}..."`);

  try {
    // CRITICAL: Pass SSML directly to node.say() - it will be escaped by Twilio SDK
    // Then getTwimlXml() will unescape it before sending to Twilio
    // This allows true SSML support with Polly
    node.say({ voice: v }, ssml);
  } catch (err) {
    console.error("[VOICE] SSML Say failed, falling back to parsed format:", err);
    // Fallback: Parse SSML and convert to Twilio-native format
    try {
      const parsed = parseSSMLToTwilioFormat(ssml);
      
      // Speak each segment with appropriate pauses
      for (let i = 0; i < parsed.segments.length; i++) {
        const segment = parsed.segments[i];
        
        // Add pause before segment if specified
        if (segment.pauseBefore > 0) {
          const pauseSecs = Math.min(Math.ceil(segment.pauseBefore / 1000), 10);
          node.pause({ length: pauseSecs });
        }
        
        // Speak the text (with prosody handling via natural speech patterns)
        if (segment.text.trim()) {
          // For prosody effects, use natural word choice and punctuation
          const textToSpeak = segment.slow ? segment.text.replace(/\./g, '...').replace(/!/g, '!') : segment.text;
          const cleaned = ttsClean(textToSpeak);
          if (cleaned) {
            node.say({ voice: v }, cleaned);
          }
        }
      }
    } catch (parseErr) {
      console.error("[VOICE] SSML parsing also failed, using plain text:", parseErr);
      // Final fallback: strip SSML and use plain text
      const cleanedText = ssml.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      saySafe(node, cleanedText, v);
    }
  }
}

/**
 * Parse SSML and convert to Twilio-native format (text + Pause verbs)
 */
interface SSMLSegment {
  text: string;
  pauseBefore: number; // milliseconds
  slow: boolean; // prosody rate="slow"
}

function parseSSMLToTwilioFormat(ssml: string): { segments: SSMLSegment[] } {
  const segments: SSMLSegment[] = [];
  
  // Remove speak wrapper
  ssml = ssml.replace(/<\/?speak>/g, '');
  
  // Split by break tags first
  const parts = ssml.split(/<break\s+time=["'](\d+)(ms|s)["']\s*\/?>/);
  
  let currentPause = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    // Check if next part is a break time value
    if (i + 2 < parts.length && /^\d+$/.test(parts[i + 1]) && /^(ms|s)$/.test(parts[i + 2])) {
      const value = parseInt(parts[i + 1], 10);
      const unit = parts[i + 2];
      currentPause = unit === 's' ? value * 1000 : value;
      i += 2; // Skip the break value parts
    }
    
    if (!part.trim()) continue;
    
    // Extract prosody tags
    let text = part;
    let slow = false;
    
    // Check for prosody rate="slow"
    if (part.includes('rate="slow"') || part.includes("rate='slow'")) {
      slow = true;
    }
    
    // Remove all SSML tags
    text = text
      .replace(/<prosody[^>]*>/g, '')
      .replace(/<\/prosody>/g, '')
      .replace(/<break[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (text) {
      segments.push({
        text,
        pauseBefore: currentPause,
        slow
      });
      currentPause = 0; // Reset pause after using it
    }
  }
  
  return { segments };
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
      low: ['Hmm,', 'I see,', 'Okay,'],
      medium: ['I understand,', 'I see,', 'Thank you for letting me know,'],
      high: ['I appreciate you letting me know,', 'Thank you for telling me that,', 'I understand,']
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

// ═══════════════════════════════════════════════════════════════════════════
// Reusable TTS Helpers with SSML
// Warm, charming, professional voice output using Amazon Polly
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate warm, welcoming greeting with slight pitch lift
 * Tone: Friendly boutique clinic receptionist
 */
export function ttsGreeting(clinicName: string, knownPatientName?: string): string {
  const clinic = clinicName || 'our clinic';
  
  if (knownPatientName) {
    const greetings = [
      `<prosody pitch="+5%">Hi there, ${knownPatientName}!</prosody> <break time="300ms"/> Thanks for calling ${clinic}. <break time="400ms"/> How can I help you today?`,
      `<prosody pitch="+5%">Hello ${knownPatientName}!</prosody> <break time="300ms"/> Great to hear from you. <break time="400ms"/> What can I do for you today?`,
      `<prosody pitch="+5%">Hi ${knownPatientName}!</prosody> <break time="300ms"/> Thanks for calling ${clinic}. <break time="400ms"/> How are you today?`
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }
  
  const greetings = [
    `<prosody pitch="+5%">Hi there!</prosody> <break time="300ms"/> Thanks for calling ${clinic}. <break time="400ms"/> This is Sarah. <break time="400ms"/> How can I help you today?`,
    `<prosody pitch="+5%">Hello!</prosody> <break time="300ms"/> Thanks for calling ${clinic}. <break time="400ms"/> I'm Sarah. <break time="400ms"/> What can I do for you?`,
    `<prosody pitch="+5%">Hi!</prosody> <break time="300ms"/> Thanks so much for calling ${clinic}. <break time="400ms"/> This is Sarah. <break time="400ms"/> How can I assist you today?`
  ];
  return greetings[Math.floor(Math.random() * greetings.length)];
}

/**
 * Natural thinking/filler phrases during API lookups
 * Prevents dead-air pauses with warm, reassuring phrases
 */
export function ttsThinking(): string {
  const phrases = [
    `<prosody rate="slow">Let me check that for you.</prosody> <break time="400ms"/>`,
    `<prosody rate="slow">Just a moment.</prosody> <break time="400ms"/> <prosody rate="slow">Let me pull that up.</prosody>`,
    `<prosody rate="slow">One second.</prosody> <break time="400ms"/> <prosody rate="slow">I'm just checking.</prosody>`,
    `<prosody rate="slow">Bear with me.</prosody> <break time="400ms"/> <prosody rate="slow">I'll have that for you in just a moment.</prosody>`
  ];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

/**
 * Warm booking confirmation message
 * Rate: normal (confident, not rushed)
 * Multiple short sentences with natural pauses
 */
export function ttsBookingConfirmed(
  patientName: string | undefined,
  appointmentTime: string,
  practitionerName?: string,
  phoneLastFour?: string
): string {
  const name = patientName || '';
  const namePrefix = name ? `${name}, ` : '';
  const practitioner = practitionerName ? ` with ${practitionerName}` : '';
  const phoneSuffix = phoneLastFour ? ` ending in ${phoneLastFour}` : '';
  
  const confirmations = [
    `Perfect! <break time="300ms"/> ${namePrefix}you're all booked for ${appointmentTime}${practitioner}. <break time="400ms"/> We'll send a confirmation to your mobile${phoneSuffix}.`,
    `Lovely! <break time="300ms"/> ${namePrefix}your appointment is confirmed for ${appointmentTime}${practitioner}. <break time="400ms"/> You'll receive a text confirmation${phoneSuffix ? ` to your mobile ${phoneSuffix}` : ''} in just a moment.`,
    `Brilliant! <break time="300ms"/> ${namePrefix}you're all set for ${appointmentTime}${practitioner}. <break time="400ms"/> Keep an eye out for your confirmation message${phoneSuffix ? ` on your mobile ${phoneSuffix}` : ''}.`
  ];
  return confirmations[Math.floor(Math.random() * confirmations.length)];
}

/**
 * Friendly directions/map link message
 * Rate: slow (reassuring, clear)
 */
export function ttsDirections(clinicName: string): string {
  const clinic = clinicName || 'us';
  
  const messages = [
    `<prosody rate="slow">Absolutely.</prosody> <break time="300ms"/> <prosody rate="slow">I'll send you directions to ${clinic} right away.</prosody> <break time="400ms"/> <prosody rate="slow">You should receive a text with a map link in just a moment.</prosody>`,
    `<prosody rate="slow">Of course!</prosody> <break time="300ms"/> <prosody rate="slow">I'm sending you directions now.</prosody> <break time="400ms"/> <prosody rate="slow">Check your phone for the map link.</prosody>`,
    `<prosody rate="slow">Perfect.</prosody> <break time="300ms"/> <prosody rate="slow">Directions are on their way.</prosody> <break time="400ms"/> <prosody rate="slow">You'll get a text with all the details.</prosody>`
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Warm, single-sentence goodbye
 * One closing sentence only - no repeated prompts
 * Rate: slow (warm, unhurried)
 */
export function ttsGoodbye(): string {
  const goodbyes = [
    `<prosody rate="slow">Perfect! We're looking forward to seeing you. Have a wonderful day!</prosody>`,
    `<prosody rate="slow">Lovely! Talk to you soon. Take care!</prosody>`,
    `<prosody rate="slow">Beautiful! We'll be in touch. Have a great day!</prosody>`,
    `<prosody rate="slow">Wonderful! Thanks for calling. See you soon!</prosody>`,
    `<prosody rate="slow">Perfect! If anything changes, just give us a call. Bye for now!</prosody>`
  ];
  return goodbyes[Math.floor(Math.random() * goodbyes.length)];
}
