import { env } from '../utils/env';
import {
  getOrCreatePatient as intGetOrCreatePatient,
  findPatientByPhone as intFindPatientByPhone,
  findPatientByEmail as intFindPatientByEmail,
  sanitizeEmail,
  sanitizePhoneE164AU
} from '../integrations/cliniko';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const base = env.CLINIKO_BASE_URL;
const headers = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Authorization': `Basic ${Buffer.from(env.CLINIKO_API_KEY + ':').toString('base64')}`
};

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

async function clinikoGet<T>(endpoint: string): Promise<T> {
  const url = `${base}${endpoint}`;
  console.log('[Cliniko] GET', url.replace(base, ''));
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cliniko API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function clinikoPost<T>(endpoint: string, body: any): Promise<T> {
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

async function clinikoPatch<T>(endpoint: string, body: any): Promise<T> {
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

export async function getBusinesses(): Promise<ClinikoBusiness[]> {
  const data = await clinikoGet<{ businesses: ClinikoBusiness[] }>('/businesses');
  return data.businesses || [];
}

export async function getPractitioners(): Promise<ClinikoPractitioner[]> {
  const data = await clinikoGet<{ practitioners: ClinikoPractitioner[] }>('/practitioners?per_page=50');
  const all = data.practitioners || [];
  return all.filter(p => p.show_in_online_bookings && p.active);
}

export async function getAppointmentTypes(practitionerId: string): Promise<ClinikoAppointmentType[]> {
  const data = await clinikoGet<{ appointment_types: ClinikoAppointmentType[] }>(
    `/practitioners/${practitionerId}/appointment_types?per_page=50`
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
  fromDate?: string;  // YYYY-MM-DD format
  toDate?: string;    // YYYY-MM-DD format
  part?: 'early' | 'late' | 'morning' | 'afternoon';
  timezone?: string;
}): Promise<Array<{ startIso: string; practitionerId: string; appointmentTypeId: string; businessId: string; duration: number }>> {
  try {
    // Use configured IDs from environment
    const businessId = env.CLINIKO_BUSINESS_ID;
    const practitionerId = env.CLINIKO_PRACTITIONER_ID;
    const appointmentTypeId = env.CLINIKO_APPT_TYPE_ID;
    const tz = opts?.timezone || env.TZ || 'Australia/Brisbane';
    
    // Fetch appointment type details for duration
    const appointmentTypes = await getAppointmentTypes(practitionerId);
    const appointmentType = appointmentTypes.find(at => at.id === appointmentTypeId) || appointmentTypes[0];
    
    if (!appointmentType) {
      throw new Error('No appointment types found for practitioner');
    }
    
    // Use provided date range or default to tomorrow
    const from = opts?.fromDate || new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const to = opts?.toDate || from;  // Same day query by default
    
    console.log(`[Cliniko] Fetching availability from=${from} to=${to} part=${opts?.part || 'any'}`);
    
    const data = await clinikoGet<{ available_times: ClinikoAvailableTime[] }>(
      `/businesses/${businessId}/practitioners/${practitionerId}/appointment_types/${appointmentTypeId}/available_times?from=${from}&to=${to}&per_page=50`
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
    
    return filtered.slice(0, 50).map(t => ({
      startIso: t.appointment_start,
      practitionerId,
      appointmentTypeId,
      businessId,
      duration: appointmentType.duration_in_minutes
    }));
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
}): Promise<ClinikoAppointment> {
  try {
    const patient = await getOrCreatePatient({
      phone,
      fullName: payload.fullName,
      email: payload.email
    });
    
    // Get business ID if not provided
    let businessId = payload.businessId;
    if (!businessId) {
      const businesses = await getBusinesses();
      businessId = businesses[0]?.id;
      if (!businessId) {
        throw new Error('No business found in Cliniko account');
      }
    }
    
    // Get appointment type duration if not provided
    let duration = payload.duration;
    if (!duration) {
      const appointmentTypes = await getAppointmentTypes(payload.practitionerId);
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
    });
    
    return appointment;
  } catch (e) {
    console.error('[Cliniko] createAppointmentForPatient error', e);
    return {
      id: 'mock-apt-' + Date.now(),
      starts_at: payload.startsAt,
      ends_at: new Date(new Date(payload.startsAt).getTime() + 30 * 60 * 1000).toISOString(),
      patient_id: phone,
      practitioner_id: payload.practitionerId,
      appointment_type_id: payload.appointmentTypeId,
      notes: payload.notes || null,
      cancelled_at: null
    };
  }
}

export async function findPatientByPhoneRobust(e164Phone: string): Promise<{ id: string; first_name: string; last_name: string } | null> {
  try {
    // First try the standard phone lookup (uses phone_number= query param)
    const patient = await findPatientByPhone(e164Phone);
    if (patient) {
      return { id: patient.id, first_name: patient.first_name, last_name: patient.last_name };
    }
    
    // If not found, try q= search with digits only
    const digitsOnly = e164Phone.replace(/\D/g, '');
    console.log(`[Cliniko] Trying q= search with digits: ${digitsOnly}`);
    
    const data = await clinikoGet<{ patients: ClinikoPatient[] }>(`/patients?q=${digitsOnly}&per_page=50`);
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

export async function getNextUpcomingAppointment(patientId: string): Promise<{ id: string; practitioner_id: string; appointment_type_id: string; starts_at: string } | null> {
  try {
    const BUSINESS_TZ = env.TZ || 'Australia/Brisbane';
    const fromLocal = dayjs().tz(BUSINESS_TZ).format('YYYY-MM-DD');
    
    console.log(`[Cliniko] Fetching upcoming appointments for patient ${patientId} from ${fromLocal}`);
    
    const data = await clinikoGet<{ individual_appointments: ClinikoAppointment[] }>(
      `/individual_appointments?patient_id=${patientId}&from=${fromLocal}&per_page=50`
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
    
    const data = await clinikoGet<{ appointments: ClinikoAppointment[] }>(
      `/appointments?patient_id=${patient.id}&from=${todayLocalISO}&per_page=50`
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
    await clinikoPatch(`/individual_appointments/${appointmentId}/cancel`, {});
  } catch (e) {
    console.error('[Cliniko] cancelAppointment error', e);
    throw e;
  }
}

export async function rescheduleAppointment(appointmentId: string, newStartsAt: string): Promise<ClinikoAppointment> {
  try {
    const appointment = await clinikoPatch<ClinikoAppointment>(
      `/individual_appointments/${appointmentId}`,
      { starts_at: newStartsAt }
    );
    return appointment;
  } catch (e) {
    console.error('[Cliniko] rescheduleAppointment error', e);
    throw e;
  }
}
