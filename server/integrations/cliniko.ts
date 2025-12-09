import { env } from '../utils/env';

const CLINIKO_BASE = env.CLINIKO_BASE_URL;
const CLINIKO_KEY = env.CLINIKO_API_KEY;

function headers() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Basic ${Buffer.from(CLINIKO_KEY + ":").toString("base64")}`,
    "Accept": "application/json"
  };
}

// --- Retry logic with exponential backoff ---
interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  shouldRetry?: (error: any) => boolean;
}

/**
 * Wraps an async operation with exponential backoff retry logic.
 *
 * @param operation - The async function to retry
 * @param options - Retry configuration
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    shouldRetry = defaultShouldRetry
  } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry if this is the last attempt
      if (attempt > maxRetries) {
        console.error(`[Cliniko Retry] All ${maxRetries} retries exhausted:`, error);
        break;
      }

      // Check if error is retryable
      if (!shouldRetry(error)) {
        console.warn('[Cliniko Retry] Non-retryable error, aborting:', error);
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 0.3 * exponentialDelay; // +/- 30% jitter
      const delay = Math.min(exponentialDelay + jitter, maxDelay);

      console.warn(
        `[Cliniko Retry] Attempt ${attempt}/${maxRetries + 1} failed. ` +
        `Retrying in ${Math.round(delay)}ms...`,
        String(error).substring(0, 200)
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Determines if an error should trigger a retry.
 * Retries network errors, rate limits (429), and server errors (5xx).
 * Does NOT retry client errors (4xx) except 429.
 */
function defaultShouldRetry(error: any): boolean {
  const errorStr = String(error);

  // Network/connection errors - always retry
  if (
    errorStr.includes('ECONNREFUSED') ||
    errorStr.includes('ETIMEDOUT') ||
    errorStr.includes('ENOTFOUND') ||
    errorStr.includes('socket hang up') ||
    errorStr.includes('network')
  ) {
    return true;
  }

  // Extract HTTP status code if present
  const statusMatch = errorStr.match(/\b(4\d{2}|5\d{2})\b/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);

    // Retry rate limits
    if (status === 429) return true;

    // Retry server errors (500-599)
    if (status >= 500) return true;

    // Don't retry client errors (400-499) except 429
    if (status >= 400 && status < 500) return false;
  }

  // If we can't determine, err on the side of retrying
  return true;
}

// --- Critical error alerting ---
interface CriticalFailure {
  operation: string;
  patientId?: string;
  error: string;
  timestamp: string;
  context?: Record<string, any>;
}

const criticalFailures: CriticalFailure[] = [];
const MAX_STORED_FAILURES = 100;

/**
 * Logs a critical failure that should alert staff.
 * In production, this could send emails, SMS, or Slack notifications.
 *
 * @param failure - Details about the critical failure
 */
export function logCriticalFailure(failure: Omit<CriticalFailure, 'timestamp'>): void {
  const fullFailure: CriticalFailure = {
    ...failure,
    timestamp: new Date().toISOString()
  };

  // Store for retrieval
  criticalFailures.push(fullFailure);
  if (criticalFailures.length > MAX_STORED_FAILURES) {
    criticalFailures.shift(); // Remove oldest
  }

  // Log to console (in production, add email/SMS/Slack integration here)
  console.error('🚨 [CLINIKO CRITICAL FAILURE] 🚨', {
    operation: fullFailure.operation,
    patientId: fullFailure.patientId,
    error: fullFailure.error.substring(0, 500),
    timestamp: fullFailure.timestamp,
    context: fullFailure.context
  });

  // TODO: Send alert to staff via email/SMS/Slack
  // Example: await sendStaffAlert({ subject: 'Cliniko Update Failed', body: ... });
}

/**
 * Retrieves recent critical failures for staff dashboard.
 *
 * @param limit - Maximum number of failures to return
 * @returns Recent critical failures
 */
export function getRecentCriticalFailures(limit: number = 20): CriticalFailure[] {
  return criticalFailures.slice(-limit).reverse();
}

// --- Input hygiene helpers ---
export function sanitizeEmail(input?: string | null): string | null {
  if (!input) return null;
  let e = String(input).trim();
  // drop trailing punctuation artifacts users often speak
  e = e.replace(/[,\.;:!?]+$/g, "");
  // collapse whitespace
  e = e.replace(/\s+/g, "");
  // very light validation
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  return ok ? e : null;
}

export function sanitizePhoneE164AU(input?: string | null): string | null {
  if (!input) return null;
  
  // Strip all non-digits except leading +
  let s = String(input).replace(/[^\d+]/g, "");
  
  // Handle common "+61 0" redundant zero patterns
  // +6104XXXXXXXX -> +614XXXXXXXX (mobile)
  if (/^\+6104\d{8}$/.test(s)) s = "+614" + s.slice(5);
  // +610[2378]XXXXXXXX -> +61[2378]XXXXXXXX (landline)
  if (/^\+610[2378]\d{8}$/.test(s)) s = "+61" + s.slice(4);
  
  // Convert 04XXXXXXXX (mobile) -> +614XXXXXXXX
  if (/^04\d{8}$/.test(s)) s = "+61" + s.slice(1);
  
  // Convert 02/03/07/08 (landlines) -> +612/+613/+617/+618
  if (/^0[2378]\d{8}$/.test(s)) s = "+61" + s.slice(1);
  
  // Accept +61XXXXXXXXX (mobile or landline)
  if (/^\+61[2-478]\d{8}$/.test(s)) return s;
  
  // Accept 61XXXXXXXXX -> +61...
  if (/^61[2-478]\d{8}$/.test(s)) return "+" + s;
  
  // Accept already E.164 format
  if (/^\+61\d{9}$/.test(s)) return s;
  
  return null; // don't pass garbage to Cliniko
}

// Helper to normalize phone for comparison
function normalizePhoneForMatching(input?: string | null): string[] {
  const e164 = sanitizePhoneE164AU(input);
  if (!e164) return [];
  
  const variants: string[] = [e164];
  
  // Also return 0-prefix variant (e.g., +61412345678 -> 0412345678)
  if (e164.startsWith('+61')) {
    variants.push('0' + e164.slice(3));
  }
  
  return variants;
}

// --- low-level fetch wrappers (with retry logic) ---
async function clinikoGet(path: string, params?: Record<string, string>): Promise<any> {
  return withRetry(async () => {
    const url = new URL(CLINIKO_BASE + path);
    if (params) {
      // IMPORTANT: Explicitly set each parameter to ensure correct encoding
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(String(k), String(v));
      }
    }
    const res = await fetch(url.toString(), { method: "GET", headers: headers() });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Cliniko GET ${url.pathname} ${res.status}: ${text}`);
    }
    return text ? JSON.parse(text) : {};
  }, { maxRetries: 3, baseDelay: 1000 });
}

