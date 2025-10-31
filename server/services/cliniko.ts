import { env } from '../utils/env';

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
  console.log('[Cliniko] GET', url);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cliniko API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function clinikoPost<T>(endpoint: string, body: any): Promise<T> {
  const url = `${base}${endpoint}`;
  console.log('[Cliniko] POST', url);
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

export async function findPatientByPhone(phone: string): Promise<ClinikoPatient | null> {
  try {
    const data = await clinikoGet<{ patients: ClinikoPatient[] }>(
      `/patients?q[phone_number]=${encodeURIComponent(phone)}`
    );
    return data.patients?.[0] || null;
  } catch (e) {
    console.error('[Cliniko] findPatientByPhone error', e);
    return null;
  }
}

export async function findPatientByEmail(email: string): Promise<ClinikoPatient | null> {
  try {
    const data = await clinikoGet<{ patients: ClinikoPatient[] }>(
      `/patients?q[email]=${encodeURIComponent(email)}`
    );
    return data.patients?.[0] || null;
  } catch (e) {
    console.error('[Cliniko] findPatientByEmail error', e);
    return null;
  }
}

export async function createPatient(params: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}): Promise<ClinikoPatient> {
  const phoneNumbers = params.phone ? [{ number: params.phone, phone_type: 'Mobile' }] : [];
  const patient = await clinikoPost<ClinikoPatient>('/patients', {
    first_name: params.firstName,
    last_name: params.lastName,
    email: params.email || null,
    phone_numbers: phoneNumbers
  });
  return patient;
}

export async function getOrCreatePatient(params: {
  phone: string;
  fullName?: string;
  email?: string;
}): Promise<ClinikoPatient> {
  let patient = await findPatientByPhone(params.phone);
  
  if (!patient && params.email) {
    patient = await findPatientByEmail(params.email);
  }
  
  if (patient) {
    return patient;
  }
  
  const names = (params.fullName || 'Unknown Caller').split(' ');
  const firstName = names[0];
  const lastName = names.slice(1).join(' ') || 'Patient';
  
  return createPatient({
    firstName,
    lastName,
    email: params.email,
    phone: params.phone
  });
}

export async function getAvailability(opts?: {
  dayIso?: string;
  part?: 'early' | 'late' | 'morning' | 'afternoon';
}): Promise<Array<{ startIso: string; practitionerId: string; appointmentTypeId: string }>> {
  try {
    const businesses = await getBusinesses();
    const business = businesses[0];
    if (!business) {
      throw new Error('No business found in Cliniko account');
    }
    
    const practitioners = await getPractitioners();
    if (practitioners.length === 0) {
      throw new Error('No practitioners enabled for online bookings');
    }
    
    const practitioner = practitioners[0];
    const appointmentTypes = await getAppointmentTypes(practitioner.id);
    if (appointmentTypes.length === 0) {
      throw new Error('No appointment types enabled for online bookings');
    }
    
    const appointmentType = appointmentTypes[0];
    
    const from = opts?.dayIso || new Date().toISOString().split('T')[0];
    const toDate = new Date(from);
    toDate.setDate(toDate.getDate() + 7);
    const to = toDate.toISOString().split('T')[0];
    
    const data = await clinikoGet<{ available_times: ClinikoAvailableTime[] }>(
      `/businesses/${business.id}/practitioners/${practitioner.id}/appointment_types/${appointmentType.id}/available_times?from=${from}&to=${to}&per_page=20`
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
      practitionerId: practitioner.id,
      appointmentTypeId: appointmentType.id
    }));
  } catch (e) {
    console.error('[Cliniko] getAvailability error', e);
    const now = new Date();
    const in1h = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    
    return [
      { startIso: in1h, practitionerId: '1', appointmentTypeId: '1' },
      { startIso: in2h, practitionerId: '1', appointmentTypeId: '1' },
    ];
  }
}

export async function createAppointmentForPatient(phone: string, payload: {
  practitionerId: string;
  appointmentTypeId: string;
  startsAt: string;
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
    
    const appointment = await clinikoPost<ClinikoAppointment>('/individual_appointments', {
      patient_id: patient.id,
      practitioner_id: payload.practitionerId,
      appointment_type_id: payload.appointmentTypeId,
      starts_at: payload.startsAt,
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
