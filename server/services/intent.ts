import { env } from '../utils/env';

export interface IntentResult {
  action: 'book' | 'reschedule' | 'cancel' | 'operator' | 'unknown';
  day?: string;
  part?: 'morning' | 'afternoon';
  confidence?: number;
}

/**
 * Classify caller intent using LLM (OpenAI/Anthropic) with fallback to keyword matching
 */
export async function classifyIntent(utterance: string): Promise<IntentResult> {
  const text = utterance.toLowerCase().trim();

  // Try LLM classification if API key available
  if (env.OPENAI_API_KEY) {
    try {
      const result = await classifyWithLLM(text);
      if (result.confidence && result.confidence > 0.7) {
        return result;
      }
    } catch (e) {
      console.warn('[Intent] LLM classification failed, using fallback:', e);
    }
  }

  // Fallback to keyword matching
  return classifyWithKeywords(text);
}

async function classifyWithLLM(text: string): Promise<IntentResult> {
  const { OPENAI_API_KEY, OPENAI_BASE_URL } = env;

  const prompt = `Classify the caller's intent from their utterance. Return ONLY a JSON object with this schema:
{
  "action": "book" | "reschedule" | "cancel" | "operator" | "unknown",
  "day": string (optional - e.g., "monday", "tomorrow", "today"),
  "part": "morning" | "afternoon" (optional),
  "confidence": number (0-1)
}

Utterance: "${text}"

JSON:`;

  const baseUrl = OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 100
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in LLM response');
  }

  const result = JSON.parse(jsonMatch[0]);
  return {
    action: result.action || 'unknown',
    day: result.day,
    part: result.part,
    confidence: result.confidence || 0.8
  };
}

function classifyWithKeywords(text: string): IntentResult {
  let action: IntentResult['action'] = 'unknown';
  let day: string | undefined;
  let part: 'morning' | 'afternoon' | undefined;

  // Action detection
  if (text.includes('book') || text.includes('appointment') || text.includes('schedule')) {
    action = 'book';
  } else if (text.includes('reschedule') || text.includes('change') || text.includes('move')) {
    action = 'reschedule';
  } else if (text.includes('cancel')) {
    action = 'cancel';
  } else if (text.includes('speak') || text.includes('operator') || text.includes('human') || text.includes('person')) {
    action = 'operator';
  }

  // Day detection
  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const foundDay = weekdays.find(d => text.includes(d));
  if (foundDay) {
    day = foundDay;
  } else if (text.includes('tomorrow')) {
    day = 'tomorrow';
  } else if (text.includes('today')) {
    day = 'today';
  }

  // Part of day detection
  if (text.includes('morning') || text.includes('early')) {
    part = 'morning';
  } else if (text.includes('afternoon') || text.includes('late')) {
    part = 'afternoon';
  }

  return { action, day, part, confidence: 0.6 };
}