async function clinikoPost(path: string, payload: any): Promise<any> {
  return withRetry(async () => {
    const res = await fetch(CLINIKO_BASE + path, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Cliniko POST ${path} ${res.status}: ${text}`);
    }
    return text ? JSON.parse(text) : {};
  }, { maxRetries: 3, baseDelay: 1000 });
}

async function clinikoPatch(path: string, payload: any): Promise<any> {
  return withRetry(async () => {
    const res = await fetch(CLINIKO_BASE + path, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Cliniko PATCH ${path} ${res.status}: ${text}`);
    }
    return text ? JSON.parse(text) : {};
  }, { maxRetries: 3, baseDelay: 1000 });
}

/**
 * Update an existing patient in Cliniko
 */
async function updatePatient(patientId: string, updates: {
  firstName?: string;
  lastName?: string;
  email?: string;
}): Promise<any> {
  const payload: any = {};

  if (updates.firstName) payload.first_name = updates.firstName;
  if (updates.lastName) payload.last_name = updates.lastName;
  if (updates.email) payload.email = sanitizeEmail(updates.email);

  console.log('[Cliniko] Updating patient', patientId, 'with:', payload);

  try {
    const updated = await clinikoPatch(`/patients/${patientId}`, payload);
    console.log('[Cliniko] Successfully updated patient:', patientId);
    return updated;
  } catch (e) {
    console.error('[Cliniko] Failed to update patient:', patientId, e);
    throw e;
  }
}

