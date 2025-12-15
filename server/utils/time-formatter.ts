/**
 * Time Formatting Utilities
 * 
 * Provides natural spoken time formatting with rounding for better UX
 */

import dayjs from 'dayjs';

/**
 * Round time to nearest 5 minutes
 * Example: 9:47 → 9:45, 9:49 → 9:50, 9:52 → 9:50
 */
export function roundToNearest5Minutes(date: Date | string): Date {
  const d = dayjs(date);
  const minutes = d.minute();
  const roundedMinutes = Math.round(minutes / 5) * 5;
  
  if (roundedMinutes >= 60) {
    return d.add(1, 'hour').minute(0).second(0).millisecond(0).toDate();
  }
  
  return d.minute(roundedMinutes).second(0).millisecond(0).toDate();
}

/**
 * Format time for natural speech
 * Rounds to nearest 5 minutes and formats naturally
 * Examples:
 *   "9:00am" → "nine o'clock"
 *   "9:45am" → "nine forty-five"
 *   "2:30pm" → "two thirty"
 *   "10:05am" → "ten oh five"
 */
export function formatSpokenTime(date: Date | string, timezone: string = 'Australia/Brisbane'): string {
  const rounded = roundToNearest5Minutes(date);
  const d = dayjs(rounded).tz(timezone);
  
  const hour = d.hour();
  const minute = d.minute();
  const isAM = hour < 12;
  const hour12 = hour % 12 || 12;
  
  // Convert hour to words
  const hourWords = [
    'twelve', 'one', 'two', 'three', 'four', 'five', 'six',
    'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'
  ];
  const hourWord = hourWords[hour12];
  
  // Format minutes
  let minutePart = '';
  if (minute === 0) {
    minutePart = "o'clock";
  } else if (minute < 10) {
    const minuteWords = ['', 'oh one', 'oh two', 'oh three', 'oh four', 'oh five', 'oh six', 'oh seven', 'oh eight', 'oh nine'];
    minutePart = minuteWords[minute];
  } else if (minute === 15) {
    minutePart = 'fifteen';
  } else if (minute === 30) {
    minutePart = 'thirty';
  } else if (minute === 45) {
    minutePart = 'forty-five';
  } else {
    // For other times, use numeric format but natural phrasing
    const tens = Math.floor(minute / 10);
    const ones = minute % 10;
    const tensWords = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
    const onesWords = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    
    if (tens === 1) {
      // Teens
      const teenWords = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
      minutePart = teenWords[ones];
    } else {
      minutePart = tensWords[tens];
      if (ones > 0) {
        minutePart += (tens > 1 ? '-' : ' ') + onesWords[ones];
      }
    }
  }
  
  const ampm = isAM ? 'a m' : 'p m';
  
  if (minute === 0) {
    return `${hourWord} ${minutePart} ${ampm}`;
  } else {
    return `${hourWord} ${minutePart} ${ampm}`;
  }
}

/**
 * Format time for slot display (simpler format, still rounded)
 * Example: "9:45 AM", "2:30 PM"
 */
export function formatSlotTime(date: Date | string, timezone: string = 'Australia/Brisbane'): string {
  const rounded = roundToNearest5Minutes(date);
  const d = dayjs(rounded).tz(timezone);
  return d.format('h:mm A');
}
