// server/time.ts
// Timezone utilities for Australia/Brisbane with natural time formatting

export const AUST_TZ = process.env.TZ || "Australia/Brisbane";
export const LOCALE = process.env.PUBLIC_LOCALE || "en-AU";

/**
 * Convert date to local timezone-aware Date object
 * JS Date is UTC internally; we retain UTC but format in tz
 */
export function toLocal(dateISO: string | Date, tz = AUST_TZ): Date {
  const d = typeof dateISO === "string" ? new Date(dateISO) : dateISO;
  return d;
}

/**
 * Pad number with leading zero
 */
function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Format time for SSML <say-as interpret-as="time"> to prevent Polly from saying "one thousand fifteen"
 * Returns { hhmm: "10:30", ampm: "a.m.", spoken: "10:30 a.m." }
 */
export function toHhMm12SSML(iso: string, tz = AUST_TZ) {
  const d = new Date(iso);
  const h24 = parseInt(
    d.toLocaleString(LOCALE, { timeZone: tz, hour: "2-digit", hour12: false }),
    10
  );
  const m = pad(
    parseInt(
      d.toLocaleString(LOCALE, { timeZone: tz, minute: "2-digit", hour12: false }),
      10
    )
  );
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? "a.m." : "p.m.";
  return { hhmm: `${pad(h12)}:${m}`, ampm, spoken: `${h12}:${m} ${ampm}` };
}

/**
 * Generate SSML time string for Polly TTS
 * Returns "<speak><say-as interpret-as="time" format="hms12">10:30 a.m.</say-as></speak>"
 */
export function ssmlTime(iso: string, tz = AUST_TZ): string {
  const t = toHhMm12SSML(iso, tz);
  return `<speak><say-as interpret-as="time" format="hms12">${t.hhmm} ${t.ampm}</say-as></speak>`;
}

/**
 * Format slot time for TTS in natural Australian format (legacy, use ssmlTime for better pronunciation)
 * Returns "10:30 am" or "2:15 pm" - natural for Polly to read
 */
export function formatSlotForTTS(dateISO: string, tz = AUST_TZ): string {
  const dt = new Date(dateISO);
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(dt).toLowerCase();
}

/**
 * Check if two dates fall on the same local day in the specified timezone
 */