/**
 * Check if patient needs updating and update if necessary
 * Returns true if update was performed
 */
async function checkAndUpdatePatient(
  patient: any,
  newFullName?: string,
  newEmail?: string | null
): Promise<boolean> {
  const updates: { firstName?: string; lastName?: string; email?: string } = {};

  // Check if name needs updating
  if (newFullName && newFullName.trim()) {
    const [newFirst, ...rest] = newFullName.trim().split(/\s+/);
    const newLast = rest.join(' ') || '';

    const existingFirst = (patient.first_name || '').trim();
    const existingLast = (patient.last_name || '').trim();

    // Only update if the new name is more complete or different
    // Avoid updating if new name is less specific (e.g., "Unknown" vs actual name)
    const isMoreComplete = newFirst && newFirst !== 'Unknown' && newFirst !== 'New Caller';
    const isDifferent = newFirst.toLowerCase() !== existingFirst.toLowerCase() ||
                        newLast.toLowerCase() !== existingLast.toLowerCase();

    if (isMoreComplete && isDifferent && existingFirst !== newFirst) {
      console.log('[Cliniko] Name change detected:');
      console.log('[Cliniko]   Old:', existingFirst, existingLast);
      console.log('[Cliniko]   New:', newFirst, newLast);
      updates.firstName = newFirst;
      if (newLast) updates.lastName = newLast;
    }
  }

  // Check if email needs updating
  const sanitizedNewEmail = sanitizeEmail(newEmail || '');
  const existingEmail = (patient.email || '').trim().toLowerCase();

  if (sanitizedNewEmail && sanitizedNewEmail !== existingEmail) {
    console.log('[Cliniko] Email change detected:');
    console.log('[Cliniko]   Old:', existingEmail || '(none)');
    console.log('[Cliniko]   New:', sanitizedNewEmail);
    updates.email = sanitizedNewEmail;
  }

  // Perform update if needed
  if (Object.keys(updates).length > 0) {
    await updatePatient(patient.id, updates);
    return true;
  }

  console.log('[Cliniko] No updates needed for patient:', patient.id);
  return false;
}

// --- search strategies ---
// Use native email and phone_number query params (NOT q= free-text search)
export async function findPatientByEmail(emailRaw: string) {
  const email = sanitizeEmail(emailRaw);
  if (!email) {
    console.log('[Cliniko] findPatientByEmail: invalid email format:', emailRaw);
    return null;
  }

  // Use email query param for exact matching
  try {
    const data = await clinikoGet("/patients", { email: email });
    const list = Array.isArray(data?.patients) ? data.patients : [];
    return list[0] || null;
  } catch (e) {
    console.error('[Cliniko] findPatientByEmail error:', e);
    return null;
  }
}

