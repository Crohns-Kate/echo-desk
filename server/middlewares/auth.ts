/**
 * Authentication Middleware
 * Protects routes and provides user context
 */

import { Request, Response, NextFunction } from "express";
import { getUserById, canAccessTenant, isSuperAdmin, logAuditEvent } from "../services/auth";
import type { User, Tenant, UserRole } from "../../shared/schema";

// Extend Express Request to include user and tenant
declare global {
  namespace Express {
    interface Request {
      user?: User;
      tenant?: Tenant;
      impersonating?: boolean;
    }
  }
}

// Session data interface
export interface SessionData {
  userId: number;
  tenantId?: number;
  impersonatingTenantId?: number; // For super admin impersonation
}

/**
 * Require authentication
 * Returns 401 if not authenticated
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = req.session as unknown as { data?: SessionData };

  if (!session.data?.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Load user and attach to request
  getUserById(session.data.userId)
    .then((result) => {
      if (!result) {
        return res.status(401).json({ error: "User not found" });
      }

      req.user = result.user;
      req.tenant = result.tenant;

      // Handle impersonation
      if (session.data?.impersonatingTenantId && isSuperAdmin(result.user)) {
        req.impersonating = true;
        // Would need to load the impersonated tenant here
      }

      next();
    })
    .catch((err) => {
      console.error("Auth middleware error:", err);
      res.status(500).json({ error: "Internal server error" });
    });
}

/**
 * Require specific role(s)
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!roles.includes(req.user.role as UserRole)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}

/**
 * Require super admin role
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ error: "Super admin access required" });
  }

  next();
}

/**
 * Require tenant admin or super admin role
 */
export function requireTenantAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (req.user.role !== "super_admin" && req.user.role !== "tenant_admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
}

/**
 * Require access to a specific tenant
 * Use with :tenantId param or falls back to user's tenant
 */
export function requireTenantAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Get target tenant ID from params or user's tenant
  // Note: parseInt(undefined) returns NaN which is falsy
  const paramTenantId = req.params.tenantId ? parseInt(req.params.tenantId) : null;
  const tenantId = paramTenantId || req.user.tenantId;

  if (!tenantId) {
    console.warn('[Auth] Tenant access denied - no tenantId:', {
      userId: req.user.id,
      email: req.user.email,
      role: req.user.role,
      userTenantId: req.user.tenantId,
      paramTenantId: req.params.tenantId
    });
    return res.status(400).json({
      error: "No tenant associated with your account. Please contact support.",
      code: "NO_TENANT"
    });
  }

  if (!canAccessTenant(req.user, tenantId)) {
    // Log unauthorized access attempt
    logAuditEvent(
      "unauthorized_tenant_access",
      req.user.id,
      tenantId,
      "tenant",
      tenantId,
      undefined,
      undefined,
      req.ip,
      req.headers["user-agent"]
    ).catch(console.error);

    return res.status(403).json({ error: "Access denied to this tenant" });
  }

  next();
}

/**
 * Optional authentication
 * Loads user if authenticated but doesn't require it
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const session = req.session as unknown as { data?: SessionData };

  if (!session.data?.userId) {
    return next();
  }

  getUserById(session.data.userId)
    .then((result) => {
      if (result) {
        req.user = result.user;
        req.tenant = result.tenant;
      }
      next();
    })
    .catch(() => {
      // Silently fail - user just won't be attached
      next();
    });
}

/**
 * Require password change
 * Blocks access if user must change password (except to password change endpoint)
 */
export function checkPasswordChange(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return next();
  }

  // Allow access to password change endpoint
  if (req.path === "/api/auth/change-password" || req.path === "/api/auth/logout") {
    return next();
  }

  if (req.user.mustChangePassword) {
    return res.status(403).json({
      error: "Password change required",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  }

  next();
}

/**
 * Rate limiting state (simple in-memory, replace with Redis for production)
 */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/**
 * Rate limit login attempts
 */
export function rateLimit(maxAttempts: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || "unknown";
    const now = Date.now();

    const attempt = loginAttempts.get(key);

    if (attempt) {
      if (now > attempt.resetAt) {
        // Window expired, reset
        loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
      } else if (attempt.count >= maxAttempts) {
        const retryAfter = Math.ceil((attempt.resetAt - now) / 1000);
        res.set("Retry-After", retryAfter.toString());
        return res.status(429).json({
          error: "Too many attempts. Please try again later.",
          retryAfter,
        });
      } else {
        attempt.count++;
      }
    } else {
      loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
    }

    next();
  };
}

/**
 * Clear rate limit for an IP (call on successful login)
 */
export function clearRateLimit(ip: string) {
  loginAttempts.delete(ip);
}