export function isSameLocalDay(aISO: string, bISO: string, tz = AUST_TZ): boolean {
  const a = new Date(aISO);
  const b = new Date(bISO);
  const fmt = new Intl.DateTimeFormat(LOCALE, {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(a) === fmt.format(b);
}

/**
 * Get the next occurrence of a weekday from an utterance like "monday" or "tomorrow"
 * Returns a Date in local timezone or null if not recognized
 */
export function nextWeekdayFromUtterance(utterance: string, now = new Date(), tz = AUST_TZ): Date | null {
  const map: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    today: -1,
    tomorrow: -2,
  };
  
  const u = (utterance || "").toLowerCase();
  const key = Object.keys(map).find(k => u.includes(k));
  
  if (!key) return null;

  const base = new Date(now);
  
  if (key === "today") return base;
  if (key === "tomorrow") {
    base.setDate(base.getDate() + 1);
    return base;
  }

  const want = map[key];
  const current = base.getDay();
  let delta = (want - current + 7) % 7;
  if (delta === 0) delta = 7; // next week if they say "Monday" and it's already Monday
  base.setDate(base.getDate() + delta);
  return base;
}

/**
 * Extract part of day preference from utterance
 * Returns "morning", "afternoon", or "any"
 */
export function partOfDayFilter(utterance: string): "morning" | "afternoon" | "any" {
  const u = (utterance || "").toLowerCase();
  if (u.includes("morning") || u.includes("early")) return "morning";
  if (u.includes("afternoon") || u.includes("late")) return "afternoon";
  return "any";
}

/**
 * Check if a slot is in the morning (<12:00) in local timezone
 */
export function isMorningSlot(slotISO: string, tz = AUST_TZ): boolean {
  const dt = new Date(slotISO);
  const hour = parseInt(
    new Intl.DateTimeFormat(LOCALE, {
      timeZone: tz,
      hour: "2-digit",
      hour12: false
    }).format(dt),
    10
  );
  return hour < 12;
}

/**
 * Filter slots by part of day
 */
export function filterSlotsByPartOfDay(
  slots: string[],
  part: "morning" | "afternoon" | "any",
  tz = AUST_TZ
): string[] {
  if (part === "any") return slots;
  return slots.filter(s => {
    const isMorning = isMorningSlot(s, tz);
    return part === "morning" ? isMorning : !isMorning;
  });
}

/**
 * Format date for TTS - e.g., "Monday 4th November"
 */
export function formatDateForTTS(dateISO: string, tz = AUST_TZ): string {
  const dt = new Date(dateISO);
  const dayName = new Intl.DateTimeFormat(LOCALE, {
    timeZone: tz,
    weekday: "long"
  }).format(dt);
  
  const day = parseInt(
    new Intl.DateTimeFormat(LOCALE, {
      timeZone: tz,
      day: "numeric"
    }).format(dt),
    10
  );
  
  const monthName = new Intl.DateTimeFormat(LOCALE, {
    timeZone: tz,
    month: "long"
  }).format(dt);
  
  // Add ordinal suffix
  const ordinal = getOrdinalSuffix(day);
  
  return `${dayName} ${day}${ordinal} ${monthName}`;
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.)
 */
function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Calculate local day window for Cliniko availability queries
 * Returns { fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD' } for the same day in local timezone
 * Cliniko's available_times endpoint accepts date-only strings (no time component)
 */
export function localDayWindow(dayNameOrDate: string, tz = AUST_TZ): { fromDate: string; toDate: string } {
  // Try to parse utterance to get target date
  let targetDate = nextWeekdayFromUtterance(dayNameOrDate, new Date(), tz);
  
  if (!targetDate) {
    // Fallback to tomorrow if utterance not recognized
    targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1);
  }
  
  // Format as YYYY-MM-DD in local timezone
  const formatter = new Intl.DateTimeFormat(LOCALE, {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(targetDate);
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  
  const dateStr = `${year}-${month}-${day}`;
  
  return {
    fromDate: dateStr,
    toDate: dateStr  // Same day for Cliniko query
  };
}

/**
 * Format time in natural speakable format for voice prompts
 * Returns "eleven fifteen A M Tuesday five November"
 * Note: Uses "A M" and "P M" with spaces for clearer TTS pronunciation
 */
export function speakableTime(iso: string, tz = AUST_TZ): string {
  const d = new Date(iso);
  
  // Get hour in 12-hour format
  const h24 = parseInt(
    d.toLocaleString(LOCALE, { timeZone: tz, hour: "2-digit", hour12: false }),
    10
  );
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? "A M" : "P M";
  
  // Get minutes
  const m = parseInt(
    d.toLocaleString(LOCALE, { timeZone: tz, minute: "2-digit", hour12: false }),
    10
  );
  
  // Convert hour to words
  const hourWords = numberToWords(h12);
  const minWords = m === 0 ? "" : numberToWords(m);
  
  // Get day name and date
  const dayName = d.toLocaleString(LOCALE, { timeZone: tz, weekday: "long" });
  const dayNum = parseInt(
    d.toLocaleString(LOCALE, { timeZone: tz, day: "numeric" }),
    10
  );
  const monthName = d.toLocaleString(LOCALE, { timeZone: tz, month: "long" });
  
  // Build speakable string
  const timePart = minWords 
    ? `${hourWords} ${minWords} ${ampm}` 
    : `${hourWords} ${ampm}`;
  
  return `${timePart} ${dayName} ${dayNum} ${monthName}`;
}

/**
 * Convert number to words for TTS (1-59 range for time)
 */
function numberToWords(n: number): string {
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
                "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
                "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty"];
  
  if (n < 20) return ones[n];
  if (n < 60) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return tens[t] + (o > 0 ? " " + ones[o] : "");
  }
  return n.toString(); // Fallback for out of range
}
