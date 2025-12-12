/**
 * Authentication Middleware
 * Protects routes and provides user context
 */

import { Request, Response, NextFunction } from "express";
import { getUserById, canAccessTenant, isSuperAdmin, logAuditEvent } from "../services/auth";
import type { User, Tenant, UserRole } from "../../shared/schema";
import { storage } from "../storage";

// Extend Express Request to include user and tenant
declare global {
  namespace Express {
    interface Request {
      user?: User;
      tenant?: Tenant;
      impersonating?: boolean;
      activeTenantId?: number; // Resolved tenant ID for the request
    }
  }
}

// Session data interface
export interface SessionData {
  userId: number;
  tenantId?: number;
  impersonatingTenantId?: number; // For super admin impersonation
  activeTenantId?: number; // Currently selected tenant (for super admins)
}

/**
 * Resolve the tenant ID for a request.
 * Priority order:
 * 1. X-Tenant-Id header (for super admins selecting a tenant)
 * 2. Route parameter :tenantId
 * 3. Session's activeTenantId (for super admins)
 * 4. User's own tenantId
 */
export function resolveRequestTenantId(req: Request): number | null {
  const session = req.session as unknown as { data?: SessionData };

  // 1. Check X-Tenant-Id header (primarily for super admin tenant selection)
  const headerTenantId = req.headers['x-tenant-id'];
  if (headerTenantId && typeof headerTenantId === 'string') {
    const parsed = parseInt(headerTenantId, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // 2. Check route parameter
  if (req.params.tenantId) {
    const parsed = parseInt(req.params.tenantId, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // 3. Check session's active tenant (for super admins who selected a tenant)
  if (session.data?.activeTenantId) {
    return session.data.activeTenantId;
  }

  // 4. Fall back to user's own tenant
  return req.user?.tenantId ?? null;
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
 * Resolves tenant from X-Tenant-Id header, route param, session, or user's tenant
 * Loads and attaches the tenant to the request
 */
export function requireTenantAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Resolve tenant ID using the helper
  const tenantId = resolveRequestTenantId(req);

  if (!tenantId) {
    console.warn('[Auth] Tenant access denied - no tenantId:', {
      userId: req.user.id,
      email: req.user.email,
      role: req.user.role,
      userTenantId: req.user.tenantId,
      headerTenantId: req.headers['x-tenant-id'],
      paramTenantId: req.params.tenantId
    });
    return res.status(400).json({
      error: "No tenant selected. Please select a clinic to manage.",
      code: "NO_TENANT",
      requiresTenantSelection: true // Signal to UI to show tenant selector
    });
  }

  // Check access permission
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

  // Store the resolved tenant ID on the request
  req.activeTenantId = tenantId;

  // Load the tenant if not already loaded or if different from user's tenant
  if (!req.tenant || req.tenant.id !== tenantId) {
    storage.getTenantById(tenantId)
      .then((tenant) => {
        if (!tenant) {
          return res.status(404).json({ error: "Tenant not found" });
        }
        req.tenant = tenant;
        next();
      })
      .catch((err) => {
        console.error('[Auth] Error loading tenant:', err);
        res.status(500).json({ error: "Failed to load tenant" });
      });
  } else {
    next();
  }
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
