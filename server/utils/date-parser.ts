/**
 * Date Parser Utility
 * Converts natural language date expressions into date ranges
 */

import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { AUST_TZ } from '../time';

dayjs.extend(utc);
dayjs.extend(timezone);

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
 * @returns Date range covering the requested day
 */
export function parseNaturalDate(
  dayExpression: string | undefined,
  timezone: string = AUST_TZ
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

  // Handle "today"
  if (expr === 'today') {
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

  // Fallback - no specific date parsed, return next 14 days
  console.warn('[DateParser] Could not parse date expression:', expr);
  return {
    from: now,
    to: now.add(14, 'days'),
    description: `next 2 weeks (couldn't parse "${expr}")`
  };
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
