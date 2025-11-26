import { env } from '../utils/env';

export interface IntentResult {
  action: 'book' | 'reschedule' | 'cancel' | 'operator' | 'info' | 'fees' | 'faq_parking' | 'faq_hours' | 'faq_location' | 'faq_services' | 'faq_techniques' | 'faq_practitioner' | 'unknown';
  day?: string;
  part?: 'morning' | 'afternoon';
  confidence?: number;
}

/**
 * Classify caller intent using keywords first (fast), then LLM for unclear cases
 */
export async function classifyIntent(utterance: string): Promise<IntentResult> {
  const text = utterance.toLowerCase().trim();

  // Try keyword matching first (instant, no API call)
  const keywordResult = classifyWithKeywords(text);

  // If we got a clear match (not 'unknown'), use it immediately
  if (keywordResult.action !== 'unknown') {
    console.log(`[Intent] ✅ Fast keyword match: ${keywordResult.action}`);
    return keywordResult;
  }

  // Only use LLM for unclear utterances
  if (env.OPENAI_API_KEY) {
    console.log('[Intent] Unclear utterance, trying LLM classification...');
    try {
      const result = await classifyWithLLM(text);
      if (result.confidence && result.confidence > 0.7) {
        return result;
      }
    } catch (e) {
      console.warn('[Intent] LLM classification failed:', e);
    }
  }

  // Return 'unknown' if nothing worked
  return keywordResult;
}

async function classifyWithLLM(text: string): Promise<IntentResult> {
  const { OPENAI_API_KEY, OPENAI_BASE_URL } = env;

  const prompt = `Classify the caller's intent from their utterance. Return ONLY a JSON object with this schema:
{
  "action": "book" | "reschedule" | "cancel" | "operator" | "info" | "fees" | "faq_parking" | "faq_hours" | "faq_location" | "faq_services" | "faq_techniques" | "faq_practitioner" | "unknown",
  "day": string (optional - e.g., "monday", "tomorrow", "today"),
  "part": "morning" | "afternoon" (optional),
  "confidence": number (0-1)
}

Actions:
- "info": Asking what happens in a first visit, what to expect, what they get, what to bring
- "fees": Asking about cost, price, how much, fees
- "faq_parking": Asking about parking, where to park
- "faq_hours": Asking about opening hours, when open, when closed, what time
- "faq_location": Asking about address, location, where you are, directions
- "faq_services": Asking about services offered, what treatments, what you do
- "faq_techniques": Asking about techniques, methods, how you treat
- "faq_practitioner": Asking who the doctor is, who will see them, who will treat them
- "book": Wants to book an appointment
- "reschedule": Wants to change an existing appointment
- "cancel": Wants to cancel an appointment
- "operator": Wants to speak to a person
- "unknown": None of the above

Utterance: "${text}"

JSON:`;

  const baseUrl = OPENAI_BASE_URL || 'https://api.openai.com/v1';

  // Add 3-second timeout to prevent hanging
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2, // Lower = faster, more deterministic
        max_tokens: 80 // Reduced for faster response
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

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
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error('LLM request timeout after 3 seconds');
    }
    throw error;
  }
}

function classifyWithKeywords(text: string): IntentResult {
  let action: IntentResult['action'] = 'unknown';
  let day: string | undefined;
  let part: 'morning' | 'afternoon' | undefined;

  // Action detection (order matters - check specific intents before general ones)
  if (
    text.includes('how much') ||
    text.includes('what does it cost') ||
    text.includes('cost') ||
    text.includes('price') ||
    text.includes('fee') ||
    text.includes('pay') ||
    text.includes('charge')
  ) {
    action = 'fees';
  } else if (
    text.includes('parking') ||
    text.includes('where to park') ||
    text.includes('where do i park')
  ) {
    action = 'faq_parking';
  } else if (
    text.includes('hour') ||
    text.includes('when are you open') ||
    text.includes('what time do you open') ||
    text.includes('what time do you close') ||
    text.includes('when do you close') ||
    text.includes('open until') ||
    text.includes('closing time')
  ) {
    action = 'faq_hours';
  } else if (
    text.includes('where are you') ||
    text.includes('address') ||
    text.includes('location') ||
    text.includes('directions') ||
    text.includes('how do i get there') ||
    text.includes('where is your')
  ) {
    action = 'faq_location';
  } else if (
    text.includes('what services') ||
    text.includes('what treatments') ||
    text.includes('what do you offer') ||
    text.includes('services offered')
  ) {
    action = 'faq_services';
  } else if (
    text.includes('technique') ||
    text.includes('method') ||
    text.includes('how do you treat')
  ) {
    action = 'faq_techniques';
  } else if (
    text.includes('who is the') ||
    text.includes('which doctor') ||
    text.includes('who will') ||
    text.includes('who am i') ||
    text.includes('who be') ||
    text.includes('practitioner') ||
    text.includes('treating me') ||
    text.includes('seeing')
  ) {
    action = 'faq_practitioner';
  } else if (
    text.includes('what happens') ||
    text.includes('what do i get') ||
    text.includes('what to expect') ||
    text.includes('first visit') ||
    text.includes('first appointment') ||
    text.includes('what will happen') ||
    text.includes('what should i bring') ||
    text.includes('what to bring')
  ) {
    action = 'info';
  } else if (text.includes('book') || text.includes('appointment') || text.includes('schedule')) {
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