export async function findPatientByPhone(phoneRaw: string) {
  const phone = sanitizePhoneE164AU(phoneRaw);
  if (!phone) {
    console.log('[Cliniko] findPatientByPhone: invalid phone format:', phoneRaw);
    return null;
  }

  const variants = normalizePhoneForMatching(phone);

  // Use phone_number query param for exact matching (NOT q= free-text search)
  try {
    // Try E.164 format first (+61...)
    console.log('[Cliniko] Looking up patient by phone:', phone);
    let data = await clinikoGet("/patients", { phone_number: phone });
    let list = Array.isArray(data?.patients) ? data.patients : [];

    if (list.length > 0) {
      console.log('[Cliniko] Found patient by E.164 format:', list[0].id, list[0].first_name, list[0].last_name);
      return list[0];
    }

    // Try local format (0...) as fallback
    if (phone.startsWith('+61')) {
      const localFormat = '0' + phone.slice(3);
      console.log('[Cliniko] Trying local format:', localFormat);
      data = await clinikoGet("/patients", { phone_number: localFormat });
      list = Array.isArray(data?.patients) ? data.patients : [];
      if (list.length > 0) {
        console.log('[Cliniko] Found patient by local format:', list[0].id, list[0].first_name, list[0].last_name);
        return list[0];
      }
    }

    console.log('[Cliniko] No patient found for phone:', phone);
    return null;
  } catch (e) {
    console.error('[Cliniko] findPatientByPhone error:', e);
    return null;
  }
}

// --- Upsert/Create patient ---
export async function getOrCreatePatient({
  fullName,
  email: emailRaw,
  phone: phoneRaw
}: {
  fullName?: string;
  email?: string;
  phone?: string;
}) {
  const email = sanitizeEmail(emailRaw || "");
  const phone = sanitizePhoneE164AU(phoneRaw || "");

  console.log('[Cliniko] getOrCreatePatient called with:');
  console.log('[Cliniko]   - fullName:', fullName);
  console.log('[Cliniko]   - email (raw):', emailRaw);
  console.log('[Cliniko]   - email (sanitized):', email);
  console.log('[Cliniko]   - phone (raw):', phoneRaw);
  console.log('[Cliniko]   - phone (sanitized):', phone);

  // Try finders first
  if (email) {
    console.log('[Cliniko] getOrCreatePatient: Searching by email:', email);
    const p = await findPatientByEmail(email);
    if (p) {
      console.log('[Cliniko] Found existing patient by email:', p.id);
      console.log('[Cliniko]   - Existing name:', p.first_name, p.last_name);
      console.log('[Cliniko]   - Existing email:', p.email);

      // Check if we need to update name or email
      const needsUpdate = await checkAndUpdatePatient(p, fullName, email);
      if (needsUpdate) {
        // Refetch the updated patient
        const updated = await findPatientByEmail(email);
        console.log('[Cliniko] Refetched updated patient:', updated?.id, updated?.email);
        return updated || p;
      }
      return p;
    }
  }
  if (phone) {
    console.log('[Cliniko] getOrCreatePatient: Searching by phone:', phone);
    const p = await findPatientByPhone(phone);
    if (p) {
      console.log('[Cliniko] Found existing patient by phone:', p.id);
      console.log('[Cliniko]   - Existing name:', p.first_name, p.last_name);
      console.log('[Cliniko]   - Existing email:', p.email);

      // Check if the name matches (if fullName is provided)
      if (fullName && fullName.trim()) {
        const existingFullName = `${p.first_name || ''} ${p.last_name || ''}`.trim().toLowerCase();
        const newFullName = fullName.trim().toLowerCase();

        // If names don't match, this is a different person using the same phone
        if (existingFullName !== newFullName) {
          console.log('[Cliniko] Found patient by phone BUT name mismatch:');
          console.log('[Cliniko]   Existing:', existingFullName);
          console.log('[Cliniko]   New:', newFullName);
          console.log('[Cliniko]   → Creating NEW patient for different person');
          // Don't return p - fall through to create new patient
        } else {
          console.log('[Cliniko] Found existing patient by phone with matching name:', p.id);

          // Update patient if needed (e.g., email was missing or changed)
          const needsUpdate = await checkAndUpdatePatient(p, fullName, email);
          if (needsUpdate && phone) {
            // Refetch the updated patient
            const updated = await findPatientByPhone(phone);
            console.log('[Cliniko] Refetched updated patient:', updated?.id, updated?.email);
            return updated || p;
          }
          return p;
        }
      } else {
        // No name provided - CANNOT verify if same person
        // To prevent data corruption, create a NEW patient instead of updating existing
        console.log('[Cliniko] Found patient by phone but NO NAME to verify identity');
        console.log('[Cliniko]   → Creating NEW patient to avoid overwriting existing data');
        console.warn('[Cliniko] ⚠️  WARNING: Multiple people may be using phone:', phone);
        // Don't return p - fall through to create new patient
      }
    }
  }

  // Split name safely
  const name = (fullName || "").trim() || "New Caller";
  const [first_name, ...rest] = name.split(/\s+/);
  const last_name = rest.join(" ") || "Unknown";

  console.log('[Cliniko] No existing patient found, creating new patient:', { first_name, last_name, email, phone });

  // Create payload — Cliniko requires structured fields
  const payload: any = { first_name, last_name };
  if (email) payload.email = email;
  if (phone) {
    // depending on your Cliniko account setup, you may use phone_numbers
    payload.phone_numbers = [{ label: "Mobile", number: phone }];
  }

  // If email is invalid, DO NOT send it — Cliniko returned 422 previously
  try {
    const created = await clinikoPost("/patients", payload);
    console.log("[Cliniko] Created patient:", created.id, first_name, last_name);
    return created;
  } catch (e) {
    // If creation fails due to email, retry without email once
    const msg = String(e);
    if (/email.*invalid/i.test(msg)) {
      console.warn("[Cliniko] Email invalid, retrying without email");
      delete payload.email;
      const created = await clinikoPost("/patients", payload);
      console.log("[Cliniko] Created patient (no email):", created.id, first_name, last_name);
      return created;
    }
    throw e;
  }
}

