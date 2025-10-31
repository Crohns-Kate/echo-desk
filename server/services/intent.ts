import { env } from '../utils/env';

const regex = {
  book: /\b(book|appointment|new|schedule)\b/i,
  reschedule: /\b(reschedule|change|move)\b/i,
  cancel: /\b(cancel)\b/i,
  human: /\b(reception(ist)?|human|staff|person)\b/i,
  hours: /\b(hour|open|close|time)\b/i,
};

type ConversationContext = {
  turns: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  previousIntent?: string;
  confidence?: number;
};

export async function detectIntent(
  utterance: string,
  conversationContext?: ConversationContext
): Promise<{ intent: string; confidence: number }> {
  // If OpenAI not set or intent engine disabled, use regex
  if (!env.OPENAI_API_KEY || !env.INTENT_ENGINE) {
    return detectIntentRegex(utterance);
  }

  try {
    return await detectIntentOpenAI(utterance, conversationContext);
  } catch (error) {
    console.error('[INTENT] OpenAI detection failed, falling back to regex:', error);
    return detectIntentRegex(utterance);
  }
}

function detectIntentRegex(utterance: string): { intent: string; confidence: number } {
  if (regex.book.test(utterance)) return { intent: 'book', confidence: 0.8 };
  if (regex.reschedule.test(utterance)) return { intent: 'reschedule', confidence: 0.8 };
  if (regex.cancel.test(utterance)) return { intent: 'cancel', confidence: 0.8 };
  if (regex.human.test(utterance)) return { intent: 'human', confidence: 0.7 };
  if (regex.hours.test(utterance)) return { intent: 'hours', confidence: 0.7 };
  return { intent: 'unknown', confidence: 0.3 };
}

async function detectIntentOpenAI(
  utterance: string,
  conversationContext?: ConversationContext
): Promise<{ intent: string; confidence: number }> {
  const systemPrompt = `You are an intent classifier for a medical clinic voice receptionist system.

Available intents:
- book: Patient wants to book a new appointment
- reschedule: Patient wants to reschedule an existing appointment
- cancel: Patient wants to cancel an existing appointment
- human: Patient wants to speak with a human receptionist
- hours: Patient is asking about clinic hours
- unknown: Intent is unclear or doesn't match any category

Analyze the user's utterance and return:
1. The most likely intent
2. A confidence score (0.0 to 1.0)

Consider conversation context if provided to improve accuracy.`;

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history for multi-turn refinement
  if (conversationContext?.turns && conversationContext.turns.length > 0) {
    messages.push({
      role: 'system',
      content: `Previous conversation:\n${conversationContext.turns
        .map((t) => `${t.role}: ${t.content}`)
        .join('\n')}\n\nPrevious detected intent: ${conversationContext.previousIntent || 'none'}`,
    });
  }

  messages.push({
    role: 'user',
    content: `Classify this utterance: "${utterance}"

Return a JSON object with:
{
  "intent": "book|reschedule|cancel|human|hours|unknown",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`,
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
      max_tokens: 150,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenAI response');
  }

  const result = JSON.parse(content);

  console.log('[INTENT] OpenAI detection:', {
    utterance,
    intent: result.intent,
    confidence: result.confidence,
    reasoning: result.reasoning,
  });

  return {
    intent: result.intent,
    confidence: result.confidence,
  };
}

export function buildConversationContext(
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
  previousIntent?: string,
  previousConfidence?: number
): ConversationContext {
  return {
    turns,
    previousIntent,
    confidence: previousConfidence,
  };
}
