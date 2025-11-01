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
