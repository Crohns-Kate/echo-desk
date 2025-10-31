import { env } from '../utils/env';

const regex = {
  book: /\b(book|appointment|new|schedule)\b/i,
  reschedule: /\b(reschedule|change|move)\b/i,
  cancel: /\b(cancel)\b/i,
  human: /\b(reception(ist)?|human|staff|person)\b/i,
  hours: /\b(hour|open|close|time)\b/i,
};

export async function detectIntent(utterance: string): Promise<{intent: string, confidence: number}> {
  // If OpenAI not set or intent engine disabled, use regex
  if (!env.OPENAI_API_KEY || !env.INTENT_ENGINE) {
    if (regex.book.test(utterance)) return { intent: 'book', confidence: 0.8 };
    if (regex.reschedule.test(utterance)) return { intent: 'reschedule', confidence: 0.8 };
    if (regex.cancel.test(utterance)) return { intent: 'cancel', confidence: 0.8 };
    if (regex.human.test(utterance)) return { intent: 'human', confidence: 0.7 };
    if (regex.hours.test(utterance)) return { intent: 'hours', confidence: 0.7 };
    return { intent: 'unknown', confidence: 0.3 };
  }
  
  // TODO: OpenAI GPT-4o-mini call here if desired
  return { intent: 'unknown', confidence: 0.3 };
}
