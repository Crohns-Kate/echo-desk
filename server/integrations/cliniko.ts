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

// --- low-level fetch wrappers ---
async function clinikoGet(path: string, params?: Record<string, string>): Promise<any> {
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
}

async function clinikoPost(path: string, payload: any): Promise<any> {
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
}

// --- search strategies ---
// Prefer native filters when possible, otherwise fall back to q= (free-text)
export async function findPatientByEmail(emailRaw: string) {
  const email = sanitizeEmail(emailRaw);
  if (!email) {
    console.log('[Cliniko] findPatientByEmail: invalid email format:', emailRaw);
    return null;
  }

  // Use q= with per_page for better results
  try {
    const data = await clinikoGet("/patients", { q: email, per_page: "25" });
    const list = Array.isArray(data?.patients) ? data.patients : [];
    // Return exact match or first result if no exact match
    return list.find((p: any) => (p.email || "").toLowerCase() === email.toLowerCase()) || list[0] || null;
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

  // Use q= with per_page for better results
  try {
    const data = await clinikoGet("/patients", { q: phone, per_page: "25" });
    const list = Array.isArray(data?.patients) ? data.patients : [];
    
    // Try exact match across stored phone fields with normalization
    const exact = list.find((p: any) => {
      const numbers = [
        p.phone_number,
        ...(Array.isArray(p.phone_numbers) ? p.phone_numbers.map((n: any) => n.number) : []),
      ].filter(Boolean);
      
      return numbers.some((n: string) => {
        const normalized = normalizePhoneForMatching(n);
        return normalized.some(nv => variants.includes(nv));
      });
    });
    
    return exact || list[0] || null;
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

  // Try finders first
  if (email) {
    const p = await findPatientByEmail(email);
    if (p) return p;
  }
  if (phone) {
    const p = await findPatientByPhone(phone);
    if (p) return p;
  }

  // Split name safely
  const name = (fullName || "").trim() || "New Caller";
  const [first_name, ...rest] = name.split(/\s+/);
  const last_name = rest.join(" ") || "Unknown";

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
    return created;
  } catch (e) {
    // If creation fails due to email, retry without email once
    const msg = String(e);
    if (/email.*invalid/i.test(msg)) {
      delete payload.email;
      const created = await clinikoPost("/patients", payload);
      return created;
    }
    throw e;
  }
}
