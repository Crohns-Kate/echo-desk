/**
 * Authentication Routes
 * Handles login, logout, password management
 */

import { Router, Request, Response } from "express";
import {
  authenticateUser,
  changePassword,
  createPasswordResetToken,
  resetPasswordWithToken,
  logAuditEvent,
  getUserById,
} from "../services/auth";
import {
  requireAuth,
  rateLimit,
  clearRateLimit,
  checkPasswordChange,
  type SessionData,
} from "../middlewares/auth";

const router = Router();

/**
 * POST /api/auth/login
 * Authenticate user with email and password
 */
router.post(
  "/login",
  rateLimit(5, 15 * 60 * 1000), // 5 attempts per 15 minutes
  async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const result = await authenticateUser(email, password);

      if (!result.success) {
        // Log failed attempt
        await logAuditEvent(
          "login_failed",
          undefined,
          undefined,
          "user",
          undefined,
          { email },
          undefined,
          req.ip,
          req.headers["user-agent"]
        );

        return res.status(401).json({ error: result.error });
      }

      // Set up session
      const session = req.session as unknown as { data: SessionData; save: (cb: (err?: Error) => void) => void };
      session.data = {
        userId: result.user!.id,
        tenantId: result.user!.tenantId ?? undefined,
      };

      // Save session explicitly
      session.save((err: Error | undefined) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ error: "Failed to create session" });
        }

        // Clear rate limit on successful login
        clearRateLimit(req.ip || "unknown");

        // Log successful login
        logAuditEvent(
          "login_success",
          result.user!.id,
          result.tenant?.id,
          "user",
          result.user!.id,
          undefined,
          undefined,
          req.ip,
          req.headers["user-agent"]
        ).catch(console.error);

        // Return user data (without sensitive fields)
        const { passwordHash, passwordResetToken, emailVerificationToken, ...safeUser } = result.user!;

        res.json({
          user: safeUser,
          tenant: result.tenant ? {
            id: result.tenant.id,
            slug: result.tenant.slug,
            clinicName: result.tenant.clinicName,
            onboardingCompleted: result.tenant.onboardingCompleted,
            subscriptionTier: result.tenant.subscriptionTier,
          } : null,
          mustChangePassword: result.mustChangePassword,
        });
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * POST /api/auth/logout
 * Clear session and log out
 */
