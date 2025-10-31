// Australian timezone conversion utilities
const TZ = 'Australia/Sydney';

/**
 * Convert UTC ISO string to Sydney Date object
 * The Date object itself is still in UTC, but we use it with AU formatters
 */
export function toSydney(isoUtc: string): Date {
  return new Date(isoUtc);
}

/**
 * Format time for speech in Australian timezone
 * Example: "9:15am", "2:30pm"
 */
export function speakTimeAU(isoUtc: string): string {
  const d = new Date(isoUtc);
  const time = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d).toLowerCase();
  
  // Remove space between time and am/pm: "9:15 am" → "9:15am"
  return time.replace(' ', '');
}

/**
 * Format day for speech in Australian timezone
 * Example: "Monday, November 3"
 */
export function speakDayAU(isoUtc: string): string {
  const d = new Date(isoUtc);
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(d);
}

/**
 * Get date-only string in Australian timezone (YYYY-MM-DD)
 * Useful for Cliniko API calls that need local date format
 */
export function dateOnlyAU(isoUtc: string): string {
  const d = new Date(isoUtc);
  const y = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' }).format(d);
  const m = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, month: '2-digit' }).format(d);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, day: '2-digit' }).format(d);
  return `${y}-${m}-${day}`;
}

/**
 * Check if time is morning in Australian timezone
 * Morning = before 12:00pm (noon)
 */
export function isMorningAU(isoUtc: string): boolean {
  const d = new Date(isoUtc);
  const hour = Number(new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    hour: 'numeric',
    hour12: false
  }).format(d));
  return hour < 12;
}

/**
 * Get current date in Australian timezone (YYYY-MM-DD)
 */
export function todayAU(): string {
  return dateOnlyAU(new Date().toISOString());
}

/**
 * Get tomorrow's date in Australian timezone (YYYY-MM-DD)
 */
export function tomorrowAU(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return dateOnlyAU(tomorrow.toISOString());
}

/**
 * Format full appointment time for SMS/speech
 * Example: "Monday, November 3 at 9:15am"
 */
export function formatAppointmentTimeAU(isoUtc: string): string {
  return `${speakDayAU(isoUtc)} at ${speakTimeAU(isoUtc)}`;
}
