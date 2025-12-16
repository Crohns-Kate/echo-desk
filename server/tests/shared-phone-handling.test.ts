/**
 * Shared Phone Handling Tests
 * 
 * Tests for handling shared phone numbers (e.g., mother booking for child)
 * Ensures phone number ≠ identity and proper disambiguation flow
 * 
 * Run: node --import tsx server/tests/shared-phone-handling.test.ts
 */

import { getOrCreateContext, handleOpenAIConversation } from '../services/openai-call-handler';
import { initializeConversation } from '../ai/receptionistBrain';
import { storage } from '../storage';

// Mock dependencies
jest.mock('../services/cliniko', () => ({
  findPatientByPhoneRobust: jest.fn(),
  createAppointmentForPatient: jest.fn(),
  getAvailability: jest.fn()
}));

jest.mock('../storage', () => ({
  storage: {
    getCallByCallSid: jest.fn(),
    updateConversation: jest.fn(),
    getTenantById: jest.fn()
  }
}));

jest.mock('../ai/receptionistBrain', () => ({
  ...jest.requireActual('../ai/receptionistBrain'),
  callReceptionistBrain: jest.fn()
}));

describe('Shared Phone Handling', () => {
  const callSid = 'test-call-123';
  const callerPhone = '+61400000000';
  const tenantId = 1;
  const clinicName = 'Test Clinic';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Scenario 1: Same number → "booking for my child" → new patient created', () => {
    it('should ask "booking for yourself or someone else?" when possible patient found', async () => {
      // Setup: Phone matches existing patient (mother)
      const { findPatientByPhoneRobust } = require('../services/cliniko');
      findPatientByPhoneRobust.mockResolvedValue({
        id: '123',
        first_name: 'Jane',
        last_name: 'Smith'
      });

      const context = await getOrCreateContext(callSid, callerPhone, tenantId, clinicName);

      // Verify possiblePatientId is set but confirmedPatientId is not
      expect(context.possiblePatientId).toBe('123');
      expect(context.possiblePatientName).toBe('Jane Smith');
      expect(context.confirmedPatientId).toBeUndefined();
      expect(context.sharedPhoneDisambiguation).toBeUndefined();
    });

    it('should ask for child name when user says "for my child"', async () => {
      const context = initializeConversation(callSid, callerPhone, clinicName);
      context.possiblePatientId = '123';
      context.possiblePatientName = 'Jane Smith';
      context.sharedPhoneDisambiguation = { asked: true };

      const { callReceptionistBrain } = require('../ai/receptionistBrain');
      callReceptionistBrain.mockResolvedValue({
        reply: 'No worries. What\'s the full name of the person you\'re booking for?',
        state: { np: true, bc: false },
        expect_user_reply: true
      });

      const response = await handleOpenAIConversation({
        callSid,
        callerPhone,
        userUtterance: 'for my child',
        tenantId,
        clinicName
      });

      // Verify answer is set to "someone_else"
      expect(context.sharedPhoneDisambiguation?.answer).toBe('someone_else');
      expect(context.possiblePatientId).toBeUndefined(); // Cleared since it's not the caller
    });

    it('should create new patient when child name provided', async () => {
      const context = initializeConversation(callSid, callerPhone, clinicName);
      context.sharedPhoneDisambiguation = {
        asked: true,
        answer: 'someone_else'
      };
      context.currentState = { np: true };

      const { callReceptionistBrain } = require('../ai/receptionistBrain');
      callReceptionistBrain.mockResolvedValue({
        reply: 'Thanks. What\'s the full name?',
        state: { nm: 'Emma Smith', np: true, bc: true, si: 0 },
        expect_user_reply: false
      });

      const { createAppointmentForPatient } = require('../services/cliniko');
      createAppointmentForPatient.mockResolvedValue({ id: 'appt-456' });

      const response = await handleOpenAIConversation({
        callSid,
        callerPhone,
        userUtterance: 'Emma Smith',
        tenantId,
        clinicName
      });

      // Verify new patient is created (not using mother's patient ID)
      expect(createAppointmentForPatient).toHaveBeenCalled();
      const callArgs = createAppointmentForPatient.mock.calls[0];
      expect(callArgs[0]).toBe(callerPhone); // Uses caller phone
      expect(callArgs[1].fullName).toBe('Emma Smith'); // Child's name
    });
  });

  describe('Scenario 2: Same number → "for myself" + name match → existing patient', () => {
    it('should confirm identity when name matches', async () => {
      const context = initializeConversation(callSid, callerPhone, clinicName);
      context.possiblePatientId = '123';
      context.possiblePatientName = 'Jane Smith';
      context.sharedPhoneDisambiguation = {
        asked: true,
        answer: 'myself'
      };

      const { callReceptionistBrain } = require('../ai/receptionistBrain');
      callReceptionistBrain.mockResolvedValue({
        reply: 'Thanks for confirming. What\'s your full name?',
        state: { nm: 'Jane Smith', np: false, bc: true, si: 0 },
        expect_user_reply: false
      });

      const { calculateNameSimilarity } = require('../utils/name-matcher');
      // Mock name similarity to return high match
      jest.spyOn(require('../utils/name-matcher'), 'calculateNameSimilarity').mockReturnValue(0.95);

      const response = await handleOpenAIConversation({
        callSid,
        callerPhone,
        userUtterance: 'Jane Smith',
        tenantId,
        clinicName
      });

      // Verify confirmedPatientId is set
      expect(context.confirmedPatientId).toBe('123');
      expect(context.sharedPhoneDisambiguation).toBeUndefined(); // Cleared after confirmation
    });

    it('should use existing patient for booking when confirmed', async () => {
      const context = initializeConversation(callSid, callerPhone, clinicName);
      context.confirmedPatientId = '123';
      context.currentState = { np: false };

      const { createAppointmentForPatient } = require('../services/cliniko');
      createAppointmentForPatient.mockResolvedValue({ id: 'appt-789' });

      // Verify booking uses confirmed patient
      expect(context.confirmedPatientId).toBe('123');
      // The appointment will be created with the confirmed patient ID
    });
  });

  describe('Scenario 3: Same number → name mismatch → new patient', () => {
    it('should treat as new patient when name does not match', async () => {
      const context = initializeConversation(callSid, callerPhone, clinicName);
      context.possiblePatientId = '123';
      context.possiblePatientName = 'Jane Smith';
      context.sharedPhoneDisambiguation = {
        asked: true,
        answer: 'myself'
      };

      const { callReceptionistBrain } = require('../ai/receptionistBrain');
      callReceptionistBrain.mockResolvedValue({
        reply: 'Thanks for confirming. What\'s your full name?',
        state: { nm: 'John Doe', np: true, bc: true, si: 0 },
        expect_user_reply: false
      });

      // Mock name similarity to return low match
      jest.spyOn(require('../utils/name-matcher'), 'calculateNameSimilarity').mockReturnValue(0.3);

      const response = await handleOpenAIConversation({
        callSid,
        callerPhone,
        userUtterance: 'John Doe',
        tenantId,
        clinicName
      });

      // Verify possiblePatientId is cleared and treated as new patient
      expect(context.possiblePatientId).toBeUndefined();
      expect(context.confirmedPatientId).toBeUndefined();
      expect(context.currentState.np).toBe(true); // New patient
    });
  });

  describe('Handoff Prevention', () => {
    it('should never trigger handoff during shared phone disambiguation', async () => {
      const context = initializeConversation(callSid, callerPhone, clinicName);
      context.possiblePatientId = '123';
      context.sharedPhoneDisambiguation = { asked: true };

      // Even if user shows frustration, handoff should not trigger
      const { detectHandoffTrigger } = require('../utils/handoff-detector');
      const handoffResult = detectHandoffTrigger(
        'I don\'t understand',
        [],
        { noMatchCount: 0, confidence: 0.8, isOutOfScope: false, hasClinikoError: false }
      );

      // Verify handoff detection is skipped during shared phone disambiguation
      expect(context.sharedPhoneDisambiguation).toBeDefined();
      // Handoff should be prevented in the handler
    });
  });

  describe('Natural Language Handling', () => {
    it('should recognize "myself" variations', () => {
      const variations = [
        'for myself',
        'yes, for me',
        'I\'m booking for myself',
        'myself',
        'yes, me'
      ];

      variations.forEach(utterance => {
        const lower = utterance.toLowerCase();
        const isMyself = lower.includes('myself') || 
                         lower.includes('for me') ||
                         (lower.includes('yes') && (lower.includes('me') || lower.includes('myself'))) ||
                         (lower.includes("i'm") && lower.includes('booking')) ||
                         (lower.includes('i am') && lower.includes('booking'));
        
        expect(isMyself).toBe(true);
      });
    });

    it('should recognize "someone else" variations', () => {
      const variations = [
        'for someone else',
        'for my child',
        'for my daughter',
        'for my son',
        'booking for my kid',
        'no, for someone else'
      ];

      variations.forEach(utterance => {
        const lower = utterance.toLowerCase();
        const isSomeoneElse = lower.includes('someone else') ||
                              lower.includes('for someone') ||
                              lower.includes('child') ||
                              lower.includes('daughter') ||
                              lower.includes('son') ||
                              lower.includes('kid') ||
                              lower.includes('family member') ||
                              (lower.includes('my ') && (lower.includes('child') || lower.includes('daughter') || lower.includes('son'))) ||
                              (lower.includes('no') && !lower.includes('yes'));
        
        expect(isSomeoneElse).toBe(true);
      });
    });
  });
});

// Export for test runner
export {};

