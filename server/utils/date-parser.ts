/**
 * Date Parser Utility
 * Converts natural language date expressions into date ranges
 */

import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { AUST_TZ } from '../time';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export interface DateRange {
  from: Dayjs;
  to: Dayjs;
  description: string; // For debugging/logging
}

/**
 * Parse natural language date into a date range
 * Handles: "today", "tomorrow", "saturday", "monday", etc.
 *
 * @param dayExpression - Natural language day (e.g., "saturday", "today", "tomorrow")
 * @param timezone - Timezone for date calculation (default: Australia/Brisbane)
 * @param preferredTime - Optional specific time preference to validate against current time
 * @returns Date range covering the requested day
 */
export function parseNaturalDate(
  dayExpression: string | undefined,
  timezone: string = AUST_TZ,
  preferredTime?: { hour: number; minute: number }
): DateRange {
  const now = dayjs().tz(timezone);
  const today = now.startOf('day');

  if (!dayExpression) {
    // No specific day requested - return next 14 days
    return {
      from: now,
      to: now.add(14, 'days'),
      description: 'next 2 weeks (no specific day requested)'
    };
  }

  const expr = dayExpression.toLowerCase().trim();

  // Handle "today" - with special logic for past times
  if (expr === 'today') {
    // Check if the preferred time is in the past
    if (preferredTime) {
      const requestedTime = today.hour(preferredTime.hour).minute(preferredTime.minute);

      if (requestedTime.isBefore(now)) {
        // The requested time is in the past - switch to tomorrow
        console.log(`[DateParser] Requested time ${preferredTime.hour}:${String(preferredTime.minute).padStart(2, '0')} is in the past, switching from "today" to "tomorrow"`);
        const tomorrow = today.add(1, 'day');
        return {
          from: tomorrow.startOf('day'),
          to: tomorrow.endOf('day'),
          description: 'tomorrow (requested time was in the past)'
        };
      }
    }

    return {
      from: now, // Start from current time
      to: today.endOf('day'),
      description: 'today'
    };
  }

  // Handle "tomorrow"
  if (expr === 'tomorrow') {
    const tomorrow = today.add(1, 'day');
    return {
      from: tomorrow.startOf('day'),
      to: tomorrow.endOf('day'),
      description: 'tomorrow'
    };
  }

  // Handle specific weekdays (e.g., "saturday", "monday")
  const weekdays = [
    'sunday', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday'
  ];

  const weekdayIndex = weekdays.indexOf(expr);
  if (weekdayIndex !== -1) {
    // Find the NEXT occurrence of this weekday
    const targetDay = findNextWeekday(today, weekdayIndex, timezone);

    return {
      from: targetDay.startOf('day'),
      to: targetDay.endOf('day'),
      description: `${expr} (${targetDay.format('MMM D')})`
    };
  }

  // Handle "this saturday" vs "next saturday"
  if (expr.includes('this ') || expr.includes('next ')) {
    const dayName = expr.replace('this ', '').replace('next ', '').trim();
    const targetWeekdayIndex = weekdays.indexOf(dayName);

    if (targetWeekdayIndex !== -1) {
      let targetDay: Dayjs;

      if (expr.startsWith('this ')) {
        // "this saturday" = upcoming Saturday (within 7 days)
        targetDay = findNextWeekday(today, targetWeekdayIndex, timezone);
      } else {
        // "next saturday" = Saturday after this one (8-14 days away)
        const thisSaturday = findNextWeekday(today, targetWeekdayIndex, timezone);
        targetDay = thisSaturday.add(7, 'days');
      }

      return {
        from: targetDay.startOf('day'),
        to: targetDay.endOf('day'),
        description: `${expr} (${targetDay.format('MMM D')})`
      };
    }
  }

  // Handle "next week" - return Monday to Friday of next week
  if (expr === 'next week') {
    const currentWeekday = now.day();
    // Calculate days until next Monday (day 1)
    const daysUntilNextMonday = currentWeekday === 0 ? 1 : (8 - currentWeekday);
    const nextMonday = today.add(daysUntilNextMonday, 'days');
    const nextFriday = nextMonday.add(4, 'days');

    return {
      from: nextMonday.startOf('day'),
      to: nextFriday.endOf('day'),
      description: `next week (${nextMonday.format('MMM D')} - ${nextFriday.format('MMM D')})`
    };
  }

  // Handle relative time expressions: "in X days/weeks/months"
  const relativeMatch = expr.match(/in\s+(\d+|a|an|one|two|three)\s+(day|days|week|weeks|month|months)/);
  if (relativeMatch) {
    const numberWord = relativeMatch[1];
    const unit = relativeMatch[2];

    // Convert word numbers to digits
    const numberMap: Record<string, number> = {
      'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3
    };
    const amount = numberMap[numberWord] || parseInt(numberWord, 10);

    // Normalize unit to singular
    const normalizedUnit = unit.replace(/s$/, '') as 'day' | 'week' | 'month';

    const targetDate = today.add(amount, normalizedUnit);
    return {
      from: targetDate.startOf('day'),
      to: targetDate.endOf('day'),
      description: `in ${amount} ${normalizedUnit}${amount > 1 ? 's' : ''} (${targetDate.format('MMM D')})`
    };
  }

  // Handle explicit dates: "23rd", "the 23rd", "on the 23rd", "may 23rd", "23rd of may", etc.
  const explicitDateResult = parseExplicitDate(expr, now, timezone);
  if (explicitDateResult) {
    return explicitDateResult;
  }

  // Fallback - no specific date parsed, return next 14 days
  console.warn('[DateParser] Could not parse date expression:', expr);
  return {
    from: now,
    to: now.add(14, 'days'),
    description: `next 2 weeks (couldn't parse "${expr}")`
  };
}

