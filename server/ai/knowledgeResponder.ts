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
  console.log(`[KnowledgeResponder] Loading knowledge base for clinicId: ${clinicId}`);

  // Check cache first
  const cached = knowledgeCache.get(clinicId);
  if (cached) {
    console.log(`[KnowledgeResponder] Using cached knowledge base (${cached.length} chars)`);
    return cached;
  }

  // Try to load from file
  const filePath = join(process.cwd(), 'knowledgebase', `${clinicId}.md`);
  console.log(`[KnowledgeResponder] Checking file: ${filePath}`);

  if (!existsSync(filePath)) {
    console.log(`[KnowledgeResponder] File not found: ${filePath}`);
    // Try default
    const defaultPath = join(process.cwd(), 'knowledgebase', 'default.md');
    console.log(`[KnowledgeResponder] Trying default: ${defaultPath}`);
    if (existsSync(defaultPath)) {
      const content = readFileSync(defaultPath, 'utf-8');
      console.log(`[KnowledgeResponder] ✅ Loaded default knowledge base (${content.length} chars)`);
      knowledgeCache.set(clinicId, content);
      return content;
    }
    console.log(`[KnowledgeResponder] ❌ No knowledge base file found`);
    return null;
  }

  const content = readFileSync(filePath, 'utf-8');
  console.log(`[KnowledgeResponder] ✅ Loaded knowledge base file (${content.length} chars)`);
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
  let { tenantId, clinicId = 'default', clinicName = 'the clinic' } = options;

  // If we have tenantId, try to get the clinicId (slug) from the tenant
  if (tenantId && clinicId === 'default') {
    try {
      const tenant = await storage.getTenantById(tenantId);
      if (tenant) {
        clinicId = tenant.slug;
        clinicName = tenant.clinicName || clinicName;
        console.log(`[KnowledgeResponder] Using tenant: ${clinicId} (${clinicName})`);
      }
    } catch (err) {
      console.error('[KnowledgeResponder] Error loading tenant:', err);
    }
  }

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
  console.log(`[KnowledgeResponder] Knowledge base loaded: ${knowledgeBase ? 'YES' : 'NO'}`);
  console.log(`[KnowledgeResponder] LLM available: ${isLLMAvailable() ? 'YES' : 'NO'}`);

  if (knowledgeBase && isLLMAvailable()) {
    try {
      console.log(`[KnowledgeResponder] Using LLM with knowledge base for: ${query}`);
      let answer = await generateLLMResponse(query, knowledgeBase, clinicName);
      console.log(`[KnowledgeResponder] LLM generated response (${answer.length} chars)`);

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
    } catch (error: any) {
      console.error('[KnowledgeResponder] LLM generation failed:', error.message);
      console.error('[KnowledgeResponder] Error details:', error);
    }
  } else if (knowledgeBase && !isLLMAvailable()) {
    console.warn('[KnowledgeResponder] Knowledge base exists but LLM not available - falling back to keywords');
  } else if (!knowledgeBase && isLLMAvailable()) {
    console.warn('[KnowledgeResponder] LLM available but no knowledge base file found');
  }

  // 3. Keyword-based fallback
  console.log('[KnowledgeResponder] Trying keyword-based fallback for query:', query);
  console.log('[KnowledgeResponder] Query lowercased:', query.toLowerCase());
  const fallbackAnswer = getKeywordFallback(query);
  console.log('[KnowledgeResponder] Keyword fallback result:', fallbackAnswer ? `Found (${fallbackAnswer.substring(0, 50)}...)` : 'null');
  if (fallbackAnswer) {
    console.log('[KnowledgeResponder] ✅ Found keyword fallback answer');
    return {
      answer: fallbackAnswer,
      source: 'fallback'
    };
  }

  // 4. Ultimate fallback
  console.log('[KnowledgeResponder] ❌ No answer found - using ultimate fallback');
  return {
    answer: "I don't have that information right now, but I'll flag it with the team and they'll get back to you. Is there anything else I can help with?",
    source: 'fallback'
  };
}

/**
 * Keyword-based fallback responses
 */
function getKeywordFallback(query: string): string | null {
  const text = query.toLowerCase();
  console.log('[getKeywordFallback] Checking keywords for:', text);

  // Hours
  if (text.includes('hour') || text.includes('open') || text.includes('close') || text.includes('business hour')) {
    return "We're open Monday to Friday, 8am to 6pm, and Saturday mornings. Closed Sundays and public holidays.";
  }

  // Location
  if (text.includes('where') || text.includes('address') || text.includes('location')) {
    console.log('[getKeywordFallback] ✅ Matched location keywords');
    return "We're on Market Street in Southport, near the tram line. Parking is right out the front.";
  }

  // Parking
  if (text.includes('parking') || text.includes('park')) {
    return "Yes, free parking out the front.";
  }

  // First visit
  if (text.includes('first visit') || text.includes('first time') || text.includes('what to expect')) {
    return "Just yourself. Arrive five minutes early if you can.";
  }

  // What to bring
  if (text.includes('what should i bring') || text.includes('what to bring') || text.includes('do i need to bring')) {
    return "Just yourself. Arrive five minutes early if you can.";
  }

  // How often / frequency
  if (text.includes('how often') || text.includes('how many times') || text.includes('frequency')) {
    return "That depends on what the doctor finds, and you'll go through that on your first visit.";
  }

  // Techniques / what do you do / methods
  if (text.includes('technique') || text.includes('method') || text.includes('how do you treat') || text.includes('what do you do') || text.includes('what do they do') || text.includes('what does he do')) {
    console.log('[getKeywordFallback] ✅ Matched techniques keywords');
    return "We use chiropractic adjustments, posture and nerve assessment, and create treatment plans tailored to your needs.";
  }

  // Who is the practitioner / doctor
  if (text.includes('who is the') || text.includes('which doctor') || text.includes('who will i see') || text.includes('practitioner')) {
    return "You'll be seeing Dr. Michael.";
  }

  // Prices/cost
  if (text.includes('cost') || text.includes('price') || text.includes('how much') || text.includes('fee')) {
    console.log('[getKeywordFallback] ✅ Matched price/cost keywords');
    return "A first visit is $110, and follow-up visits are $70.";
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
