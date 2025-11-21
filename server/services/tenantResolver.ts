/**
 * Tenant Resolver Service
 * Resolves incoming calls to their associated tenant based on phone number
 */

import { storage } from '../storage';
import type { Tenant } from '../../shared/schema';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface TenantContext {
  id: number;
  slug: string;
  clinicName: string;
  timezone: string;
  voiceName: string;
  greeting: string;
  fallbackMessage?: string;
  businessHours: Record<string, string[][]>;
  cliniko: {
    apiKey: string | null;
    shard: string;
    practitionerId: string | null;
    standardApptTypeId: string | null;
    newPatientApptTypeId: string | null;
  };
  features: {
    recording: boolean;
    transcription: boolean;
    qaAnalysis: boolean;
    faq: boolean;
    sms: boolean;
  };
  subscription: {
    tier: string;
    status: string;
  };
}

// ─────────────────────────────────────────────────────────────
// Encryption helpers
// ─────────────────────────────────────────────────────────────

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-encryption-key-32-bytes!'; // 32 bytes
const IV_LENGTH = 16;

/**
 * Encrypt a string using AES-256-CBC
 */
export function encrypt(text: string): string {
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypt a string encrypted with AES-256-CBC
 */
export function decrypt(text: string): string {
  try {
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const parts = text.split(':');
    if (parts.length !== 2) return '';
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error('[TenantResolver] Decryption error:', err);
    return '';
  }
}

// ─────────────────────────────────────────────────────────────
// Phone number normalization
// ─────────────────────────────────────────────────────────────

/**
 * Normalize a phone number to E.164 format
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';

  // Strip all non-digits except leading +
  let normalized = phone.replace(/[^\d+]/g, '');

  // Handle common AU formats
  if (normalized.startsWith('04') && normalized.length === 10) {
    normalized = '+61' + normalized.slice(1);
  } else if (normalized.startsWith('0') && normalized.length === 10) {
    normalized = '+61' + normalized.slice(1);
  } else if (normalized.startsWith('61') && normalized.length === 11) {
    normalized = '+' + normalized;
  }

  return normalized;
}

// ─────────────────────────────────────────────────────────────
// Tenant Resolution
// ─────────────────────────────────────────────────────────────

/**
 * Resolve a tenant from a Twilio phone number (Called/To number)
 */
export async function resolveTenant(calledNumber: string): Promise<Tenant | null> {
  const normalized = normalizePhoneNumber(calledNumber);

  if (!normalized) {
    console.warn('[TenantResolver] Invalid phone number:', calledNumber);
    return null;
  }

  console.log('[TenantResolver] Looking up tenant for phone:', normalized);

  // Query tenant by phone number
  const tenant = await storage.getTenantByPhone(normalized);

  if (!tenant) {
    // Try without + prefix
    const withoutPlus = normalized.replace(/^\+/, '');
    const tenantAlt = await storage.getTenantByPhone(withoutPlus);
    if (tenantAlt) {
      console.log('[TenantResolver] Found tenant (alt format):', tenantAlt.slug);
      return tenantAlt;
    }

    console.warn('[TenantResolver] No tenant found for phone:', normalized);
    return null;
  }

  if (!tenant.isActive) {
    console.warn('[TenantResolver] Tenant inactive:', tenant.slug);
    return null;
  }

  console.log('[TenantResolver] Resolved tenant:', tenant.slug);
  return tenant;
}

/**
 * Resolve tenant from slug
 */
export async function resolveTenantBySlug(slug: string): Promise<Tenant | null> {
  const tenant = await storage.getTenant(slug);

  if (!tenant) {
    console.warn('[TenantResolver] No tenant found for slug:', slug);
    return null;
  }

  if (!tenant.isActive) {
    console.warn('[TenantResolver] Tenant inactive:', tenant.slug);
    return null;
  }

  return tenant;
}

/**
 * Build a TenantContext from a Tenant record
 */
export function getTenantContext(tenant: Tenant): TenantContext {
  // Decrypt Cliniko API key if present
  let clinikoApiKey: string | null = null;
  if (tenant.clinikoApiKeyEncrypted) {
    clinikoApiKey = decrypt(tenant.clinikoApiKeyEncrypted);
  }

  // Parse business hours
  let businessHours: Record<string, string[][]> = {};
  if (tenant.businessHours && typeof tenant.businessHours === 'object') {
    businessHours = tenant.businessHours as Record<string, string[][]>;
  }

  return {
    id: tenant.id,
    slug: tenant.slug,
    clinicName: tenant.clinicName,
    timezone: tenant.timezone,
    voiceName: tenant.voiceName || 'Polly.Olivia-Neural',
    greeting: tenant.greeting,
    fallbackMessage: tenant.fallbackMessage || undefined,
    businessHours,
    cliniko: {
      apiKey: clinikoApiKey,
      shard: tenant.clinikoShard || 'au1',
      practitionerId: tenant.clinikoPractitionerId || null,
      standardApptTypeId: tenant.clinikoStandardApptTypeId || null,
      newPatientApptTypeId: tenant.clinikoNewPatientApptTypeId || null,
    },
    features: {
      recording: tenant.recordingEnabled ?? true,
      transcription: tenant.transcriptionEnabled ?? true,
      qaAnalysis: tenant.qaAnalysisEnabled ?? true,
      faq: tenant.faqEnabled ?? true,
      sms: tenant.smsEnabled ?? true,
    },
    subscription: {
      tier: tenant.subscriptionTier || 'free',
      status: tenant.subscriptionStatus || 'active',
    },
  };
}

/**
 * Get the default tenant (for backwards compatibility)
 */
export async function getDefaultTenant(): Promise<Tenant | null> {
  return storage.getTenant('default');
}

/**
 * Get tenant context with fallback to default tenant
 */
export async function resolveTenantWithFallback(calledNumber: string): Promise<TenantContext | null> {
  // Try to resolve by phone number
  let tenant = await resolveTenant(calledNumber);

  // Fallback to default tenant
  if (!tenant) {
    console.log('[TenantResolver] Falling back to default tenant');
    tenant = await getDefaultTenant();
  }

  if (!tenant) {
    console.error('[TenantResolver] No tenant found and no default tenant configured');
    return null;
  }

  return getTenantContext(tenant);
}
