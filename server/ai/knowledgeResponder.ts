/**
 * Knowledge Responder - Handles FAQ and knowledge base queries
 * Fetches clinic-specific information and generates natural voice responses
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { complete, isLLMAvailable, type LLMMessage } from './llmProvider';
import { storage } from '../storage';
import { checkResponseLength, validateResponse } from './safetyGuardrails';
import type { Faq } from '@shared/schema';

// Default knowledge categories
export type KnowledgeCategory =
  | 'hours'
  | 'location'
  | 'parking'
  | 'prices'
  | 'first_visit'
  | 'services'
  | 'insurance'
  | 'cancellation'
  | 'general';

interface KnowledgeEntry {
  category: KnowledgeCategory;
  question: string;
  answer: string;
  keywords: string[];
}

// Cache for loaded knowledge bases
const knowledgeCache = new Map<string, string>();

/**
 * Load knowledge base file for a clinic
 */
function loadKnowledgeBase(clinicId: string): string | null {
  // Check cache first
  const cached = knowledgeCache.get(clinicId);
  if (cached) return cached;

  // Try to load from file
  const filePath = join(process.cwd(), 'knowledgebase', `${clinicId}.md`);

  if (!existsSync(filePath)) {
    // Try default
    const defaultPath = join(process.cwd(), 'knowledgebase', 'default.md');
    if (existsSync(defaultPath)) {
      const content = readFileSync(defaultPath, 'utf-8');
      knowledgeCache.set(clinicId, content);
      return content;
    }
    return null;
  }

  const content = readFileSync(filePath, 'utf-8');
  knowledgeCache.set(clinicId, content);
  return content;
}

/**
 * Search database FAQs
 */
async function searchDatabaseFaqs(query: string, tenantId?: number): Promise<Faq | null> {
  try {
    const results = await storage.searchFaqs(query, tenantId);
    return results.length > 0 ? results[0] : null;
  } catch (error) {
    console.error('[KnowledgeResponder] FAQ search error:', error);
    return null;
  }
}

/**
 * Generate response using LLM with knowledge context
 */
