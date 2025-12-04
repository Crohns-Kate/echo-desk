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

      // TODO: Send email with reset link
      // For now, just log the token (remove in production!)
      if (result.token) {
        console.log(`Password reset token for ${email}: ${result.token}`);

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

export default router;
