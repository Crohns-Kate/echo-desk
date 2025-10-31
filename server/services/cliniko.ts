import fetch from 'node-fetch';
import { env } from '../utils/env';

const base = env.CLINIKO_BASE_URL;
const headers = {
  'Accept': 'application/json',
  'Authorization': `Basic ${Buffer.from(env.CLINIKO_API_KEY + ':').toString('base64')}`
};

export async function getAvailability(opts?: { dayIso?: string, part?: 'early'|'late'|'morning'|'afternoon' }) {
  // TODO: Implement actual Cliniko queries for practitioners & appointment types per tenant
  // For MVP, return two pseudo slots (ISO strings) as placeholders
  const now = new Date();
  const in1h = new Date(now.getTime() + 60*60*1000).toISOString();
  const in2h = new Date(now.getTime() + 2*60*60*1000).toISOString();
  
  return [
    { startIso: in1h, practitionerId: 1, appointmentTypeId: 1 },
    { startIso: in2h, practitionerId: 1, appointmentTypeId: 1 },
  ];
}

export async function createAppointmentForPatient(phone: string, payload: {
  practitionerId: number,
  appointmentTypeId: number,
  startsAt: string,
  notes?: string,
  idempotencyKey?: string,
  fullName?: string,
  email?: string,
}) {
  // TODO: Implement actual Cliniko create appointment
  // For MVP, return mock appointment
  console.log('[Cliniko] Would create appointment:', { phone, ...payload });
  
  return {
    id: 'mock-apt-' + Date.now(),
    starts_at: payload.startsAt,
    patient_id: phone,
  };
}