router.post("/logout", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const tenantId = req.tenant?.id;

    // Log logout
    await logAuditEvent(
      "logout",
      userId,
      tenantId,
      "user",
      userId,
      undefined,
      undefined,
      req.ip,
      req.headers["user-agent"]
    );

    // Destroy session
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err);
        return res.status(500).json({ error: "Failed to logout" });
      }

      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await getUserById(req.user!.id);

    if (!result) {
      return res.status(404).json({ error: "User not found" });
    }

    const { passwordHash, passwordResetToken, emailVerificationToken, ...safeUser } = result.user;

    res.json({
      user: safeUser,
      tenant: result.tenant ? {
        id: result.tenant.id,
        slug: result.tenant.slug,
        clinicName: result.tenant.clinicName,
        phoneNumber: result.tenant.phoneNumber,
        timezone: result.tenant.timezone,
        onboardingCompleted: result.tenant.onboardingCompleted,
        onboardingStep: result.tenant.onboardingStep,
        subscriptionTier: result.tenant.subscriptionTier,
        subscriptionStatus: result.tenant.subscriptionStatus,
        trialEndsAt: result.tenant.trialEndsAt,
        isActive: result.tenant.isActive,
      } : null,
    });
  } catch (error) {
    console.error("Get me error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/auth/change-password
 * Change password for authenticated user
 */
router.post("/change-password", requireAuth, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }

    const result = await changePassword(req.user!.id, currentPassword, newPassword);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log password change
    await logAuditEvent(
      "password_changed",
      req.user!.id,
      req.tenant?.id,
      "user",
      req.user!.id,
      undefined,
      undefined,
      req.ip,
      req.headers["user-agent"]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/auth/forgot-password
 * Request password reset email
 */
router.post(
  "/forgot-password",
  rateLimit(3, 60 * 60 * 1000), // 3 requests per hour
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const result = await createPasswordResetToken(email);

      // Send password reset email
      if (result.token) {
        const { sendPasswordResetEmail } = await import("../services/email");
        await sendPasswordResetEmail(email, result.token);

        // Log password reset request
        await logAuditEvent(
          "password_reset_requested",
          undefined,
          undefined,
          "user",
          undefined,
          { email },
          undefined,
          req.ip,
          req.headers["user-agent"]
        );
      }

      // Always return success to prevent email enumeration
      res.json({
        success: true,
        message: "If an account exists with this email, you will receive a password reset link.",
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    const result = await resetPasswordWithToken(token, newPassword);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log password reset
    await logAuditEvent(
      "password_reset_completed",
      undefined,
      undefined,
      "user",
      undefined,
      undefined,
      undefined,
      req.ip,
      req.headers["user-agent"]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/auth/check
 * Check if user is authenticated (lightweight)
 */
router.get("/check", (req: Request, res: Response) => {
  const session = req.session as unknown as { data?: SessionData };

  if (session.data?.userId) {
    res.json({ authenticated: true, userId: session.data.userId });
  } else {
    res.json({ authenticated: false });
  }
});

/**
 * POST /api/auth/signup
 * Create new tenant and user account
 */
router.post(
  "/signup",
  rateLimit(10, 60 * 60 * 1000), // 10 signups per hour per IP
  async (req: Request, res: Response) => {
    try {
      const { clinicName, email, firstName, lastName, phone, plan } = req.body;

      // Validate required fields
      if (!clinicName || !email || !firstName) {
        return res.status(400).json({ error: "Clinic name, email, and first name are required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      // Check if email already exists
      const { getUserByEmail } = await import("../services/auth");
      const existingUser = await getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "An account with this email already exists" });
      }

      // Import required services
      const { storage } = await import("../storage");
      const { createUserWithTempPassword, generateToken } = await import("../services/auth");
      const { createCheckoutSession, SUBSCRIPTION_TIERS, isStripeConfigured } = await import("../services/stripe");

      // Generate slug from clinic name
      let slug = clinicName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      // Ensure slug is unique
      let counter = 0;
      let baseSlug = slug;
      while (await storage.getTenant(slug)) {
        counter++;
        slug = `${baseSlug}-${counter}`;
      }

      // Create tenant
      const tenant = await storage.createTenant({
        slug,
        clinicName,
        email,
        timezone: "Australia/Brisbane",
        subscriptionTier: plan || "free",
        subscriptionStatus: plan === "free" ? "active" : "pending",
        isActive: plan === "free", // Free plans are active immediately
        onboardingCompleted: false,
        onboardingStep: 1,
      });

      console.log(`[Signup] Created tenant: ${tenant.id} (${slug})`);

      // Create user with temporary password
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;
      const { user, tempPassword } = await createUserWithTempPassword(
        email,
        fullName,
        tenant.id,
        "tenant_admin"
      );

      console.log(`[Signup] Created user: ${user.id} for tenant ${tenant.id}`);

      // Log signup event
      await logAuditEvent(
        "signup",
        user.id,
        tenant.id,
        "user",
        user.id,
        { plan, clinicName },
        undefined,
        req.ip,
        req.headers["user-agent"]
      );

      // Handle based on plan type
      const tierConfig = SUBSCRIPTION_TIERS[plan as keyof typeof SUBSCRIPTION_TIERS];
      const isPaidPlan = tierConfig && tierConfig.price > 0;

      if (isPaidPlan && isStripeConfigured()) {
        // Create Stripe checkout session
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const result = await createCheckoutSession(
          tenant.id,
          plan as any,
          `${baseUrl}/login?signup=success&tenant=${tenant.id}`,
          `${baseUrl}/signup?canceled=true`
        );

        if ("error" in result) {
          console.error(`[Signup] Failed to create checkout session:`, result.error);
          return res.status(500).json({ error: result.error });
        }

        console.log(`[Signup] Created Stripe checkout session for tenant ${tenant.id}`);

        // Send welcome email with credentials (account activates after payment)
        try {
          const { sendWelcomeEmail } = await import("../services/email");
          await sendWelcomeEmail(email, clinicName, tempPassword!);
          console.log(`[Signup] Sent welcome email to ${email} (pending payment)`);
        } catch (emailError) {
          console.error(`[Signup] Failed to send welcome email:`, emailError);
        }

        return res.json({
          checkoutUrl: result.url,
          tenantId: tenant.id,
        });
      } else {
        // Free plan - activate immediately and send welcome email
        try {
          const { sendWelcomeEmail } = await import("../services/email");
          await sendWelcomeEmail(email, clinicName, tempPassword!);
          console.log(`[Signup] Sent welcome email to ${email}`);
        } catch (emailError) {
          console.error(`[Signup] Failed to send welcome email:`, emailError);
          // Continue anyway - user can use forgot password
        }

        return res.json({
          success: true,
          redirectUrl: "/login?signup=success",
          tenantId: tenant.id,
        });
      }
    } catch (error: any) {
      console.error("Signup error:", error);
      res.status(500).json({ error: error.message || "Signup failed" });
    }
  }
);

/**
 * POST /api/auth/select-tenant
 * Set active tenant for super admin (stored in session)
 */
router.post("/select-tenant", requireAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.body;

    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Only super admins can switch tenants
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ error: "Only super admins can switch tenants" });
    }

    // Validate tenant ID
    if (!tenantId || typeof tenantId !== "number") {
      return res.status(400).json({ error: "Valid tenant ID is required" });
    }

    // Verify tenant exists
    const { storage } = await import("../storage");
    const tenant = await storage.getTenantById(tenantId);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    // Update session with active tenant
    const session = req.session as unknown as { data: { userId: number; activeTenantId?: number }; save: (cb: (err?: Error) => void) => void };
    session.data.activeTenantId = tenantId;

    session.save((err: Error | undefined) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({ error: "Failed to save session" });
      }

      // Log tenant switch
      logAuditEvent(
        "tenant_switch",
        req.user!.id,
        tenantId,
        "tenant",
        tenantId,
        undefined,
        undefined,
        req.ip,
        req.headers["user-agent"]
      ).catch(console.error);

      console.log(`[Auth] Super admin ${req.user!.email} switched to tenant ${tenantId} (${tenant.clinicName})`);

      res.json({
        success: true,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          clinicName: tenant.clinicName,
        },
      });
    });
  } catch (error) {
    console.error("Select tenant error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/auth/active-tenant
 * Get currently active tenant for the session
 */
router.get("/active-tenant", requireAuth, async (req: Request, res: Response) => {
  try {
    const session = req.session as unknown as { data?: { activeTenantId?: number } };

    // For regular users, return their tenant
    if (req.user?.role !== "super_admin" && req.user?.tenantId) {
      const result = await getUserById(req.user.id);
      if (result?.tenant) {
        return res.json({
          tenant: {
            id: result.tenant.id,
            slug: result.tenant.slug,
            clinicName: result.tenant.clinicName,
          },
        });
      }
    }

    // For super admins, check session for active tenant
    const activeTenantId = session.data?.activeTenantId;

    if (!activeTenantId) {
      return res.json({ tenant: null });
    }

    const { storage } = await import("../storage");
    const tenant = await storage.getTenantById(activeTenantId);

    if (!tenant) {
      return res.json({ tenant: null });
    }

    res.json({
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        clinicName: tenant.clinicName,
      },
    });
  } catch (error) {
    console.error("Get active tenant error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
