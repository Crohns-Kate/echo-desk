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
import * as crypto from 'crypto';
import { createCheckoutSession, createPortalSession, getSubscription } from '../services/stripe';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const SALT_ROUNDS = 10;
const BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

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
   * Complete signup (works for free tier or after Stripe payment)
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
        stripeCustomerId,
        tier = 'free'  // Default to free tier
      } = req.body;

      // Validation
      if (!email || !password || !clinicName) {
        return res.status(400).json({ error: 'Email, password, and clinic name are required' });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
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
        subscriptionTier: tier,
        subscriptionStatus: 'active',
      });

      // Hash password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      // Generate email verification token
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');

      // Create user account
      const user = await storage.createUser({
        tenantId: tenant.id,
        email: email.toLowerCase(),
        passwordHash,
        firstName,
        lastName,
        role: 'owner',
        emailVerified: false,  // Require email verification
        emailVerificationToken,
        isActive: true,
      });

      // TODO: Send verification email
      console.log(`[Dashboard] Verification link: ${BASE_URL}/verify-email?token=${emailVerificationToken}`);

      // Generate JWT
      const token = jwt.sign(
        { userId: user.id, tenantId: tenant.id, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      console.log(`[Dashboard] New signup: ${email} for clinic: ${clinicName} (${slug}) - ${tier} tier`);

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          emailVerified: user.emailVerified,
        },
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          clinicName: tenant.clinicName,
          subscriptionTier: tenant.subscriptionTier,
        },
        message: 'Account created! Please check your email to verify your account.',
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

  /**
   * GET /api/dashboard/verify-email
   * Verify email address using token
   */
  app.get('/api/dashboard/verify-email', async (req: Request, res: Response) => {
    try {
      const { token } = req.query;

      if (!token) {
        return res.status(400).json({ error: 'Verification token is required' });
      }

      // Find user by verification token
      const user = await storage.getUserByVerificationToken(token as string);

      if (!user) {
        return res.status(404).json({ error: 'Invalid or expired verification token' });
      }

      if (user.emailVerified) {
        return res.json({ success: true, message: 'Email already verified' });
      }

      // Mark email as verified
      await storage.updateUser(user.id, {
        emailVerified: true,
        emailVerificationToken: null,
      });

      console.log(`[Dashboard] Email verified for user: ${user.email}`);

      res.json({
        success: true,
        message: 'Email verified successfully! You can now log in.',
      });

    } catch (error: any) {
      console.error('[Dashboard] Email verification error:', error);
      res.status(500).json({ error: 'Failed to verify email' });
    }
  });

  /**
   * POST /api/dashboard/forgot-password
   * Request password reset
   */
  app.post('/api/dashboard/forgot-password', async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      const user = await storage.getUserByEmail(email);

      // Don't reveal if user exists (security best practice)
      if (!user) {
        return res.json({
          success: true,
          message: 'If an account exists with that email, you will receive a password reset link.',
        });
      }

      // Generate password reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 3600000); // 1 hour

      await storage.updateUser(user.id, {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
      });

      // TODO: Send password reset email
      console.log(`[Dashboard] Password reset link: ${BASE_URL}/reset-password?token=${resetToken}`);

      res.json({
        success: true,
        message: 'If an account exists with that email, you will receive a password reset link.',
      });

    } catch (error: any) {
      console.error('[Dashboard] Forgot password error:', error);
      res.status(500).json({ error: 'Failed to process request' });
    }
  });

  /**
   * POST /api/dashboard/reset-password
   * Reset password using token
   */
  app.post('/api/dashboard/reset-password', async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;

      if (!token || !password) {
        return res.status(400).json({ error: 'Token and new password are required' });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      // Find user by reset token
      const user = await storage.getUserByResetToken(token);

      if (!user) {
        return res.status(404).json({ error: 'Invalid or expired reset token' });
      }

      // Check if token has expired
      if (user.passwordResetExpires && new Date() > user.passwordResetExpires) {
        return res.status(400).json({ error: 'Reset token has expired' });
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      // Update password and clear reset token
      await storage.updateUser(user.id, {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      });

      console.log(`[Dashboard] Password reset for user: ${user.email}`);

      res.json({
        success: true,
        message: 'Password reset successfully! You can now log in with your new password.',
      });

    } catch (error: any) {
      console.error('[Dashboard] Reset password error:', error);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  /**
   * POST /api/dashboard/resend-verification
   * Resend email verification link
   */
  app.post('/api/dashboard/resend-verification', async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      const user = await storage.getUserByEmail(email);

      if (!user) {
        // Don't reveal if user exists
        return res.json({ success: true, message: 'Verification email sent if account exists.' });
      }

      if (user.emailVerified) {
        return res.json({ success: true, message: 'Email already verified' });
      }

      // Generate new verification token
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');

      await storage.updateUser(user.id, {
        emailVerificationToken,
      });

      // TODO: Send verification email
      console.log(`[Dashboard] Verification link: ${BASE_URL}/verify-email?token=${emailVerificationToken}`);

      res.json({
        success: true,
        message: 'Verification email sent if account exists.',
      });

    } catch (error: any) {
      console.error('[Dashboard] Resend verification error:', error);
      res.status(500).json({ error: 'Failed to resend verification' });
    }
  });
}