/**
 * Update a patient's email address only
 * Convenience wrapper around updateClinikoPatient
 */
export async function updateClinikoPatientEmail(patientId: string, email: string) {
  console.log('[Cliniko] Updating patient email:', patientId, '→', email);
  return updateClinikoPatient(patientId, { email });
}

// --- Update existing patient ---
export async function updateClinikoPatient(patientId: string, updates: {
  first_name?: string;
  last_name?: string;
  email?: string;
  date_of_birth?: string;
  phone_numbers?: Array<{ label: string; number: string }>;
}) {
  console.log('[Cliniko] Updating patient:', patientId, 'with:', updates);

  // Sanitize inputs
  const payload: any = {};

  if (updates.first_name) payload.first_name = updates.first_name.trim();
  if (updates.last_name) payload.last_name = updates.last_name.trim();
  if (updates.email) {
    const sanitized = sanitizeEmail(updates.email);
    if (sanitized) payload.email = sanitized;
  }
  if (updates.date_of_birth) payload.date_of_birth = updates.date_of_birth.trim();
  if (updates.phone_numbers) payload.phone_numbers = updates.phone_numbers;

  // If nothing to update, skip
  if (Object.keys(payload).length === 0) {
    console.log('[Cliniko] No valid updates provided, skipping');
    return null;
  }

  try {
    const updated = await clinikoPatch(`/patients/${patientId}`, payload);
    console.log("[Cliniko] Updated patient:", patientId);
    return updated;
  } catch (e) {
    const msg = String(e);
    // If email fails, retry without it
    if (/email.*invalid/i.test(msg) && payload.email) {
      console.warn("[Cliniko] Email invalid during update, retrying without email");
      delete payload.email;
      if (Object.keys(payload).length > 0) {
        try {
          const updated = await clinikoPatch(`/patients/${patientId}`, payload);
          console.log("[Cliniko] Updated patient (no email):", patientId);
          return updated;
        } catch (retryError) {
          // Log critical failure after all retries exhausted
          logCriticalFailure({
            operation: 'updateClinikoPatient',
            patientId,
            error: String(retryError),
            context: { updates, attemptedPayload: payload }
          });
          throw retryError;
        }
      }
    } else {
      // Log critical failure for non-email errors
      logCriticalFailure({
        operation: 'updateClinikoPatient',
        patientId,
        error: String(e),
        context: { updates, payload }
      });
    }
    throw e;
  }
}
