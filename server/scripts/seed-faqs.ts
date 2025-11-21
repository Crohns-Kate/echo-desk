/**
 * Seed script to populate FAQ knowledge base with common questions
 * Run with: node --import tsx server/scripts/seed-faqs.ts
 */

import { storage } from "../storage";

async function seedFaqs() {
  console.log('[FAQ Seed] Starting FAQ knowledge base seeding...');

  // Get default tenant
  const tenant = await storage.getTenant('default');
  if (!tenant) {
    console.error('[FAQ Seed] Default tenant not found. Run seed first.');
    process.exit(1);
  }

  const faqs = [
    // Hours of Operation
    {
      tenantId: tenant.id,
      category: 'hours',
      question: 'What are your hours of operation?',
      answer: 'We are open Monday to Friday from 9:00 AM to 6:00 PM, and Saturday from 9:00 AM to 1:00 PM. We are closed on Sundays and public holidays.',
      keywords: ['hours', 'open', 'close', 'when', 'time', 'opening hours'],
      priority: 10,
      isActive: true,
    },

    // Location
    {
      tenantId: tenant.id,
      category: 'location',
      question: 'Where are you located?',
      answer: 'We are located at 123 Main Street, Brisbane City, Queensland 4000. We are in the heart of the CBD, easily accessible by public transport.',
      keywords: ['where', 'location', 'address', 'directions', 'find you'],
      priority: 10,
      isActive: true,
    },

    // Parking
    {
      tenantId: tenant.id,
      category: 'parking',
      question: 'Is parking available?',
      answer: 'Yes, there is street parking available on Main Street with a 2-hour limit. There is also a secure underground car park located at 150 Main Street, just 50 meters from our clinic.',
      keywords: ['parking', 'park', 'car', 'vehicle'],
      priority: 8,
      isActive: true,
    },

    // Cost and Billing
    {
      tenantId: tenant.id,
      category: 'billing',
      question: 'How much does a consultation cost?',
      answer: 'A standard consultation is $85, and a new patient consultation is $120. We accept private health insurance, Medicare, and all major credit cards. HICAPS claiming is available for immediate rebates.',
      keywords: ['cost', 'price', 'how much', 'payment', 'insurance', 'billing', 'fees'],
      priority: 9,
      isActive: true,
    },

    // Services
    {
      tenantId: tenant.id,
      category: 'services',
      question: 'What services do you offer?',
      answer: 'We specialize in chiropractic care including spinal adjustments, sports injuries, workplace injury rehabilitation, posture correction, and wellness care. We also offer massage therapy and exercise prescription.',
      keywords: ['services', 'treatment', 'what do you do', 'specialize', 'offer'],
      priority: 8,
      isActive: true,
    },

    // What to Bring
    {
      tenantId: tenant.id,
      category: 'preparation',
      question: 'What should I bring to my first appointment?',
      answer: 'Please bring your Medicare card, private health insurance card if applicable, and any relevant medical reports or x-rays. Wear comfortable clothing that allows for movement.',
      keywords: ['bring', 'what should i', 'prepare', 'first visit', 'first appointment'],
      priority: 7,
      isActive: true,
    },

    // Cancellation Policy
    {
      tenantId: tenant.id,
      category: 'cancellation',
      question: 'What is your cancellation policy?',
      answer: 'We require at least 24 hours notice for cancellations. Cancellations made with less than 24 hours notice may incur a $40 late cancellation fee. You can cancel by calling us or replying to your appointment confirmation SMS.',
      keywords: ['cancel', 'cancellation', 'policy', 'notice'],
      priority: 7,
      isActive: true,
    },

    // New Patient Process
    {
      tenantId: tenant.id,
      category: 'first-visit',
      question: 'What happens at my first visit?',
      answer: 'Your first visit includes a comprehensive health history, physical examination, posture and movement assessment, and your first treatment if appropriate. The initial consultation takes about 45 minutes.',
      keywords: ['first visit', 'new patient', 'first time', 'initial', 'what happens'],
      priority: 8,
      isActive: true,
    },

    // Emergency/Urgent Care
    {
      tenantId: tenant.id,
      category: 'urgent',
      question: 'Do you see emergency or urgent cases?',
      answer: 'We can often accommodate same-day appointments for urgent cases like acute back pain or sports injuries. Please call us immediately and we will do our best to see you as soon as possible.',
      keywords: ['emergency', 'urgent', 'same day', 'acute', 'pain'],
      priority: 9,
      isActive: true,
    },

    // Online Booking
    {
      tenantId: tenant.id,
      category: 'booking',
      question: 'Can I book online?',
      answer: 'Yes! You can book online through our website, or you can call us at any time and our AI receptionist will help you find the perfect appointment time.',
      keywords: ['book', 'online', 'appointment', 'schedule'],
      priority: 6,
      isActive: true,
    },
  ];

  console.log(`[FAQ Seed] Inserting ${faqs.length} FAQs...`);

  for (const faq of faqs) {
    try {
      await storage.createFaq(faq);
      console.log(`[FAQ Seed] ✓ ${faq.category}: ${faq.question}`);
    } catch (error: any) {
      console.error(`[FAQ Seed] ✗ Failed to insert FAQ: ${faq.question}`, error.message);
    }
  }

  console.log('[FAQ Seed] ✅ FAQ seeding complete!');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedFaqs()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[FAQ Seed] Fatal error:', error);
      process.exit(1);
    });
}

export { seedFaqs };
