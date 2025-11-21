/**
 * FAQ Service - Retrieval and knowledge base management
 */

import { storage } from "../storage";
import type { Faq } from "@shared/schema";

/**
 * Search FAQs by natural language query
 * Returns ranked results based on keyword matching and relevance
 */
export async function searchFaqByQuery(query: string, tenantId?: number): Promise<Faq | null> {
  const results = await storage.searchFaqs(query, tenantId);

  // Return the top result (highest score)
  if (results.length > 0) {
    return results[0];
  }

  return null;
}

/**
 * Get all FAQs for a tenant
 */
export async function getAllFaqs(tenantId?: number): Promise<Faq[]> {
  return storage.listFaqs(tenantId, true);
}

/**
 * Detect if a query is asking an FAQ-type question
 * Returns the question category if detected, or null
 */
export function detectFaqIntent(speechInput: string): string | null {
  const input = speechInput.toLowerCase().trim();

  // Common FAQ trigger phrases
  const faqTriggers = [
    { keywords: ['hours', 'open', 'close', 'when are you'], category: 'hours' },
    { keywords: ['where', 'location', 'address', 'directions'], category: 'location' },
    { keywords: ['parking', 'park'], category: 'parking' },
    { keywords: ['cost', 'price', 'how much', 'payment', 'insurance'], category: 'billing' },
    { keywords: ['what do you', 'what kind', 'treatment', 'services'], category: 'services' },
    { keywords: ['bring', 'what should i', 'prepare'], category: 'preparation' },
    { keywords: ['cancel', 'cancellation', 'policy'], category: 'cancellation' },
    { keywords: ['first visit', 'new patient', 'first time'], category: 'first-visit' },
  ];

  for (const trigger of faqTriggers) {
    for (const keyword of trigger.keywords) {
      if (input.includes(keyword)) {
        return trigger.category;
      }
    }
  }

  return null;
}

/**
 * Format FAQ answer for TTS speech output
 */
export function formatFaqAnswerForSpeech(answer: string): string {
  // Clean up for natural speech
  let cleaned = answer.trim();

  // Remove URLs (they don't speak well)
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, 'our website');

  // Remove emails (they don't speak well)
  cleaned = cleaned.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, 'email us');

  // Convert bullet points to natural pauses
  cleaned = cleaned.replace(/[•\-*]\s*/g, '. ');

  // Ensure it ends with a period for natural pause
  if (!cleaned.match(/[.!?]$/)) {
    cleaned += '.';
  }

  return cleaned;
}
