/**
 * Speech Helpers Tests
 * Tests for yes/no/confirmation speech recognition utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isAffirmative,
  isNegative,
  classifyYesNo,
  isIdentityConfirmation,
  wantsToBook,
  AFFIRMATIVE_WORDS,
  NEGATIVE_WORDS
} from '../utils/speech-helpers';

describe('isAffirmative', () => {
  describe('should recognize standard affirmative words', () => {
    const affirmatives = [
      'yes', 'Yes', 'YES',
      'yeah', 'yep', 'yup', 'yea',
      'ok', 'OK', 'okay', 'Okay', 'o.k.',
      'sure', 'Sure',
      'alright', 'all right',
      'correct', 'right',
      'absolutely', 'definitely', 'certainly',
      'perfect', 'sounds good', 'that works',
      'uh huh', 'mm hmm', 'mhm',
      'please', 'go ahead'
    ];

    affirmatives.forEach(word => {
      it(`should recognize "${word}" as affirmative`, () => {
        expect(isAffirmative(word)).toBe(true);
      });
    });
  });

  describe('should recognize affirmative phrases', () => {
    const phrases = [
      'yes please',
      'yeah that works',
      'okay sounds good',
      'sure thing',
      'alright then',
      'that\'s right',
      'yes that\'s me',
      'ok let\'s do it'
    ];

    phrases.forEach(phrase => {
      it(`should recognize "${phrase}" as affirmative`, () => {
        expect(isAffirmative(phrase)).toBe(true);
      });
    });
  });

  describe('should NOT recognize negative responses as affirmative', () => {
    const negatives = ['no', 'nope', 'nah', 'not really', 'wrong'];

    negatives.forEach(word => {
      it(`should NOT recognize "${word}" as affirmative`, () => {
        expect(isAffirmative(word)).toBe(false);
      });
    });
  });

  it('should return false for empty string', () => {
    expect(isAffirmative('')).toBe(false);
  });

  it('should handle mixed case', () => {
    expect(isAffirmative('OKAY')).toBe(true);
    expect(isAffirmative('YeAh')).toBe(true);
  });
});

describe('isNegative', () => {
  describe('should recognize standard negative words', () => {
    const negatives = [
      'no', 'No', 'NO',
      'nope', 'nah', 'naw',
      'not', 'don\'t', 'do not',
      'wrong', 'incorrect',
      'different', 'other', 'another',
      'neither', 'none',
      'cancel', 'stop', 'never mind'
    ];

    negatives.forEach(word => {
      it(`should recognize "${word}" as negative`, () => {
        expect(isNegative(word)).toBe(true);
      });
    });
  });

  describe('should recognize negative phrases', () => {
    const phrases = [
      'no thanks',
      'nope not today',
      'I don\'t think so',
      'that\'s wrong',
      'a different time',
      'cancel that'
    ];

    phrases.forEach(phrase => {
      it(`should recognize "${phrase}" as negative`, () => {
        expect(isNegative(phrase)).toBe(true);
      });
    });
  });

  describe('should NOT recognize affirmative responses as negative', () => {
    const affirmatives = ['yes', 'yeah', 'ok', 'sure', 'alright'];

    affirmatives.forEach(word => {
      it(`should NOT recognize "${word}" as negative`, () => {
        expect(isNegative(word)).toBe(false);
      });
    });
  });

  it('should return false for empty string', () => {
    expect(isNegative('')).toBe(false);
  });
});

describe('classifyYesNo', () => {
  it('should return "yes" for clear affirmatives', () => {
    expect(classifyYesNo('yes')).toBe('yes');
    expect(classifyYesNo('okay')).toBe('yes');
    expect(classifyYesNo('sure thing')).toBe('yes');
  });

  it('should return "no" for clear negatives', () => {
    expect(classifyYesNo('no')).toBe('no');
    expect(classifyYesNo('nope')).toBe('no');
    expect(classifyYesNo('not today')).toBe('no');
  });

  it('should return "unclear" for ambiguous responses', () => {
    expect(classifyYesNo('maybe')).toBe('unclear');
    expect(classifyYesNo('I think so')).toBe('unclear');
    expect(classifyYesNo('hmm')).toBe('unclear');
  });

  it('should return "unclear" when both yes and no detected', () => {
    // Edge case: "yes but no" contains both
    expect(classifyYesNo('yes but actually no')).toBe('unclear');
  });
});

describe('isIdentityConfirmation', () => {
  it('should recognize standard confirmations', () => {
    expect(isIdentityConfirmation('yes', 'John')).toBe(true);
    expect(isIdentityConfirmation('yeah that\'s me', 'John')).toBe(true);
    expect(isIdentityConfirmation('correct', 'John')).toBe(true);
  });

  it('should recognize when caller says their name', () => {
    expect(isIdentityConfirmation('John', 'John Smith')).toBe(true);
    expect(isIdentityConfirmation('this is john', 'John Smith')).toBe(true);
    expect(isIdentityConfirmation('I am John', 'John Smith')).toBe(true);
  });

  it('should NOT confirm when name doesn\'t match', () => {
    // Just saying a different name shouldn't be a confirmation
    expect(isIdentityConfirmation('no this is Sarah', 'John Smith')).toBe(false);
  });

  it('should work without expected name', () => {
    expect(isIdentityConfirmation('yes', undefined)).toBe(true);
    expect(isIdentityConfirmation('no', undefined)).toBe(false);
  });
});

describe('wantsToBook', () => {
  it('should recognize explicit booking requests', () => {
    expect(wantsToBook('I want to book an appointment')).toBe(true);
    expect(wantsToBook('can I schedule something')).toBe(true);
    expect(wantsToBook('I need an appointment')).toBe(true);
  });

  it('should recognize affirmative responses to booking question', () => {
    expect(wantsToBook('yes')).toBe(true);
    expect(wantsToBook('okay')).toBe(true);
    expect(wantsToBook('sure')).toBe(true);
    expect(wantsToBook('yeah please')).toBe(true);
  });

  it('should NOT recognize negative responses as wanting to book', () => {
    expect(wantsToBook('no')).toBe(false);
    expect(wantsToBook('not today')).toBe(false);
  });
});

describe('Word lists', () => {
  it('should have comprehensive affirmative words', () => {
    // Ensure key words are in the list
    const required = ['yes', 'ok', 'okay', 'sure', 'yep', 'yeah', 'alright'];
    required.forEach(word => {
      expect(AFFIRMATIVE_WORDS).toContain(word);
    });
  });

  it('should have comprehensive negative words', () => {
    // Ensure key words are in the list
    const required = ['no', 'nope', 'nah', 'wrong', 'cancel'];
    required.forEach(word => {
      expect(NEGATIVE_WORDS).toContain(word);
    });
  });
});
