/**
 * Authentication Service
 * Handles user authentication, password hashing, and session management
 */

import bcrypt from "bcrypt";
import crypto from "crypto";
import { db } from "../db";
import { users, tenants, auditLog } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import type { User, UserRole, Tenant } from "../../shared/schema";

const SALT_ROUNDS = 12;
const PASSWORD_RESET_EXPIRY_HOURS = 1;
const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;

// Password requirements
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export interface AuthResult {
  success: boolean;
  user?: User;
  tenant?: Tenant;
  error?: string;
  mustChangePassword?: boolean;
}

export interface CreateUserOptions {
  email: string;
  password: string;
  name?: string;
  tenantId?: number;
  role?: UserRole;
  mustChangePassword?: boolean;
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a password with a hash
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate password meets requirements
 */
export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (!PASSWORD_REGEX.test(password)) {
    return { valid: false, error: "Password must contain at least one uppercase letter, one lowercase letter, and one number" };
  }
  return { valid: true };
}

/**
 * Generate a secure random token
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generate a temporary password for new users
 */
export function generateTempPassword(): string {
  // Generate a memorable but secure password
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Create a new user
 */
export async function createUser(options: CreateUserOptions): Promise<{ user: User; tempPassword?: string }> {
  const { email, password, name, tenantId, role = "tenant_admin", mustChangePassword = false } = options;

  // Validate password
  const validation = validatePassword(password);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user
  const [user] = await db.insert(users).values({
    email: email.toLowerCase().trim(),
    passwordHash,
    name,
    tenantId,
    role,
    mustChangePassword,
    isActive: true,
    emailVerified: false,
  }).returning();

  return { user };
}

/**
 * Create a user with a temporary password (for onboarding via Stripe)
 */
export async function createUserWithTempPassword(
  email: string,
  name: string | undefined,
  tenantId: number,
  role: UserRole = "tenant_admin"
): Promise<{ user: User; tempPassword: string }> {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const [user] = await db.insert(users).values({
    email: email.toLowerCase().trim(),
    passwordHash,
    name,
    tenantId,
    role,
    mustChangePassword: true, // Force password change on first login
    isActive: true,
    emailVerified: false,
  }).returning();

  return { user, tempPassword };
}

/**
 * Authenticate a user with email and password
 */
export async function authenticateUser(email: string, password: string): Promise<AuthResult> {
  // Find user by email
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  if (!user) {
    return { success: false, error: "Invalid email or password" };
  }

  if (!user.isActive) {
    return { success: false, error: "Account is deactivated" };
  }

  // Verify password
  const isValid = await comparePassword(password, user.passwordHash);
  if (!isValid) {
    return { success: false, error: "Invalid email or password" };
  }

  // Get tenant if user has one
  let tenant: Tenant | undefined;
  if (user.tenantId) {
    const [t] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, user.tenantId))
      .limit(1);
    tenant = t;
  }

  // Update last login
  await db.update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return {
    success: true,
    user,
    tenant,
    mustChangePassword: user.mustChangePassword ?? false,
  };
}

/**
 * Get user by ID with tenant
 */
export async function getUserById(userId: number): Promise<{ user: User; tenant?: Tenant } | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  let tenant: Tenant | undefined;
  if (user.tenantId) {
    const [t] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, user.tenantId))
      .limit(1);
    tenant = t;
  }

  return { user, tenant };
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  return user || null;
}

/**
 * Change user password
 */
export async function changePassword(userId: number, currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  // Get user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return { success: false, error: "User not found" };
  }

  // Verify current password
  const isValid = await comparePassword(currentPassword, user.passwordHash);
  if (!isValid) {
    return { success: false, error: "Current password is incorrect" };
  }

  // Validate new password
  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Hash and update
  const passwordHash = await hashPassword(newPassword);
  await db.update(users)
    .set({
      passwordHash,
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return { success: true };
}

/**
 * Reset password with token
 */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  // Find user with valid token
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.passwordResetToken, token))
    .limit(1);

  if (!user) {
    return { success: false, error: "Invalid or expired reset token" };
  }

  // Check expiry
  if (user.passwordResetExpires && new Date() > user.passwordResetExpires) {
    return { success: false, error: "Reset token has expired" };
  }

  // Validate new password
  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Hash and update
  const passwordHash = await hashPassword(newPassword);
  await db.update(users)
    .set({
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return { success: true };
}

/**
 * Create password reset token
 */
export async function createPasswordResetToken(email: string): Promise<{ success: boolean; token?: string; error?: string }> {
  const user = await getUserByEmail(email);

  if (!user) {
    // Don't reveal if email exists
    return { success: true };
  }

  const token = generateToken();
  const expires = new Date();
  expires.setHours(expires.getHours() + PASSWORD_RESET_EXPIRY_HOURS);

  await db.update(users)
    .set({
      passwordResetToken: token,
      passwordResetExpires: expires,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return { success: true, token };
}

/**
 * Log an action to the audit log
 */
export async function logAuditEvent(
  action: string,
  userId?: number,
  tenantId?: number,
  entityType?: string,
  entityId?: number,
  oldValues?: unknown,
  newValues?: unknown,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await db.insert(auditLog).values({
    action,
    userId,
    tenantId,
    entityType,
    entityId,
    oldValues: oldValues as Record<string, unknown> | undefined,
    newValues: newValues as Record<string, unknown> | undefined,
    ipAddress,
    userAgent,
  });
}

/**
 * Check if user can access a tenant
 */
export function canAccessTenant(user: User, targetTenantId: number): boolean {
  // Super admins can access any tenant
  if (user.role === "super_admin") {
    return true;
  }

  // Other users can only access their own tenant
  return user.tenantId === targetTenantId;
}

/**
 * Check if user has admin role
 */
export function isAdmin(user: User): boolean {
  return user.role === "super_admin" || user.role === "tenant_admin";
}

/**
 * Check if user is super admin
 */
export function isSuperAdmin(user: User): boolean {
  return user.role === "super_admin";
}