async function generateLLMResponse(
  query: string,
  knowledgeContext: string,
  clinicName: string
): Promise<string> {
  const systemPrompt = `You are a friendly voice assistant for ${clinicName}, a chiropractic clinic.
Answer the caller's question using ONLY the information provided in the knowledge base below.
Keep your response SHORT (under 30 seconds of speech, about 50-70 words).
Use natural, conversational language suitable for voice.
Do not make up information not in the knowledge base.
If you can't answer from the knowledge base, say you'll transfer to reception.

KNOWLEDGE BASE:
${knowledgeContext}`;

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Caller asks: "${query}"` }
  ];

  const response = await complete(messages, {
    temperature: 0.4,
    maxTokens: 200
  });

  return response.content;
}

/**
 * Format FAQ answer for voice output
 */
function formatForVoice(answer: string): string {
  let formatted = answer.trim();

  // Remove URLs (don't speak well)
  formatted = formatted.replace(/https?:\/\/[^\s]+/g, 'our website');

  // Remove email addresses
  formatted = formatted.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, 'email us');

  // Convert bullet points to natural pauses
  formatted = formatted.replace(/[•\-*]\s*/g, '. ');

  // Remove markdown
  formatted = formatted.replace(/\*\*/g, '');
  formatted = formatted.replace(/\*/g, '');
  formatted = formatted.replace(/#+ /g, '');

  // Ensure ends with period
  if (!formatted.match(/[.!?]$/)) {
    formatted += '.';
  }

  return formatted;
}

/**
 * Main function to respond to knowledge queries
 */
export async function respondToQuery(
  query: string,
  options: {
    tenantId?: number;
    clinicId?: string;
    clinicName?: string;
    category?: KnowledgeCategory;
  } = {}
): Promise<{ answer: string; source: 'database' | 'file' | 'llm' | 'fallback'; category?: string }> {
  const { tenantId, clinicId = 'default', clinicName = 'the clinic' } = options;

  // 1. Try database FAQs first (most specific)
  const dbFaq = await searchDatabaseFaqs(query, tenantId);
  if (dbFaq) {
    console.log(`[KnowledgeResponder] Found database FAQ: ${dbFaq.question}`);
    const answer = formatForVoice(dbFaq.answer);
    const lengthCheck = checkResponseLength(answer);

    return {
      answer: lengthCheck.ok ? answer : (lengthCheck.truncated || answer),
      source: 'database',
      category: dbFaq.category
    };
  }

  // 2. Try knowledge base file with LLM
  const knowledgeBase = loadKnowledgeBase(clinicId);
  if (knowledgeBase && isLLMAvailable()) {
    try {
      console.log(`[KnowledgeResponder] Using LLM with knowledge base for: ${query}`);
      let answer = await generateLLMResponse(query, knowledgeBase, clinicName);

      // Validate response
      const validation = validateResponse(answer);
      if (!validation.valid) {
        console.warn(`[KnowledgeResponder] Response validation failed: ${validation.reason}`);
        answer = validation.sanitized;
      }

      // Check length
      const lengthCheck = checkResponseLength(answer);
      answer = lengthCheck.ok ? answer : (lengthCheck.truncated || answer);

      return {
        answer: formatForVoice(answer),
        source: 'llm'
      };
    } catch (error) {
      console.error('[KnowledgeResponder] LLM generation failed:', error);
    }
  }

  // 3. Keyword-based fallback
  const fallbackAnswer = getKeywordFallback(query);
  if (fallbackAnswer) {
    return {
      answer: fallbackAnswer,
      source: 'fallback'
    };
  }

  // 4. Ultimate fallback
  return {
    answer: "I don't have that specific information, but our reception team can help you with that. Would you like me to book an appointment, or is there something else I can help with?",
    source: 'fallback'
  };
}

/**
 * Keyword-based fallback responses
 */
function getKeywordFallback(query: string): string | null {
  const text = query.toLowerCase();

  // Hours
  if (text.includes('hour') || text.includes('open') || text.includes('close')) {
    return "We're generally open Monday to Friday, 8am to 6pm, and Saturday mornings. For exact hours, I can transfer you to reception.";
  }

  // Location
  if (text.includes('where') || text.includes('address') || text.includes('location')) {
    return "Our address is listed on your confirmation email and our website. There's parking available nearby. Would you like me to book you an appointment?";
  }

  // Parking
  if (text.includes('parking') || text.includes('park')) {
    return "We have parking available. Street parking is also usually available. The exact details will be in your confirmation email.";
  }

  // First visit
  if (text.includes('first visit') || text.includes('first time') || text.includes('what to expect')) {
    return "For your first visit, please arrive about 10 minutes early to complete paperwork. The initial consultation takes about 45 minutes and includes a full assessment. Wear comfortable clothing.";
  }

  // Prices/cost
  if (text.includes('cost') || text.includes('price') || text.includes('how much') || text.includes('fee')) {
    return "Our initial consultation is typically around $80 to $120, and follow-up visits are less. We offer HICAPS for instant health fund claims. Would you like to book an appointment?";
  }

  // Insurance
  if (text.includes('insurance') || text.includes('health fund') || text.includes('medicare') || text.includes('rebate')) {
    return "We offer HICAPS for instant health fund rebates. Most major health funds are accepted. Medicare doesn't cover chiropractic, but some DVA and WorkCover claims may apply.";
  }

  // Cancellation
  if (text.includes('cancel') && text.includes('policy')) {
    return "We appreciate at least 24 hours notice for cancellations. Late cancellations or no-shows may incur a fee. Can I help you reschedule instead?";
  }

  return null;
}

/**
 * Get a quick response for common categories without LLM
 */
export function getQuickResponse(category: KnowledgeCategory, clinicName: string = 'the clinic'): string {
  const responses: Record<KnowledgeCategory, string> = {
    hours: "We're open Monday to Friday, 8am to 6pm, and Saturday mornings from 8am to 12pm.",
    location: "You can find our address on your confirmation email. There's parking available on site.",
    parking: "We have free parking available for patients. Street parking is also usually available nearby.",
    prices: "Our initial consultation is around $80 to $120, with follow-ups being less. We offer HICAPS for instant health fund claims.",
    first_visit: "For your first visit, arrive 10 minutes early. Wear comfortable clothing. The initial consultation takes about 45 minutes.",
    services: "We offer chiropractic adjustments, soft tissue therapy, rehabilitation exercises, and posture assessments.",
    insurance: "We accept all major health funds with HICAPS for instant rebates. Medicare doesn't cover chiropractic services.",
    cancellation: "Please give us 24 hours notice if you need to cancel or reschedule your appointment.",
    general: `Thanks for calling ${clinicName}. How can I help you today?`
  };

  return responses[category];
}

/**
 * Clear knowledge cache (useful when files are updated)
 */
export function clearKnowledgeCache(): void {
  knowledgeCache.clear();
  console.log('[KnowledgeResponder] Cache cleared');
}
