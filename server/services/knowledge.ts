/**
 * Unified Knowledge Service
 *
 * Pulls clinic settings from the database and provides them for:
 * - Voice assistant responses (via system prompt injection)
 * - Dashboard test AI
 * - FAQ responses
 *
 * This is the SINGLE SOURCE OF TRUTH for clinic knowledge.
 */

import { storage } from '../storage';
import type { Tenant, Faq } from '@shared/schema';

export interface ClinicKnowledge {
  clinicName: string;
  address: string | null;
  phoneNumber: string | null;
  email: string | null;
  timezone: string;
  businessHours: any;
  // Knowledge base fields
  parkingText: string | null;
  servicesText: string | null;
  firstVisitText: string | null;
  aboutText: string | null;
  healthText: string | null;
  faqJson: any[];
  // Database FAQs
  faqs: Faq[];
}

// Cache knowledge to avoid hitting DB on every request
let knowledgeCache: ClinicKnowledge | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Load clinic knowledge from database
 */
export async function loadClinicKnowledge(forceRefresh = false): Promise<ClinicKnowledge | null> {
  const now = Date.now();

  // Return cached if valid
  if (!forceRefresh && knowledgeCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return knowledgeCache;
  }

  try {
    const tenant = await storage.getTenant('default');
    if (!tenant) {
      console.warn('[Knowledge] No default tenant found');
      return null;
    }

    // Load FAQs from database
    const faqs = await storage.listFaqs(tenant.id, true);

    knowledgeCache = {
      clinicName: tenant.clinicName,
      address: tenant.address,
      phoneNumber: tenant.phoneNumber,
      email: tenant.email,
      timezone: tenant.timezone,
      businessHours: tenant.businessHours,
      parkingText: (tenant as any).parkingText || null,
      servicesText: (tenant as any).servicesText || null,
      firstVisitText: (tenant as any).firstVisitText || null,
      aboutText: (tenant as any).aboutText || null,
      healthText: (tenant as any).healthText || null,
      faqJson: (tenant as any).faqJson || [],
      faqs,
    };

    cacheTimestamp = now;
    console.log('[Knowledge] Loaded clinic knowledge from database');

    return knowledgeCache;
  } catch (error) {
    console.error('[Knowledge] Failed to load clinic knowledge:', error);
    return null;
  }
}

/**
 * Clear the knowledge cache (call when settings are updated)
 */
export function clearKnowledgeCache(): void {
  knowledgeCache = null;
  cacheTimestamp = 0;
  console.log('[Knowledge] Cache cleared');
}

/**
 * Build a knowledge context string for LLM system prompts
 * This injects clinic information into the AI's context
 */
export async function buildKnowledgeContext(): Promise<string> {
  const knowledge = await loadClinicKnowledge();

  if (!knowledge) {
    return '';
  }

  const sections: string[] = [];

  // Clinic basics
  sections.push(`CLINIC NAME: ${knowledge.clinicName}`);

  if (knowledge.address) {
    sections.push(`ADDRESS: ${knowledge.address}`);
  }

  if (knowledge.phoneNumber) {
    sections.push(`PHONE: ${knowledge.phoneNumber}`);
  }

  if (knowledge.email) {
    sections.push(`EMAIL: ${knowledge.email}`);
  }

  // Business hours
  if (knowledge.businessHours && Object.keys(knowledge.businessHours).length > 0) {
    sections.push(`BUSINESS HOURS: ${JSON.stringify(knowledge.businessHours)}`);
  }

  // About / Health text
  if (knowledge.aboutText) {
    sections.push(`ABOUT THE CLINIC: ${knowledge.aboutText}`);
  }

  if (knowledge.healthText) {
    sections.push(`HEALTH SPECIALTIES: ${knowledge.healthText}`);
  }

  // Services
  if (knowledge.servicesText) {
    sections.push(`SERVICES OFFERED: ${knowledge.servicesText}`);
  }

  // Parking
  if (knowledge.parkingText) {
    sections.push(`PARKING INFORMATION: ${knowledge.parkingText}`);
  }

  // First visit
  if (knowledge.firstVisitText) {
    sections.push(`FIRST VISIT INFORMATION: ${knowledge.firstVisitText}`);
  }

  // Database FAQs
  if (knowledge.faqs.length > 0) {
    const faqText = knowledge.faqs.map(faq =>
      `Q: ${faq.question}\nA: ${faq.answer}`
    ).join('\n\n');
    sections.push(`FREQUENTLY ASKED QUESTIONS:\n${faqText}`);
  }

  return sections.join('\n\n');
}

