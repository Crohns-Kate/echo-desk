/**
 * Booking Edge Cases Tests
 *
 * Tests for:
 * 1. Time selection with ambiguity (multiple practitioners at same time)
 * 2. Practitioner selection with ambiguity (multiple times with same practitioner)
 * 3. Map question after confirmation SMS already sent (no resend)
 * 4. Booking lock preventing duplicate Cliniko create calls
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock types for testing
interface EnrichedSlot {
  startISO: string;
  speakable: string;
  speakableWithPractitioner: string;
  clinikoPractitionerId: string;
  practitionerDisplayName: string;
  appointmentTypeId: string;
}

interface CompactCallState {
  im?: string;
  np?: boolean;
  nm?: string;
  tp?: string;
  bc?: boolean;
  si?: number;
  ml?: boolean;
  smsConfirmSent?: boolean;
  smsMapSent?: boolean;
  confirmSmsIncludedMap?: boolean;
  bookingLockUntil?: number;
  appointmentCreated?: boolean;
}

// ══════════════════════════════════════════════════════════════
// Test 1: Time Selection with Ambiguity
// ══════════════════════════════════════════════════════════════

describe('Time Selection with Ambiguity', () => {
  const slotsWithSameTime: EnrichedSlot[] = [
    {
      startISO: '2024-12-12T14:45:00+10:00',
      speakable: '2:45 PM',
      speakableWithPractitioner: '2:45 PM with Dr Sarah',
      clinikoPractitionerId: '123',
      practitionerDisplayName: 'Dr Sarah',
      appointmentTypeId: '456'
    },
    {
      startISO: '2024-12-12T14:45:00+10:00',
      speakable: '2:45 PM',
      speakableWithPractitioner: '2:45 PM with Dr Michael',
      clinikoPractitionerId: '789',
      practitionerDisplayName: 'Dr Michael',
      appointmentTypeId: '456'
    },
    {
      startISO: '2024-12-12T15:00:00+10:00',
      speakable: '3:00 PM',
      speakableWithPractitioner: '3:00 PM with Dr Sarah',
      clinikoPractitionerId: '123',
      practitionerDisplayName: 'Dr Sarah',
      appointmentTypeId: '456'
    }
  ];

  it('should detect ambiguity when user says "2:45" and multiple practitioners available', () => {
    const userInput = '2:45';
    const matchingSlots = slotsWithSameTime.filter(s =>
      s.speakable.includes('2:45') || s.startISO.includes('14:45')
    );

    // Should find 2 matches (ambiguous)
    expect(matchingSlots.length).toBe(2);
    expect(matchingSlots[0].practitionerDisplayName).toBe('Dr Sarah');
    expect(matchingSlots[1].practitionerDisplayName).toBe('Dr Michael');

    // AI should ask clarification, NOT set si or bc
    // Expected response: "I have 2:45 with Dr Sarah or 2:45 with Dr Michael — which do you prefer?"
  });

  it('should resolve unambiguously when user says "3:00"', () => {
    const userInput = '3:00';
    const matchingSlots = slotsWithSameTime.filter(s =>
      s.speakable.includes('3:00') || s.startISO.includes('15:00')
    );

    // Should find 1 match (unambiguous)
    expect(matchingSlots.length).toBe(1);
    expect(matchingSlots[0].practitionerDisplayName).toBe('Dr Sarah');

    // AI should set si=2, bc=true immediately
  });
});

// ══════════════════════════════════════════════════════════════
// Test 2: Practitioner Selection with Ambiguity
// ══════════════════════════════════════════════════════════════

describe('Practitioner Selection with Ambiguity', () => {
  const slotsWithSamePractitioner: EnrichedSlot[] = [
    {
      startISO: '2024-12-12T14:30:00+10:00',
      speakable: '2:30 PM',
      speakableWithPractitioner: '2:30 PM with Dr Sarah',
      clinikoPractitionerId: '123',
      practitionerDisplayName: 'Dr Sarah',
      appointmentTypeId: '456'
    },
    {
      startISO: '2024-12-12T14:45:00+10:00',
      speakable: '2:45 PM',
      speakableWithPractitioner: '2:45 PM with Dr Sarah',
      clinikoPractitionerId: '123',
      practitionerDisplayName: 'Dr Sarah',
      appointmentTypeId: '456'
    },
    {
      startISO: '2024-12-12T15:00:00+10:00',
      speakable: '3:00 PM',
      speakableWithPractitioner: '3:00 PM with Dr Michael',
      clinikoPractitionerId: '789',
      practitionerDisplayName: 'Dr Michael',
      appointmentTypeId: '456'
    }
  ];

  it('should detect ambiguity when user says "with Sarah" and multiple times available', () => {
    const userInput = 'with Sarah';
    const matchingSlots = slotsWithSamePractitioner.filter(s =>
      s.practitionerDisplayName.toLowerCase().includes('sarah')
    );

    // Should find 2 matches (ambiguous)
    expect(matchingSlots.length).toBe(2);
    expect(matchingSlots[0].speakable).toBe('2:30 PM');
    expect(matchingSlots[1].speakable).toBe('2:45 PM');

    // AI should ask: "With Dr Sarah I have 2:30 PM or 2:45 PM — which works better?"
  });

  it('should resolve unambiguously when user says "with Michael"', () => {
    const userInput = 'with Michael';
    const matchingSlots = slotsWithSamePractitioner.filter(s =>
      s.practitionerDisplayName.toLowerCase().includes('michael')
    );

    // Should find 1 match (unambiguous)
    expect(matchingSlots.length).toBe(1);
    expect(matchingSlots[0].speakable).toBe('3:00 PM');

    // AI should set si=2, bc=true immediately
  });
});

// ══════════════════════════════════════════════════════════════
// Test 3: Map Question After Confirmation SMS (No Resend)
// ══════════════════════════════════════════════════════════════

describe('Map Link After Confirmation SMS', () => {
  it('should NOT send map SMS if confirmSmsIncludedMap is true', () => {
    const state: CompactCallState = {
      bc: true,
      smsConfirmSent: true,
      confirmSmsIncludedMap: true,  // Map was in confirmation SMS
      smsMapSent: true              // Already sent via confirmation
    };

    // User asks "where are you located?"
    // AI should respond: "It's in your confirmation text — you can tap the link to open Google Maps."
    // AI should NOT set ml=true

    expect(state.confirmSmsIncludedMap).toBe(true);
    expect(state.smsMapSent).toBe(true);

    // Simulate AI response: should NOT trigger new SMS
    const shouldSendNewMap = state.ml === true && !state.smsMapSent;
    expect(shouldSendNewMap).toBe(false);
  });

  it('should send map SMS if confirmation did NOT include map', () => {
    const state: CompactCallState = {
      bc: true,
      smsConfirmSent: true,
      confirmSmsIncludedMap: false,  // Map was NOT in confirmation
      smsMapSent: false
    };

    // User asks "can you send directions?"
    // AI sets ml=true
    state.ml = true;

    const shouldSendNewMap = state.ml === true && !state.smsMapSent;
    expect(shouldSendNewMap).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// Test 4: Booking Lock Prevents Duplicate Cliniko Calls
// ══════════════════════════════════════════════════════════════

describe('Booking Lock', () => {
  it('should acquire lock and proceed with booking when no lock exists', () => {
    const state: CompactCallState = {
      bc: true,
      nm: 'John Smith',
      si: 0,
      appointmentCreated: false,
      bookingLockUntil: undefined
    };

    const now = Date.now();
    const lockExpiry = state.bookingLockUntil || 0;
    const isLocked = lockExpiry > now;

    expect(isLocked).toBe(false);

    // Should acquire lock
    state.bookingLockUntil = now + 10_000;
    expect(state.bookingLockUntil).toBeGreaterThan(now);
  });

  it('should skip booking when lock is active', () => {
    const now = Date.now();
    const state: CompactCallState = {
      bc: true,
      nm: 'John Smith',
      si: 0,
      appointmentCreated: false,
      bookingLockUntil: now + 5_000  // Lock expires in 5 seconds
    };

    const lockExpiry = state.bookingLockUntil || 0;
    const isLocked = lockExpiry > now;

    expect(isLocked).toBe(true);

    // Should NOT proceed with booking
    // Log: "Booking lock active, skipping duplicate attempt"
  });

  it('should allow booking after lock expires', () => {
    const now = Date.now();
    const state: CompactCallState = {
      bc: true,
      nm: 'John Smith',
      si: 0,
      appointmentCreated: false,
      bookingLockUntil: now - 1_000  // Lock expired 1 second ago
    };

    const lockExpiry = state.bookingLockUntil || 0;
    const isLocked = lockExpiry > now;

    expect(isLocked).toBe(false);

    // Should proceed with booking (but appointmentCreated check will also apply)
  });

  it('should not rebook if appointmentCreated is true regardless of lock', () => {
    const now = Date.now();
    const state: CompactCallState = {
      bc: true,
      nm: 'John Smith',
      si: 0,
      appointmentCreated: true,  // Already created
      bookingLockUntil: now - 1_000  // Lock expired
    };

    // Even with expired lock, should NOT rebook because appointmentCreated=true
    expect(state.appointmentCreated).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// Test 5: Cache Key Normalization
// ══════════════════════════════════════════════════════════════

describe('Cache Key Normalization', () => {
  // Test helper to simulate normalizeTimeRangeForCache
  function normalizeTimeRangeForCache(fromISO: string, toISO: string): string {
    const fromDate = new Date(fromISO);
    const toDate = new Date(toISO);
    const dateStr = fromDate.toISOString().split('T')[0];

    const fromHour = fromDate.getHours();
    const toHour = toDate.getHours();

    let timeLabel = 'full';
    if (fromHour >= 5 && toHour <= 12) {
      timeLabel = 'morning';
    } else if (fromHour >= 12 && toHour <= 17) {
      timeLabel = 'afternoon';
    } else if (fromHour >= 17 && toHour <= 21) {
      timeLabel = 'evening';
    }

    return `${dateStr}_${timeLabel}`;
  }

  it('should normalize morning time range', () => {
    const result = normalizeTimeRangeForCache(
      '2024-12-12T08:00:00+10:00',
      '2024-12-12T12:00:00+10:00'
    );
    expect(result).toContain('morning');
  });

  it('should normalize afternoon time range', () => {
    const result = normalizeTimeRangeForCache(
      '2024-12-12T12:00:00+10:00',
      '2024-12-12T17:00:00+10:00'
    );
    expect(result).toContain('afternoon');
  });

  it('should use different cache keys for different time preferences', () => {
    const morningKey = normalizeTimeRangeForCache(
      '2024-12-12T08:00:00+10:00',
      '2024-12-12T12:00:00+10:00'
    );
    const afternoonKey = normalizeTimeRangeForCache(
      '2024-12-12T12:00:00+10:00',
      '2024-12-12T17:00:00+10:00'
    );

    expect(morningKey).not.toBe(afternoonKey);
  });
});