/**
 * Parse explicit date expressions like:
 * - "23rd", "the 23rd", "on the 23rd"
 * - "may 23rd", "23rd of may", "may 23"
 * - "23 may", "23/05", "23-05"
 */
function parseExplicitDate(
  expr: string,
  now: Dayjs,
  tz: string
): DateRange | null {
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const monthAbbrs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // Remove common prefixes
  let cleaned = expr
    .replace(/^(on\s+)?(the\s+)?/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Pattern 1: Day with ordinal only (e.g., "23rd", "1st", "15th")
  const dayOnlyMatch = cleaned.match(/^(\d{1,2})(st|nd|rd|th)?$/i);
  if (dayOnlyMatch) {
    const day = parseInt(dayOnlyMatch[1], 10);
    if (day >= 1 && day <= 31) {
      const targetDate = findNextDateWithDay(now, day, tz);
      return {
        from: targetDate.startOf('day'),
        to: targetDate.endOf('day'),
        description: `the ${day}${getOrdinalSuffix(day)} (${targetDate.format('MMM D')})`
      };
    }
  }

  // Pattern 2: "23rd of may", "15th of december"
  const dayOfMonthMatch = cleaned.match(/^(\d{1,2})(st|nd|rd|th)?\s+(of\s+)?(\w+)$/i);
  if (dayOfMonthMatch) {
    const day = parseInt(dayOfMonthMatch[1], 10);
    const monthStr = dayOfMonthMatch[4].toLowerCase();
    const monthIndex = months.indexOf(monthStr) !== -1
      ? months.indexOf(monthStr)
      : monthAbbrs.indexOf(monthStr);

    if (monthIndex !== -1 && day >= 1 && day <= 31) {
      const targetDate = findDateWithMonthDay(now, monthIndex, day, tz);
      return {
        from: targetDate.startOf('day'),
        to: targetDate.endOf('day'),
        description: `${months[monthIndex]} ${day} (${targetDate.format('YYYY-MM-DD')})`
      };
    }
  }

  // Pattern 3: "may 23rd", "december 15"
  const monthDayMatch = cleaned.match(/^(\w+)\s+(\d{1,2})(st|nd|rd|th)?$/i);
  if (monthDayMatch) {
    const monthStr = monthDayMatch[1].toLowerCase();
    const day = parseInt(monthDayMatch[2], 10);
    const monthIndex = months.indexOf(monthStr) !== -1
      ? months.indexOf(monthStr)
      : monthAbbrs.indexOf(monthStr);

    if (monthIndex !== -1 && day >= 1 && day <= 31) {
      const targetDate = findDateWithMonthDay(now, monthIndex, day, tz);
      return {
        from: targetDate.startOf('day'),
        to: targetDate.endOf('day'),
        description: `${months[monthIndex]} ${day} (${targetDate.format('YYYY-MM-DD')})`
      };
    }
  }

  // Pattern 4: "23/5", "23-5", "23/05", "05/23" (ambiguous - assume DD/MM for AU)
  const slashMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (slashMatch) {
    // Assume DD/MM format for Australian locale
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10) - 1; // 0-indexed

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const targetDate = findDateWithMonthDay(now, month, day, tz);
      return {
        from: targetDate.startOf('day'),
        to: targetDate.endOf('day'),
        description: `${day}/${month + 1} (${targetDate.format('MMM D, YYYY')})`
      };
    }
  }

  return null;
}

/**
 * Find the next occurrence of a specific day of month
 * If the day has already passed this month, returns next month's date
 */
function findNextDateWithDay(now: Dayjs, day: number, tz: string): Dayjs {
  const currentDay = now.date();
  const currentMonth = now.month();
  const currentYear = now.year();

  // If the requested day is today or later this month, use this month
  if (day >= currentDay) {
    const candidate = now.date(day);
    // Check if the date is valid (e.g., Feb 30 doesn't exist)
    if (candidate.date() === day) {
      return candidate;
    }
  }

  // Otherwise, try next month
  let nextMonth = now.add(1, 'month').startOf('month');
  let attempts = 0;

  while (attempts < 12) {
    const candidate = nextMonth.date(day);
    if (candidate.date() === day) {
      return candidate;
    }
    // Day doesn't exist in this month, try next
    nextMonth = nextMonth.add(1, 'month');
    attempts++;
  }

  // Fallback to next occurrence
  return now.add(1, 'month').date(Math.min(day, 28));
}