/**
 * Build system prompt instructions for the voice assistant
 * This tells the AI how to use the knowledge base
 */
export function buildKnowledgeInstructions(): string {
  return `
IMPORTANT: You have access to the clinic's knowledge base above. When callers ask questions about:
- Address or location: Use the ADDRESS information
- Parking: Use the PARKING INFORMATION
- Business hours or when you're open/close: Use the BUSINESS HOURS
- Services offered: Use the SERVICES OFFERED
- What to expect on first visit: Use the FIRST VISIT INFORMATION
- General questions about the clinic: Use the ABOUT THE CLINIC section
- Specific FAQs: Check the FREQUENTLY ASKED QUESTIONS section

ALWAYS answer using the knowledge base when possible. Do NOT make up information that isn't in the knowledge base.
If you cannot find the answer in the knowledge base, politely say you'll transfer them to reception.
`.trim();
}

/**
 * Get a direct answer for a specific query from the knowledge base
 * Returns null if no answer found
 */
export async function getDirectAnswer(query: string): Promise<string | null> {
  const knowledge = await loadClinicKnowledge();
  if (!knowledge) return null;

  const text = query.toLowerCase();

  // Address / Location
  if (text.includes('address') || text.includes('location') || text.includes('where are you')) {
    if (knowledge.address) {
      return `Our address is ${knowledge.address}.`;
    }
  }

  // Parking
  if (text.includes('parking') || text.includes('park')) {
    if (knowledge.parkingText) {
      return knowledge.parkingText;
    }
  }

  // Hours
  if (text.includes('hour') || text.includes('open') || text.includes('close') || text.includes('time')) {
    if (knowledge.businessHours && Object.keys(knowledge.businessHours).length > 0) {
      // Format business hours for speech
      const hours = knowledge.businessHours;
      if (typeof hours === 'string') return hours;
      // Handle JSON object format
      return `We're open during our regular business hours. For specific times, please check our website or I can transfer you to reception.`;
    }
  }

  // Services
  if (text.includes('service') || text.includes('offer') || text.includes('do you do')) {
    if (knowledge.servicesText) {
      return knowledge.servicesText;
    }
  }

  // First visit
  if (text.includes('first visit') || text.includes('first time') || text.includes('first appointment') ||
      text.includes('what to expect') || text.includes('what should i bring') || text.includes('what to bring')) {
    if (knowledge.firstVisitText) {
      return knowledge.firstVisitText;
    }
  }

  // Search database FAQs
  const matchingFaq = await searchFaqs(query, knowledge);
  if (matchingFaq) {
    return matchingFaq;
  }

  return null;
}

/**
 * Search FAQs for a matching answer
 */
async function searchFaqs(query: string, knowledge: ClinicKnowledge): Promise<string | null> {
  const text = query.toLowerCase();

  for (const faq of knowledge.faqs) {
    // Check if query matches FAQ question or keywords
    const questionLower = faq.question.toLowerCase();
    if (questionLower.includes(text) || text.includes(questionLower.substring(0, 20))) {
      return faq.answer;
    }

    // Check keywords
    if (faq.keywords && faq.keywords.length > 0) {
      for (const keyword of faq.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          return faq.answer;
        }
      }
    }
  }

  return null;
}
