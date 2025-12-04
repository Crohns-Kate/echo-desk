/**
 * FAQ Service - Retrieval and knowledge base management
 */

import { storage } from "../storage";
import type { Faq, Tenant, InsertFaq } from "@shared/schema";
import { quickComplete, isLLMAvailable } from "../ai/llmProvider";

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
    { keywords: ['how long', 'duration', 'length of', 'appointment take'], category: 'duration' },
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

/**
 * Generate FAQs from tenant knowledge base using AI
 * Returns array of FAQ suggestions that can be reviewed and saved
 */
export async function generateFaqsFromKnowledge(tenant: Tenant): Promise<InsertFaq[]> {
  if (!isLLMAvailable()) {
    throw new Error('AI service not available. Please configure OPENAI_API_KEY or ANTHROPIC_API_KEY.');
  }

  // Build context from tenant knowledge
  const knowledgeContext = [
    tenant.clinicName ? `Clinic Name: ${tenant.clinicName}` : '',
    tenant.address ? `Address: ${tenant.address}` : '',
    tenant.email ? `Email: ${tenant.email}` : '',
    tenant.phoneNumber ? `Phone: ${tenant.phoneNumber}` : '',
    tenant.parkingText ? `Parking Information: ${tenant.parkingText}` : '',
    tenant.servicesText ? `Services: ${tenant.servicesText}` : '',
    tenant.firstVisitText ? `First Visit Information: ${tenant.firstVisitText}` : '',
    tenant.aboutText ? `About: ${tenant.aboutText}` : '',
    tenant.healthText ? `Health Information: ${tenant.healthText}` : '',
  ].filter(Boolean).join('\n\n');

  if (!knowledgeContext.trim()) {
    throw new Error('No knowledge base information available. Please add clinic details first.');
  }

  // Business hours if available
  let hoursText = '';
  if (tenant.businessHours && typeof tenant.businessHours === 'object') {
    const hours = tenant.businessHours as any;
    if (hours.monday || hours.tuesday) {
      hoursText = '\n\nBusiness Hours:\n' + Object.entries(hours)
        .filter(([_, val]) => val)
        .map(([day, val]: [string, any]) => `${day}: ${val.open || ''} - ${val.close || ''}`)
        .join('\n');
    }
  }

  const systemPrompt = `You are an expert FAQ generator for medical/clinic phone systems. Generate clear, concise FAQs that will be spoken over the phone.

Guidelines:
- Write answers in a conversational, natural tone suitable for text-to-speech
- Keep answers brief (1-3 sentences max)
- Avoid jargon and complex medical terms
- Don't include URLs, email addresses, or phone numbers (they'll be replaced with "our website" / "email us" / "call us")
- Focus on common patient questions about hours, location, parking, services, first visits, billing, etc.

Output format (JSON array):
[
  {
    "category": "hours|location|parking|billing|services|preparation|cancellation|first-visit|general",
    "question": "What are your opening hours?",
    "answer": "We're open Monday to Friday from 9am to 5pm.",
    "keywords": ["hours", "open", "time", "schedule"]
  }
]`;

  const userPrompt = `Based on the following clinic information, generate 5-8 relevant FAQs:

${knowledgeContext}${hoursText}

Generate FAQs as a JSON array. Only output valid JSON, no markdown formatting.`;

  try {
    const response = await quickComplete(userPrompt, systemPrompt, {
      temperature: 0.7,
      maxTokens: 2000
    });

    // Parse the JSON response
    let jsonStr = response.trim();

    // Remove markdown code fences if present
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');

    const generatedFaqs = JSON.parse(jsonStr);

    if (!Array.isArray(generatedFaqs)) {
      throw new Error('Invalid response format: expected array of FAQs');
    }

    // Convert to InsertFaq format
    return generatedFaqs.map((faq: any) => ({
      tenantId: tenant.id,
      category: faq.category || 'general',
      question: faq.question || '',
      answer: faq.answer || '',
      keywords: Array.isArray(faq.keywords) ? faq.keywords : [],
      priority: 0,
      isActive: true,
    }));
  } catch (error) {
    console.error('[generateFaqsFromKnowledge] Error:', error);
    throw new Error(`Failed to generate FAQs: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
