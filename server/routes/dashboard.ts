/**
 * Client Dashboard API Routes
 *
 * Provides authenticated API endpoints for clinic owners to:
 * - Sign up and complete onboarding after Stripe payment
 * - Log in and manage their settings
 * - Configure clinic info, FAQs, voice settings
 * - Manage subscription billing
 */

import { Request, Response, Express } from 'express';
import { storage } from '../storage';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { createCheckoutSession, createPortalSession, getSubscription } from '../services/stripe';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const SALT_ROUNDS = 10;

// Middleware to verify JWT token and extract tenant
async function authenticateUser(req: Request, res: Response, next: Function) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; tenantId: number; email: string };

    // Attach user info to request
    (req as any).user = decoded;

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function registerDashboard(app: Express) {

  /**
   * POST /api/dashboard/signup
   * Complete signup after Stripe payment
   * Creates tenant + first user account
   */
  app.post('/api/dashboard/signup', async (req: Request, res: Response) => {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        clinicName,
        timezone,
        stripeCustomerId
      } = req.body;

      // Validation
      if (!email || !password || !clinicName) {
        return res.status(400).json({ error: 'Email, password, and clinic name are required' });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Generate unique slug from clinic name
      const baseSlug = clinicName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      let slug = baseSlug;
      let counter = 1;
      while (await storage.getTenant(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      // Create tenant
      const tenant = await storage.createTenant({
        slug,
        clinicName,
        email,
        timezone: timezone || 'Australia/Brisbane',
        greeting: `Thanks for calling ${clinicName}`,
        stripeCustomerId: stripeCustomerId || undefined,
        subscriptionTier: stripeCustomerId ? 'starter' : 'free',
        subscriptionStatus: 'active',
      });

      // Hash password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      // Create user account
      const user = await storage.createUser({
        tenantId: tenant.id,
        email,
        passwordHash,
        firstName,
        lastName,
        role: 'owner',
        emailVerified: true, // Auto-verify if they came from Stripe
        isActive: true,
      });

      // Generate JWT
      const token = jwt.sign(
        { userId: user.id, tenantId: tenant.id, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      console.log(`[Dashboard] New signup: ${email} for clinic: ${clinicName} (${slug})`);

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          clinicName: tenant.clinicName,
          subscriptionTier: tenant.subscriptionTier,
        },
      });

    } catch (error: any) {
      console.error('[Dashboard] Signup error:', error);
      res.status(500).json({ error: 'Failed to create account', details: error.message });
    }
  });

  /**
   * POST /api/dashboard/login
   * Authenticate user and return JWT
   */
  app.post('/api/dashboard/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      // Find user
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (!user.isActive) {
        return res.status(403).json({ error: 'Account is disabled' });
      }

      // Verify password
      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Get tenant info
      const tenant = await storage.getTenantById(user.tenantId);
      if (!tenant) {
        return res.status(500).json({ error: 'Tenant not found' });
      }

      // Update last login
      await storage.updateUser(user.id, { lastLoginAt: new Date() });

      // Generate JWT
      const token = jwt.sign(
        { userId: user.id, tenantId: user.tenantId, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      console.log(`[Dashboard] Login: ${email} (tenant: ${tenant.slug})`);

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          clinicName: tenant.clinicName,
          subscriptionTier: tenant.subscriptionTier,
          subscriptionStatus: tenant.subscriptionStatus,
        },
      });

    } catch (error: any) {
      console.error('[Dashboard] Login error:', error);
      res.status(500).json({ error: 'Failed to log in', details: error.message });
    }
  });

  /**
   * GET /api/dashboard/me
   * Get current user info (requires auth)
   */
  app.get('/api/dashboard/me', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { userId, tenantId } = (req as any).user;

      const user = await storage.getUserById(userId);
      const tenant = await storage.getTenantById(tenantId);

      if (!user || !tenant) {
        return res.status(404).json({ error: 'User or tenant not found' });
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          clinicName: tenant.clinicName,
          email: tenant.email,
          phoneNumber: tenant.phoneNumber,
          address: tenant.address,
          timezone: tenant.timezone,
          subscriptionTier: tenant.subscriptionTier,
          subscriptionStatus: tenant.subscriptionStatus,
        },
      });

    } catch (error: any) {
      console.error('[Dashboard] Get me error:', error);
      res.status(500).json({ error: 'Failed to fetch user info' });
    }
  });

  /**
   * PATCH /api/dashboard/clinic-info
   * Update clinic information (requires auth)
   */
  app.patch('/api/dashboard/clinic-info', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;
      const { clinicName, email, phoneNumber, address, timezone } = req.body;

      const updates: any = {};
      if (clinicName) updates.clinicName = clinicName;
      if (email) updates.email = email;
      if (phoneNumber) updates.phoneNumber = phoneNumber;
      if (address) updates.address = address;
      if (timezone) updates.timezone = timezone;

      const tenant = await storage.updateTenant(tenantId, updates);

      console.log(`[Dashboard] Updated clinic info for tenant ${tenantId}`);

      res.json({ success: true, tenant });

    } catch (error: any) {
      console.error('[Dashboard] Update clinic info error:', error);
      res.status(500).json({ error: 'Failed to update clinic info' });
    }
  });

  /**
   * GET /api/dashboard/faqs
   * Get all FAQs for this tenant (requires auth)
   */
  app.get('/api/dashboard/faqs', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;

      const faqs = await storage.listFaqs(tenantId);

      res.json({ faqs });

    } catch (error: any) {
      console.error('[Dashboard] Get FAQs error:', error);
      res.status(500).json({ error: 'Failed to fetch FAQs' });
    }
  });

  /**
   * POST /api/dashboard/faqs
   * Create a new FAQ (requires auth)
   */
  app.post('/api/dashboard/faqs', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;
      const { category, question, answer, keywords, priority, isActive } = req.body;

      if (!category || !question || !answer) {
        return res.status(400).json({ error: 'Category, question, and answer are required' });
      }

      const faq = await storage.createFaq({
        tenantId,
        category,
        question,
        answer,
        keywords: keywords || [],
        priority: priority || 5,
        isActive: isActive !== undefined ? isActive : true,
      });

      console.log(`[Dashboard] Created FAQ for tenant ${tenantId}: ${question}`);

      res.json({ success: true, faq });

    } catch (error: any) {
      console.error('[Dashboard] Create FAQ error:', error);
      res.status(500).json({ error: 'Failed to create FAQ' });
    }
  });

  /**
   * PATCH /api/dashboard/faqs/:id
   * Update an FAQ (requires auth)
   */
  app.patch('/api/dashboard/faqs/:id', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;
      const faqId = parseInt(req.params.id);
      const { category, question, answer, keywords, priority, isActive } = req.body;

      // Verify FAQ belongs to this tenant
      const existingFaq = await storage.getFaqById(faqId);
      if (!existingFaq || existingFaq.tenantId !== tenantId) {
        return res.status(403).json({ error: 'FAQ not found or access denied' });
      }

      const updates: any = {};
      if (category) updates.category = category;
      if (question) updates.question = question;
      if (answer) updates.answer = answer;
      if (keywords) updates.keywords = keywords;
      if (priority !== undefined) updates.priority = priority;
      if (isActive !== undefined) updates.isActive = isActive;

      const faq = await storage.updateFaq(faqId, updates);

      console.log(`[Dashboard] Updated FAQ ${faqId} for tenant ${tenantId}`);

      res.json({ success: true, faq });

    } catch (error: any) {
      console.error('[Dashboard] Update FAQ error:', error);
      res.status(500).json({ error: 'Failed to update FAQ' });
    }
  });

  /**
   * DELETE /api/dashboard/faqs/:id
   * Delete an FAQ (requires auth)
   */
  app.delete('/api/dashboard/faqs/:id', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;
      const faqId = parseInt(req.params.id);

      // Verify FAQ belongs to this tenant
      const existingFaq = await storage.getFaqById(faqId);
      if (!existingFaq || existingFaq.tenantId !== tenantId) {
        return res.status(403).json({ error: 'FAQ not found or access denied' });
      }

      await storage.deleteFaq(faqId);

      console.log(`[Dashboard] Deleted FAQ ${faqId} for tenant ${tenantId}`);

      res.json({ success: true });

    } catch (error: any) {
      console.error('[Dashboard] Delete FAQ error:', error);
      res.status(500).json({ error: 'Failed to delete FAQ' });
    }
  });

  /**
   * PATCH /api/dashboard/voice-settings
   * Update voice and greeting settings (requires auth)
   */
  app.patch('/api/dashboard/voice-settings', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;
      const { voiceName, greeting, fallbackMessage } = req.body;

      const updates: any = {};
      if (voiceName) updates.voiceName = voiceName;
      if (greeting) updates.greeting = greeting;
      if (fallbackMessage !== undefined) updates.fallbackMessage = fallbackMessage;

      const tenant = await storage.updateTenant(tenantId, updates);

      console.log(`[Dashboard] Updated voice settings for tenant ${tenantId}`);

      res.json({ success: true, tenant });

    } catch (error: any) {
      console.error('[Dashboard] Update voice settings error:', error);
      res.status(500).json({ error: 'Failed to update voice settings' });
    }
  });

  /**
   * GET /api/dashboard/billing/subscription
   * Get subscription details (requires auth)
   */
  app.get('/api/dashboard/billing/subscription', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;

      const subscription = await getSubscription(tenantId);

      res.json({ subscription });

    } catch (error: any) {
      console.error('[Dashboard] Get subscription error:', error);
      res.status(500).json({ error: 'Failed to fetch subscription' });
    }
  });

  /**
   * POST /api/dashboard/billing/upgrade
   * Create Stripe checkout session for upgrade (requires auth)
   */
  app.post('/api/dashboard/billing/upgrade', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;
      const { tier } = req.body;

      if (!tier) {
        return res.status(400).json({ error: 'Subscription tier is required' });
      }

      const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
      const result = await createCheckoutSession(
        tenantId,
        tier,
        `${baseUrl}/dashboard/billing/success`,
        `${baseUrl}/dashboard/billing`
      );

      if ('error' in result) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ url: result.url });

    } catch (error: any) {
      console.error('[Dashboard] Create upgrade session error:', error);
      res.status(500).json({ error: 'Failed to create upgrade session' });
    }
  });

  /**
   * POST /api/dashboard/billing/portal
   * Create Stripe billing portal session (requires auth)
   */
  app.post('/api/dashboard/billing/portal', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;

      const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
      const result = await createPortalSession(tenantId, `${baseUrl}/dashboard/billing`);

      if ('error' in result) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ url: result.url });

    } catch (error: any) {
      console.error('[Dashboard] Create portal session error:', error);
      res.status(500).json({ error: 'Failed to create portal session' });
    }
  });

  /**
   * GET /api/dashboard/call-logs
   * Get call logs for this tenant (requires auth)
   */
  app.get('/api/dashboard/call-logs', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const calls = await storage.listCalls(tenantId, limit);

      res.json({ calls });

    } catch (error: any) {
      console.error('[Dashboard] Get call logs error:', error);
      res.status(500).json({ error: 'Failed to fetch call logs' });
    }
  });

  /**
   * GET /api/dashboard/stats
   * Get statistics for this tenant (requires auth)
   */
  app.get('/api/dashboard/stats', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { tenantId } = (req as any).user;

      const stats = await storage.getStats(tenantId);

      res.json({ stats });

    } catch (error: any) {
      console.error('[Dashboard] Get stats error:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });
}
