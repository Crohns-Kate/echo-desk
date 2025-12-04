import { env } from '../utils/env';
import {
  getOrCreatePatient as intGetOrCreatePatient,
  findPatientByPhone as intFindPatientByPhone,
  findPatientByEmail as intFindPatientByEmail,
  sanitizeEmail,
  sanitizePhoneE164AU
} from '../integrations/cliniko';
import type { TenantContext } from './tenantResolver';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// Helper to build Cliniko headers and base URL from tenant context or env fallback
function getClinikoConfig(tenantCtx?: TenantContext): { base: string; headers: Record<string, string> } {
  let apiKey: string;
  let shard: string;

  if (tenantCtx?.cliniko?.apiKey && tenantCtx?.cliniko?.shard) {
    // Use tenant-specific credentials
    apiKey = tenantCtx.cliniko.apiKey;
    shard = tenantCtx.cliniko.shard;
    console.log('[Cliniko] Using tenant-specific credentials for:', tenantCtx.slug, `(shard: ${shard})`);
  } else {
    // Fallback to environment variables
    apiKey = env.CLINIKO_API_KEY;
    shard = env.CLINIKO_REGION; // Use CLINIKO_REGION instead of CLINIKO_SHARD
    console.log(`[Cliniko] Using environment credentials (shard: ${shard})`);
  }

  const base = `https://api.${shard}.cliniko.com/v1`;
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`
  };

  return { base, headers };
}

interface ClinikoPatient {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone_numbers: { number: string; phone_type: string }[];
}

interface ClinikoPractitioner {
  id: string;
  first_name: string;
  last_name: string;
  show_in_online_bookings: boolean;
  active: boolean;
}

interface ClinikoAppointmentType {
  id: string;
  name: string;
  show_in_online_bookings: boolean;
  duration_in_minutes: number;
}

interface ClinikoAvailableTime {
  appointment_start: string;
}

interface ClinikoBusiness {
  id: string;
  name: string;
}

interface ClinikoAppointment {
  id: string;
  starts_at: string;
  ends_at: string;
  patient_id: string;
  practitioner_id: string;
  appointment_type_id: string;
  notes: string | null;
  cancelled_at: string | null;
}

async function clinikoGet<T>(endpoint: string, base: string, headers: Record<string, string>): Promise<T> {
  const url = `${base}${endpoint}`;
  console.log('[Cliniko] GET', url.replace(base, ''));
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cliniko API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function clinikoPost<T>(endpoint: string, body: any, base: string, headers: Record<string, string>): Promise<T> {
  const url = `${base}${endpoint}`;
  console.log('[Cliniko] POST', url.replace(base, ''));
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cliniko API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function clinikoPatch<T>(endpoint: string, body: any, base: string, headers: Record<string, string>): Promise<T> {
  const url = `${base}${endpoint}`;
  console.log('[Cliniko] PATCH', url);
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cliniko API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getBusinesses(tenantCtx?: TenantContext): Promise<ClinikoBusiness[]> {
  const { base, headers } = getClinikoConfig(tenantCtx);
  const data = await clinikoGet<{ businesses: ClinikoBusiness[] }>('/businesses', base, headers);
  return data.businesses || [];
}

export async function getPractitioners(tenantCtx?: TenantContext): Promise<ClinikoPractitioner[]> {
  const { base, headers } = getClinikoConfig(tenantCtx);
  const data = await clinikoGet<{ practitioners: ClinikoPractitioner[] }>('/practitioners?per_page=50', base, headers);
  const all = data.practitioners || [];
  return all.filter(p => p.show_in_online_bookings && p.active);
}

export async function getAppointmentTypes(practitionerId: string, tenantCtx?: TenantContext): Promise<ClinikoAppointmentType[]> {
  if (!practitionerId) {
    throw new Error('practitionerId is required to fetch appointment types');
  }
  const { base, headers } = getClinikoConfig(tenantCtx);
  const data = await clinikoGet<{ appointment_types: ClinikoAppointmentType[] }>(
    `/practitioners/${practitionerId}/appointment_types?per_page=50`, base, headers
  );
  const all = data.appointment_types || [];
  return all.filter(at => at.show_in_online_bookings);
}

// Use improved integration functions with sanitization
export async function findPatientByPhone(phone: string): Promise<ClinikoPatient | null> {
  return intFindPatientByPhone(phone) as Promise<ClinikoPatient | null>;
}

export async function findPatientByEmail(email: string): Promise<ClinikoPatient | null> {
  return intFindPatientByEmail(email) as Promise<ClinikoPatient | null>;
}

export async function getOrCreatePatient(params: {
  phone: string;
  fullName?: string;
  email?: string;
}): Promise<ClinikoPatient> {
  return intGetOrCreatePatient(params) as Promise<ClinikoPatient>;
}

// Export sanitization helpers for use in voice routes
export { sanitizeEmail, sanitizePhoneE164AU };

export async function getAvailability(opts?: {
  day?: string;        // e.g., "tomorrow", "monday" (optional - for future use)
  fromISO?: string;    // YYYY-MM-DD format
  toISO?: string;      // YYYY-MM-DD format
  part?: 'early' | 'late' | 'morning' | 'afternoon';
  timezone?: string;
  practitionerId?: string;
  appointmentTypeId?: string;
  businessId?: string;
  tenantCtx?: TenantContext;
  preferredTime?: { hour: number; minute: number }; // Specific time preference for sorting results
}): Promise<{ slots: Array<{ startISO: string; endISO?: string; label?: string }> }> {
  const { base, headers } = getClinikoConfig(opts?.tenantCtx);

  console.log('[Cliniko] getAvailability called with:');
  console.log('[Cliniko]   - fromISO:', opts?.fromISO);
  console.log('[Cliniko]   - toISO:', opts?.toISO);
  console.log('[Cliniko]   - part:', opts?.part);
  console.log('[Cliniko]   - practitionerId (param):', opts?.practitionerId);
  console.log('[Cliniko]   - appointmentTypeId (param):', opts?.appointmentTypeId);
  console.log('[Cliniko]   - businessId (param):', opts?.businessId);
  console.log('[Cliniko]   - tenant:', opts?.tenantCtx?.slug || 'none');

  // If no API key is available (neither tenant nor env), return demo slots
  if (!opts?.tenantCtx?.cliniko?.apiKey && !env.CLINIKO_API_KEY) {
    console.warn('[Cliniko] ⚠️  CLINIKO_API_KEY not set - returning demo slots');
    const tz = opts?.timezone || env.TZ || 'Australia/Brisbane';
    const now = dayjs().tz(tz);
    const tomorrow9am = now.add(1, 'day').hour(9).minute(0).second(0);
    const tomorrow2pm = now.add(1, 'day').hour(14).minute(0).second(0);

    return {
      slots: [
        {
          startISO: tomorrow9am.toISOString(),
          endISO: tomorrow9am.add(30, 'minute').toISOString(),
          label: 'Demo Slot 1'
        },
        {
          startISO: tomorrow2pm.toISOString(),
          endISO: tomorrow2pm.add(30, 'minute').toISOString(),
          label: 'Demo Slot 2'
        }
      ]
    };
  }

  try {
    // Use provided IDs or fallback to tenant context or environment defaults
    let businessId = opts?.businessId || env.CLINIKO_BUSINESS_ID;
    let practitionerId = opts?.practitionerId || opts?.tenantCtx?.cliniko?.practitionerId || env.CLINIKO_PRACTITIONER_ID;
    let appointmentTypeId = opts?.appointmentTypeId || opts?.tenantCtx?.cliniko?.standardApptTypeId || env.CLINIKO_APPT_TYPE_ID;
    const tz = opts?.timezone || opts?.tenantCtx?.timezone || env.TZ || 'Australia/Brisbane';

    console.log('[Cliniko] Configuration resolution:');
    console.log('[Cliniko]   - businessId:', businessId || 'NOT SET (will auto-fetch)');
    console.log('[Cliniko]   - practitionerId:', practitionerId || 'NOT SET');
    console.log('[Cliniko]   - appointmentTypeId:', appointmentTypeId || 'NOT SET');
    console.log('[Cliniko]   - timezone:', tz);

    // Auto-fetch business ID if not provided
    if (!businessId) {
      console.log('[Cliniko] 📋 Auto-fetching business ID from Cliniko API...');
      try {
        const businesses = await getBusinesses(opts?.tenantCtx);
        if (businesses.length === 0) {
          throw new Error('No businesses found in Cliniko account. Please ensure your Cliniko account has at least one business configured.');
        }
        businessId = businesses[0].id;
        console.log(`[Cliniko] ✅ Auto-selected business: ${businesses[0].name} (ID: ${businessId})`);
      } catch (fetchError: any) {
        console.error('[Cliniko] ❌ Failed to auto-fetch business ID:', fetchError.message);
        throw new Error(`Failed to fetch business ID from Cliniko: ${fetchError.message}. You can also manually set CLINIKO_BUSINESS_ID in environment variables.`);
      }
    }

    // Auto-detect practitioner if not configured
    if (!practitionerId) {
      console.log('[Cliniko] 👨‍⚕️  Practitioner ID not configured, attempting auto-detection...');
      try {
        const practitioners = await getPractitioners(opts?.tenantCtx);
        if (practitioners.length === 0) {
          const errorMsg = 'No practitioners found in Cliniko account. Please ensure you have at least one practitioner marked as "Show in online bookings" and "Active" in Cliniko settings.';
          console.error('[Cliniko] ❌', errorMsg);
          throw new Error(errorMsg);
        }
        practitionerId = practitioners[0].id;
        console.log(`[Cliniko] ✅ Auto-selected practitioner: ${practitioners[0].first_name} ${practitioners[0].last_name} (ID: ${practitionerId})`);
        if (practitioners.length > 1) {
          console.warn(`[Cliniko] ⚠️  Multiple practitioners found (${practitioners.length}). Using first one. Set CLINIKO_PRACTITIONER_ID to specify a different practitioner.`);
        }
      } catch (fetchError: any) {
        console.error('[Cliniko] ❌ Failed to auto-detect practitioner:', fetchError.message);
        throw new Error(`Missing Cliniko configuration: practitionerId could not be auto-detected. ${fetchError.message} Please set CLINIKO_PRACTITIONER_ID in environment variables or configure it in tenant settings.`);
      }
    }

    // Auto-detect appointment type if not configured
    if (!appointmentTypeId && practitionerId) {
      console.log('[Cliniko] 📅 Appointment type ID not configured, attempting auto-detection...');
      try {
        const appointmentTypes = await getAppointmentTypes(practitionerId, opts?.tenantCtx);
        if (appointmentTypes.length === 0) {
          const errorMsg = `No appointment types found for practitioner ${practitionerId}. Please ensure this practitioner has at least one appointment type marked as "Show in online bookings" in Cliniko settings.`;
          console.error('[Cliniko] ❌', errorMsg);
          throw new Error(errorMsg);
        }
        appointmentTypeId = appointmentTypes[0].id;
        console.log(`[Cliniko] ✅ Auto-selected appointment type: ${appointmentTypes[0].name} (ID: ${appointmentTypeId}, duration: ${appointmentTypes[0].duration_in_minutes}min)`);
        if (appointmentTypes.length > 1) {
          console.warn(`[Cliniko] ⚠️  Multiple appointment types found (${appointmentTypes.length}). Using first one. Set CLINIKO_APPT_TYPE_ID to specify a different type.`);
          console.log('[Cliniko] Available appointment types:', appointmentTypes.map(at => `${at.name} (${at.id})`).join(', '));
        }
      } catch (fetchError: any) {
        console.error('[Cliniko] ❌ Failed to auto-detect appointment type:', fetchError.message);
        throw new Error(`Missing Cliniko configuration: appointmentTypeId could not be auto-detected. ${fetchError.message} Please set CLINIKO_APPT_TYPE_ID in environment variables or configure it in tenant settings.`);
      }
    }

    // Final validation
    if (!practitionerId) {
      const errorMsg = 'Missing Cliniko configuration: practitionerId is required but could not be determined. Please set CLINIKO_PRACTITIONER_ID in environment variables or configure it in tenant settings.';
      console.error('[Cliniko] ❌', errorMsg);
      throw new Error(errorMsg);
    }
    if (!appointmentTypeId) {
      const errorMsg = 'Missing Cliniko configuration: appointmentTypeId is required but could not be determined. Please set CLINIKO_APPT_TYPE_ID in environment variables or configure it in tenant settings.';
      console.error('[Cliniko] ❌', errorMsg);
      throw new Error(errorMsg);
    }

    // Fetch appointment type details for duration
    const appointmentTypes = await getAppointmentTypes(practitionerId, opts?.tenantCtx);
    console.log(`[Cliniko] Found ${appointmentTypes.length} appointment types for practitioner ${practitionerId}`);
    console.log(`[Cliniko] Looking for appointment type ID: ${appointmentTypeId}`);

    const appointmentType = appointmentTypes.find(at => at.id === appointmentTypeId);

    if (!appointmentType) {
      console.error(`[Cliniko] Appointment type ${appointmentTypeId} not found in available types:`, appointmentTypes.map(at => ({ id: at.id, name: at.name })));

      // Fallback to first available appointment type if the specified one isn't found
      if (appointmentTypes.length > 0) {
        console.warn(`[Cliniko] Falling back to first available appointment type: ${appointmentTypes[0].name} (${appointmentTypes[0].id})`);
        const fallbackType = appointmentTypes[0];
        const duration = fallbackType.duration_in_minutes;

        // Continue with fallback type instead of throwing error
        const from = opts?.fromISO || new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const to = opts?.toISO || from;

        console.log(`[Cliniko] Fetching availability from=${from} to=${to} part=${opts?.part || 'any'} with fallback type`);

        const data = await clinikoGet<{ available_times: ClinikoAvailableTime[] }>(
          `/businesses/${businessId}/practitioners/${practitionerId}/appointment_types/${fallbackType.id}/available_times?from=${from}&to=${to}&per_page=50`,
          base, headers
        );

        const times = data.available_times || [];

        // Filter by part of day
        let filtered = times;
        if (opts?.part) {
          filtered = times.filter(t => {
            const d = new Date(t.appointment_start);
            const localHour = parseInt(
              d.toLocaleString('en-AU', { timeZone: tz, hour: "2-digit", hour12: false }),
              10
            );

            if (opts.part === 'morning' || opts.part === 'early') {
              return localHour >= 8 && localHour < 12;
            }
            if (opts.part === 'afternoon' || opts.part === 'late') {
              return localHour >= 12 && localHour <= 17;
            }
            return true;
          });
        }

        console.log(`[Cliniko] Found ${times.length} total slots, ${filtered.length} after ${opts?.part || 'no'} filter (using fallback type)`);

        let slots = filtered.slice(0, 50).map(t => ({
          startISO: t.appointment_start,
          endISO: dayjs(t.appointment_start).add(duration, 'minute').toISOString(),
          label: undefined
        }));

        // Sort by proximity to preferred time if provided
        if (opts?.preferredTime) {
          const preferredMinutes = opts.preferredTime.hour * 60 + opts.preferredTime.minute;
          console.log(`[Cliniko] Sorting fallback slots by proximity to preferred time: ${opts.preferredTime.hour}:${String(opts.preferredTime.minute).padStart(2, '0')}`);

          slots = slots.sort((a, b) => {
            const aTime = dayjs(a.startISO).tz(tz);
            const bTime = dayjs(b.startISO).tz(tz);

            const aMinutes = aTime.hour() * 60 + aTime.minute();
            const bMinutes = bTime.hour() * 60 + bTime.minute();

            const aDiff = Math.abs(aMinutes - preferredMinutes);
            const bDiff = Math.abs(bMinutes - preferredMinutes);

            return aDiff - bDiff;
          });
        }

        return { slots };
      }

      throw new Error(`No appointment types found for practitioner ${practitionerId}. Available types: ${appointmentTypes.length === 0 ? 'none' : appointmentTypes.map(at => at.name).join(', ')}`);
    }

    // Use provided date range or default to tomorrow
    const from = opts?.fromISO || new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const to = opts?.toISO || from;  // Same day query by default

    console.log(`[Cliniko] Fetching availability from=${from} to=${to} part=${opts?.part || 'any'}`);

    const data = await clinikoGet<{ available_times: ClinikoAvailableTime[] }>(
      `/businesses/${businessId}/practitioners/${practitionerId}/appointment_types/${appointmentTypeId}/available_times?from=${from}&to=${to}&per_page=50`,
      base, headers
    );

    const times = data.available_times || [];

    // Filter by part of day in LOCAL timezone (not UTC!)
    let filtered = times;
    if (opts?.part) {
      filtered = times.filter(t => {
        const d = new Date(t.appointment_start);
        const localHour = parseInt(
          d.toLocaleString('en-AU', { timeZone: tz, hour: "2-digit", hour12: false }),
          10
        );

        if (opts.part === 'morning' || opts.part === 'early') {
          return localHour >= 8 && localHour < 12;
        }
        if (opts.part === 'afternoon' || opts.part === 'late') {
          return localHour >= 12 && localHour <= 17;
        }
        return true;
      });
    }

    console.log(`[Cliniko] Found ${times.length} total slots, ${filtered.length} after ${opts?.part || 'no'} filter`);

    const duration = appointmentType.duration_in_minutes;
    let slots = filtered.slice(0, 50).map(t => ({
      startISO: t.appointment_start,
      endISO: dayjs(t.appointment_start).add(duration, 'minute').toISOString(),
      label: undefined
    }));

    // Sort by proximity to preferred time if provided
    if (opts?.preferredTime) {
      const preferredMinutes = opts.preferredTime.hour * 60 + opts.preferredTime.minute;
      console.log(`[Cliniko] Sorting slots by proximity to preferred time: ${opts.preferredTime.hour}:${String(opts.preferredTime.minute).padStart(2, '0')}`);

      slots = slots.sort((a, b) => {
        const aTime = dayjs(a.startISO).tz(tz);
        const bTime = dayjs(b.startISO).tz(tz);

        const aMinutes = aTime.hour() * 60 + aTime.minute();
        const bMinutes = bTime.hour() * 60 + bTime.minute();

        const aDiff = Math.abs(aMinutes - preferredMinutes);
        const bDiff = Math.abs(bMinutes - preferredMinutes);

        return aDiff - bDiff;
      });

      console.log(`[Cliniko] Top 3 closest slots to ${opts.preferredTime.hour}:${String(opts.preferredTime.minute).padStart(2, '0')}:`);
      slots.slice(0, 3).forEach((slot, idx) => {
        const slotTime = dayjs(slot.startISO).tz(tz);
        console.log(`[Cliniko]   ${idx + 1}. ${slotTime.format('h:mma, ddd MMM D')}`);
      });
    }

    return { slots };
  } catch (e) {
    console.error('[Cliniko] getAvailability error', e);
    throw e;  // Don't return fake data - let caller handle the error
  }
}

export async function createAppointmentForPatient(phone: string, payload: {
  practitionerId: string;
  appointmentTypeId: string;
  startsAt: string;
  businessId?: string;
  duration?: number;
  notes?: string;
  fullName?: string;
  email?: string;
  tenantCtx?: TenantContext;
}): Promise<ClinikoAppointment> {
  const { base, headers } = getClinikoConfig(payload.tenantCtx);

  console.log('[createAppointmentForPatient] Called with:');
  console.log('[createAppointmentForPatient]   - phone:', phone);
  console.log('[createAppointmentForPatient]   - fullName:', payload.fullName);
  console.log('[createAppointmentForPatient]   - email:', payload.email);

  const patient = await getOrCreatePatient({
    phone,
    fullName: payload.fullName,
    email: payload.email
  });

  console.log('[createAppointmentForPatient] Patient returned from getOrCreatePatient:');
  console.log('[createAppointmentForPatient]   - ID:', patient.id);
  console.log('[createAppointmentForPatient]   - Name:', patient.first_name, patient.last_name);
  console.log('[createAppointmentForPatient]   - Email:', patient.email);

  // Get business ID if not provided
  let businessId = payload.businessId;
  if (!businessId) {
    const businesses = await getBusinesses(payload.tenantCtx);
    businessId = businesses[0]?.id;
    if (!businessId) {
      throw new Error('No business found in Cliniko account');
    }
  }

  // Get appointment type duration if not provided
  let duration = payload.duration;
  if (!duration) {
    const appointmentTypes = await getAppointmentTypes(payload.practitionerId, payload.tenantCtx);
    const appointmentType = appointmentTypes.find(at => at.id === payload.appointmentTypeId);
    duration = appointmentType?.duration_in_minutes || 30; // default 30 min
  }

  // CRITICAL FIX: Compute ends_at from starts_at + duration
  const startsAt = new Date(payload.startsAt);
  const endsAt = new Date(startsAt.getTime() + duration * 60 * 1000);

  const appointment = await clinikoPost<ClinikoAppointment>('/individual_appointments', {
    business_id: businessId,
    patient_id: patient.id,
    practitioner_id: payload.practitionerId,
    appointment_type_id: payload.appointmentTypeId,
    starts_at: payload.startsAt,
    ends_at: endsAt.toISOString(),
    notes: payload.notes || null
  }, base, headers);

  return appointment;
}

export async function findPatientByPhoneRobust(e164Phone: string, tenantCtx?: TenantContext): Promise<{ id: string; first_name: string; last_name: string } | null> {
  try {
    const { base, headers } = getClinikoConfig(tenantCtx);

    // First try the standard phone lookup (uses phone_number= query param)
    const patient = await findPatientByPhone(e164Phone);
    if (patient) {
      return { id: patient.id, first_name: patient.first_name, last_name: patient.last_name };
    }

    // If not found, try q= search with digits only
    const digitsOnly = e164Phone.replace(/\D/g, '');
    console.log(`[Cliniko] Trying q= search with digits: ${digitsOnly}`);

    const data = await clinikoGet<{ patients: ClinikoPatient[] }>(`/patients?q=${digitsOnly}&per_page=50`, base, headers);
    const patients = data.patients || [];
    
    // Find the patient whose phone numbers match the end of the E.164
    for (const p of patients) {
      const phoneNumbers = p.phone_numbers || [];
      for (const pn of phoneNumbers) {
        const normalized = pn.number.replace(/\D/g, '');
        if (digitsOnly.endsWith(normalized) || normalized.endsWith(digitsOnly.slice(-9))) {
          console.log(`[Cliniko] Found patient via q= search: ${p.id}`);
          return { id: p.id, first_name: p.first_name, last_name: p.last_name };
        }
      }
    }
    
    return null;
  } catch (e) {
    console.error('[Cliniko] findPatientByPhoneRobust error', e);
    return null;
  }
}

export async function getNextUpcomingAppointment(patientId: string, tenantCtx?: TenantContext): Promise<{ id: string; practitioner_id: string; appointment_type_id: string; starts_at: string } | null> {
  try {
    const { base, headers } = getClinikoConfig(tenantCtx);
    const BUSINESS_TZ = tenantCtx?.timezone || env.TZ || 'Australia/Brisbane';
    const fromLocal = dayjs().tz(BUSINESS_TZ).format('YYYY-MM-DD');

    console.log(`[Cliniko] Fetching upcoming appointments for patient ${patientId} from ${fromLocal}`);

    const data = await clinikoGet<{ individual_appointments: ClinikoAppointment[] }>(
      `/individual_appointments?patient_id=${patientId}&from=${fromLocal}&per_page=50`,
      base, headers
    );
    
    const appointments = data.individual_appointments || [];
    const now = dayjs().tz(BUSINESS_TZ);
    
    // Find first appointment that starts in the future and is not cancelled
    for (const appt of appointments) {
      if (!appt.cancelled_at && dayjs(appt.starts_at).isAfter(now)) {
        return {
          id: appt.id,
          practitioner_id: appt.practitioner_id,
          appointment_type_id: appt.appointment_type_id,
          starts_at: appt.starts_at
        };
      }
    }
    
    return null;
  } catch (e) {
    console.error('[Cliniko] getNextUpcomingAppointment error', e);
    return null;
  }
}

export async function getPatientAppointments(phone: string): Promise<ClinikoAppointment[]> {
  try {
    const patient = await findPatientByPhone(phone);
    if (!patient) {
      return [];
    }

    // Use /appointments endpoint with from parameter (new Cliniko API)
    const BUSINESS_TZ = env.TZ || 'Australia/Brisbane';
    const todayLocalISO = dayjs().tz(BUSINESS_TZ).format('YYYY-MM-DD');

    console.log(`[Cliniko] Fetching appointments for patient ${patient.id} from ${todayLocalISO}`);

    const { base, headers } = getClinikoConfig();
    const data = await clinikoGet<{ appointments: ClinikoAppointment[] }>(
      `/appointments?patient_id=${patient.id}&from=${todayLocalISO}&per_page=50`,
      base,
      headers
    );
    
    const appointments = data.appointments || [];
    return appointments.filter(a => !a.cancelled_at && new Date(a.starts_at) > new Date());
  } catch (e) {
    console.error('[Cliniko] getPatientAppointments error', e);
    return [];
  }
}

export async function cancelAppointment(appointmentId: string): Promise<void> {
  try {
    const { base, headers } = getClinikoConfig();
    await clinikoPatch(`/individual_appointments/${appointmentId}/cancel`, {}, base, headers);
  } catch (e) {
    console.error('[Cliniko] cancelAppointment error', e);
    throw e;
  }
}

export async function rescheduleAppointment(appointmentId: string, newStartsAt: string, patientId?: string, practitionerId?: string, appointmentTypeId?: string): Promise<ClinikoAppointment> {
  try {
    // Try PATCH first (standard reschedule endpoint)
    console.log(`[Cliniko] Attempting PATCH reschedule for ${appointmentId} to ${newStartsAt}`);
    const { base, headers } = getClinikoConfig();
    const appointment = await clinikoPatch<ClinikoAppointment>(
      `/individual_appointments/${appointmentId}`,
      { starts_at: newStartsAt },
      base,
      headers
    );
    console.log(`[Cliniko] PATCH reschedule successful`);
    return appointment;
  } catch (e: any) {
    const status = e.message?.match(/(\d{3})/)?.[1];
    console.error(`[Cliniko] rescheduleAppointment PATCH error (status: ${status || 'unknown'}):`, e);
    
    // If PATCH fails with 405 or similar, try DELETE + POST fallback
    if (status === '405' || status === '404' || status === '501') {
      console.log(`[Cliniko] PATCH unsupported (${status}), trying DELETE + POST fallback`);
      
      try {
        const { base, headers } = getClinikoConfig();

        // First get the original appointment details if we don't have them
        if (!patientId || !practitionerId || !appointmentTypeId) {
          const originalAppt = await clinikoGet<ClinikoAppointment>(`/individual_appointments/${appointmentId}`, base, headers);
          patientId = patientId || originalAppt.patient_id;
          practitionerId = practitionerId || originalAppt.practitioner_id;
          appointmentTypeId = appointmentTypeId || originalAppt.appointment_type_id;
        }

        // Cancel the old appointment
        console.log(`[Cliniko] Cancelling original appointment ${appointmentId}`);
        await clinikoPatch(`/individual_appointments/${appointmentId}/cancel`, {}, base, headers);

        // Create new appointment at the new time
        console.log(`[Cliniko] Creating new appointment at ${newStartsAt}`);
        const businessId = env.CLINIKO_BUSINESS_ID;
        const duration = 30; // Default duration, could be parameterized
        const endsAt = dayjs(newStartsAt).add(duration, 'minute');

        const newAppt = await clinikoPost<ClinikoAppointment>('/individual_appointments', {
          business_id: businessId,
          patient_id: patientId,
          practitioner_id: practitionerId,
          appointment_type_id: appointmentTypeId,
          starts_at: newStartsAt,
          ends_at: endsAt.toISOString()
        }, base, headers);
        
        console.log(`[Cliniko] DELETE + POST fallback successful: ${newAppt.id}`);
        return newAppt;
      } catch (fallbackErr) {
        console.error('[Cliniko] DELETE + POST fallback also failed:', fallbackErr);
        throw fallbackErr;
      }
    }
    
    // For other errors, just throw
    throw e;
  }
}
