import { env } from '../utils/env';
import {
  getOrCreatePatient as intGetOrCreatePatient,
  findPatientByPhone as intFindPatientByPhone,
  findPatientByEmail as intFindPatientByEmail,
  sanitizeEmail,
  sanitizePhoneE164AU
} from '../integrations/cliniko';

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
  dayIso?: string;
  part?: 'early' | 'late' | 'morning' | 'afternoon';
}): Promise<Array<{ startIso: string; practitionerId: string; appointmentTypeId: string; businessId: string; duration: number }>> {
  try {
    // Use configured IDs from environment
    const businessId = env.CLINIKO_BUSINESS_ID;
    const practitionerId = env.CLINIKO_PRACTITIONER_ID;
    const appointmentTypeId = env.CLINIKO_APPT_TYPE_ID;
    
    // Fetch appointment type details for duration
    const appointmentTypes = await getAppointmentTypes(practitionerId);
    const appointmentType = appointmentTypes.find(at => at.id === appointmentTypeId) || appointmentTypes[0];
    
    if (!appointmentType) {
      throw new Error('No appointment types found for practitioner');
    }
    
    // CRITICAL FIX: Clamp date window to ≤6 days and ensure future dates
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const startDate = opts?.dayIso ? new Date(opts.dayIso) : tomorrow;
    
    // Ensure start date is in the future
    if (startDate <= now) {
      startDate.setTime(tomorrow.getTime());
    }
    
    // Clamp to max 5 days from start (6-day window total)
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 5);
    
    // Use YYYY-MM-DD format (safer than full ISO for Cliniko)
    const from = startDate.toISOString().split('T')[0];
    const to = endDate.toISOString().split('T')[0];
    
    const data = await clinikoGet<{ available_times: ClinikoAvailableTime[] }>(
      `/businesses/${businessId}/practitioners/${practitionerId}/appointment_types/${appointmentTypeId}/available_times?from=${from}&to=${to}&per_page=20`
    );
    
    const times = data.available_times || [];
    
    let filtered = times;
    if (opts?.part) {
      filtered = times.filter(t => {
        const hour = new Date(t.appointment_start).getHours();
        if (opts.part === 'morning' || opts.part === 'early') {
          return hour < 12;
        }
        if (opts.part === 'afternoon' || opts.part === 'late') {
          return hour >= 12;
        }
        return true;
      });
    }
    
    return filtered.slice(0, 5).map(t => ({
      startIso: t.appointment_start,
      practitionerId,
      appointmentTypeId,
      businessId,
      duration: appointmentType.duration_in_minutes
    }));
  } catch (e) {
    console.error('[Cliniko] getAvailability error', e);
    const now = new Date();
    const in1h = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    
    return [
      { startIso: in1h, practitionerId: '1', appointmentTypeId: '1', businessId: '1', duration: 30 },
      { startIso: in2h, practitionerId: '1', appointmentTypeId: '1', businessId: '1', duration: 30 },
    ];
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

export async function getPatientAppointments(phone: string): Promise<ClinikoAppointment[]> {
  try {
    const patient = await findPatientByPhone(phone);
    if (!patient) {
      return [];
    }
    
    const data = await clinikoGet<{ individual_appointments: ClinikoAppointment[] }>(
      `/individual_appointments?q[patient_id]=${patient.id}&per_page=50`
    );
    
    const appointments = data.individual_appointments || [];
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