/**
 * Find the next occurrence of a specific month and day
 * If the date has passed this year, returns next year's date
 */
function findDateWithMonthDay(now: Dayjs, month: number, day: number, tz: string): Dayjs {
  const currentYear = now.year();

  // Try this year first
  let candidate = dayjs.tz(`${currentYear}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, tz);

  // Validate the date exists (e.g., Feb 30 doesn't exist)
  if (candidate.month() !== month || candidate.date() !== day) {
    // Invalid date, try to get the last valid day of that month
    candidate = dayjs.tz(`${currentYear}-${String(month + 1).padStart(2, '0')}-01`, tz).endOf('month');
  }

  // If date is in the past, use next year
  if (candidate.isBefore(now.startOf('day'))) {
    candidate = dayjs.tz(`${currentYear + 1}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, tz);
    // Validate again
    if (candidate.month() !== month || candidate.date() !== day) {
      candidate = dayjs.tz(`${currentYear + 1}-${String(month + 1).padStart(2, '0')}-01`, tz).endOf('month');
    }
  }

  return candidate;
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 */
function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Find the next occurrence of a specific weekday
 *
 * @param fromDate - Start searching from this date
 * @param targetWeekday - Target day of week (0=Sunday, 6=Saturday)
 * @param timezone - Timezone for calculation
 * @returns The next occurrence of the target weekday
 */
function findNextWeekday(fromDate: Dayjs, targetWeekday: number, timezone: string): Dayjs {
  const currentWeekday = fromDate.day();

  if (currentWeekday === targetWeekday) {
    // Today IS the target day - return today if it's morning, otherwise next week
    const currentHour = dayjs().tz(timezone).hour();
    if (currentHour < 12) {
      // Still morning - offer today
      return fromDate;
    } else {
      // Afternoon/evening - offer next week
      return fromDate.add(7, 'days');
    }
  }

  // Calculate days until target weekday
  let daysUntilTarget = targetWeekday - currentWeekday;

  if (daysUntilTarget <= 0) {
    // Target day is earlier in the week, so it must be next week
    daysUntilTarget += 7;
  }

  return fromDate.add(daysUntilTarget, 'days');
}

/**
 * Format date range for logging
 */
export function formatDateRange(range: DateRange): string {
  return `${range.from.format('MMM D h:mma')} - ${range.to.format('MMM D h:mma')} (${range.description})`;
}

/**
 * Extract time preference from natural language
 * Handles: "2pm", "2:00pm", "14:00", "2 o'clock", "two pm", "half past two", etc.
 *
 * @param text - Text that may contain time preference
 * @returns Hour (0-23) and minute (0-59), or null if no time found
 */
export function extractTimePreference(text: string | undefined): { hour: number; minute: number } | null {
  if (!text) return null;

  const cleaned = text.toLowerCase().trim();

  // Pattern 1: "2pm", "2 pm", "14:00", "2:30pm", "14:30"
  const timePattern = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;
  const match = cleaned.match(timePattern);

  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3]?.toLowerCase().replace(/\./g, '');

    // Convert 12-hour to 24-hour format
    if (meridiem === 'pm' || meridiem === 'pm') {
      if (hour !== 12) hour += 12;
    } else if (meridiem === 'am' || meridiem === 'am') {
      if (hour === 12) hour = 0;
    } else {
      // No meridiem specified - use context
      // If hour is 1-7, assume PM for appointments (13:00-19:00)
      // If hour is 8-12, could be AM
      if (hour >= 1 && hour <= 7) {
        hour += 12; // Assume afternoon
      }
    }

    // Validate hour and minute
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  // Pattern 2: Word numbers - "two pm", "three thirty", etc.
  const wordNumbers: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12
  };

  for (const [word, num] of Object.entries(wordNumbers)) {
    const wordPattern = new RegExp(`\\b${word}\\s*(o'?clock|am|pm|a\\.m\\.|p\\.m\\.)\\b`, 'i');
    const wordMatch = cleaned.match(wordPattern);
    if (wordMatch) {
      let hour = num;
      const meridiem = wordMatch[1]?.toLowerCase().replace(/\./g, '').replace(/o'?clock/, '').trim();

      if (meridiem === 'pm') {
        if (hour !== 12) hour += 12;
      } else if (meridiem === 'am') {
        if (hour === 12) hour = 0;
      } else if (hour >= 1 && hour <= 7) {
        hour += 12; // Assume PM for typical appointment times
      }

      if (hour >= 0 && hour <= 23) {
        return { hour, minute: 0 };
      }
    }
  }

  return null;
}
