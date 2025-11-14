// Referenced from blueprint:javascript_database
import { 
  tenants, 
  phoneMap, 
  conversations, 
  callLogs, 
  alerts,
  appointments,
  type Tenant, 
  type PhoneMap,
  type Conversation,
  type CallLog,
  type Alert,
  type Appointment,
  type InsertTenant,
  type InsertPhoneMap,
  type InsertCallLog,
  type InsertAlert,
  type InsertAppointment
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, gt } from "drizzle-orm";

export interface IStorage {
  // Tenants
  getTenant(slug: string): Promise<Tenant | undefined>;
  listTenants(): Promise<Tenant[]>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;

  // Phone mapping
  getPhoneMap(phone: string): Promise<PhoneMap | undefined>;
  upsertPhoneMap(data: InsertPhoneMap): Promise<PhoneMap>;

  // Conversations
  createConversation(tenantId: number, leadId?: number, isVoice?: boolean): Promise<Conversation>;
  updateConversation(id: number, updates: Partial<Conversation>): Promise<Conversation | undefined>;

  // Call logs
  logCall(data: InsertCallLog): Promise<CallLog>;
  updateCall(callSid: string, updates: Partial<CallLog>): Promise<CallLog | undefined>;
  listCalls(tenantId?: number, limit?: number): Promise<CallLog[]>;
  getCallById(id: number): Promise<CallLog | undefined>;
  getCallByCallSid(callSid: string): Promise<CallLog | undefined>;

  // Alerts
  createAlert(data: InsertAlert): Promise<Alert>;
  listAlerts(tenantId?: number, limit?: number): Promise<Alert[]>;
  dismissAlert(id: number): Promise<Alert | undefined>;

  // Appointments
  saveAppointment(data: InsertAppointment): Promise<Appointment>;
  findUpcomingByPhone(phone: string): Promise<Appointment | undefined>;
  updateAppointmentStatus(id: number, status: string): Promise<Appointment | undefined>;

  // Stats
  getStats(tenantId?: number): Promise<{
    activeCalls: number;
    pendingAlerts: number;
    todayCalls: number;
    calls7d: number;
    bookings: number;
    cancels: number;
    errors: number;
  }>;

  // Seed
  seed(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getTenant(slug: string = 'default'): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return tenant || undefined;
  }

  async listTenants(): Promise<Tenant[]> {
    return db.select().from(tenants).orderBy(tenants.clinicName);
  }

  async createTenant(insertTenant: InsertTenant): Promise<Tenant> {
    const [tenant] = await db.insert(tenants).values(insertTenant).returning();
    return tenant;
  }

  async getPhoneMap(phone: string): Promise<PhoneMap | undefined> {
    const [map] = await db.select().from(phoneMap).where(eq(phoneMap.phone, phone)).limit(1);
    return map || undefined;
  }

  async upsertPhoneMap(data: InsertPhoneMap): Promise<PhoneMap> {
    const [map] = await db
      .insert(phoneMap)
      .values(data)
      .onConflictDoUpdate({
        target: phoneMap.phone,
        set: {
          fullName: data.fullName,
          email: data.email,
          patientId: data.patientId,
          updatedAt: new Date(),
        },
      })
      .returning();
    return map;
  }

  async createConversation(tenantId: number, leadId?: number, isVoice: boolean = true): Promise<Conversation> {
    const [conversation] = await db
      .insert(conversations)
      .values({ tenantId, leadId: leadId || null, isVoice })
      .returning();
    return conversation;
  }

  async updateConversation(id: number, updates: Partial<Conversation>): Promise<Conversation | undefined> {
    const [conversation] = await db
      .update(conversations)
      .set(updates)
      .where(eq(conversations.id, id))
      .returning();
    return conversation || undefined;
  }

  async getConversation(id: number): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    return conversation || undefined;
  }

  async logCall(data: InsertCallLog): Promise<CallLog> {
    const [call] = await db.insert(callLogs).values(data).returning();
    return call;
  }

  async updateCall(callSid: string, updates: Partial<CallLog>): Promise<CallLog | undefined> {
    const [call] = await db
      .update(callLogs)
      .set(updates)
      .where(eq(callLogs.callSid, callSid))
      .returning();
    return call || undefined;
  }

  async listCalls(tenantId?: number, limit: number = 50): Promise<CallLog[]> {
    if (tenantId) {
      return db
        .select()
        .from(callLogs)
        .where(eq(callLogs.tenantId, tenantId))
        .orderBy(desc(callLogs.createdAt))
        .limit(limit);
    }
    return db.select().from(callLogs).orderBy(desc(callLogs.createdAt)).limit(limit);
  }

  async getCallById(id: number): Promise<CallLog | undefined> {
    const [call] = await db.select().from(callLogs).where(eq(callLogs.id, id)).limit(1);
    return call || undefined;
  }

  async getCallByCallSid(callSid: string): Promise<CallLog | undefined> {
    const [call] = await db.select().from(callLogs).where(eq(callLogs.callSid, callSid)).limit(1);
    return call || undefined;
  }

  async createAlert(data: InsertAlert): Promise<Alert> {
    const [alert] = await db.insert(alerts).values(data).returning();
    return alert;
  }

  async listAlerts(tenantId?: number, limit: number = 50): Promise<Alert[]> {
    if (tenantId) {
      return db
        .select()
        .from(alerts)
        .where(eq(alerts.tenantId, tenantId))
        .orderBy(desc(alerts.createdAt))
        .limit(limit);
    }
    return db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(limit);
  }

  async dismissAlert(id: number): Promise<Alert | undefined> {
    const [alert] = await db
      .update(alerts)
      .set({ status: 'dismissed' })
      .where(eq(alerts.id, id))
      .returning();
    return alert || undefined;
  }

  async getStats(tenantId?: number): Promise<{
    activeCalls: number;
    pendingAlerts: number;
    todayCalls: number;
    calls7d: number;
    bookings: number;
    cancels: number;
    errors: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Fast aggregated queries
    const [callsTodayResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(callLogs)
      .where(
        and(
          tenantId ? eq(callLogs.tenantId, tenantId) : undefined,
          gt(callLogs.createdAt, today)
        )
      );

    const [calls7dResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(callLogs)
      .where(
        and(
          tenantId ? eq(callLogs.tenantId, tenantId) : undefined,
          gt(callLogs.createdAt, sevenDaysAgo)
        )
      );

    const [bookingsResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(callLogs)
      .where(
        and(
          tenantId ? eq(callLogs.tenantId, tenantId) : undefined,
          sql`${callLogs.intent} LIKE '%book%'`
        )
      );

    const [cancelsResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(callLogs)
      .where(
        and(
          tenantId ? eq(callLogs.tenantId, tenantId) : undefined,
          sql`${callLogs.intent} LIKE '%cancel%'`
        )
      );

    const [errorsResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(alerts)
      .where(
        and(
          tenantId ? eq(alerts.tenantId, tenantId) : undefined,
          sql`${alerts.reason} IN ('cliniko_error', 'booking_failed')`
        )
      );

    const [pendingAlertsResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(alerts)
      .where(
        and(
          tenantId ? eq(alerts.tenantId, tenantId) : undefined,
          eq(alerts.status, 'open')
        )
      );

    return {
      activeCalls: 0, // Active calls would require real-time tracking via Twilio API
      pendingAlerts: Number(pendingAlertsResult?.count ?? 0),
      todayCalls: Number(callsTodayResult?.count ?? 0),
      calls7d: Number(calls7dResult?.count ?? 0),
      bookings: Number(bookingsResult?.count ?? 0),
      cancels: Number(cancelsResult?.count ?? 0),
      errors: Number(errorsResult?.count ?? 0),
    };
  }

  async saveAppointment(data: InsertAppointment): Promise<Appointment> {
    const [appointment] = await db.insert(appointments).values(data).returning();
    return appointment;
  }

  async findUpcomingByPhone(phone: string): Promise<Appointment | undefined> {
    const now = new Date();
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.phone, phone),
          eq(appointments.status, 'scheduled'),
          gt(appointments.startsAt, now)
        )
      )
      .orderBy(appointments.startsAt)
      .limit(1);
    return appointment || undefined;
  }

  async updateAppointmentStatus(id: number, status: string): Promise<Appointment | undefined> {
    const [appointment] = await db
      .update(appointments)
      .set({ status, updatedAt: new Date() })
      .where(eq(appointments.id, id))
      .returning();
    return appointment || undefined;
  }

  async seed(): Promise<void> {
    // Check if default tenant exists
    const existing = await this.getTenant('default');
    if (!existing) {
      await this.createTenant({
        slug: 'default',
        clinicName: 'Your Clinic',
        greeting: 'Hello and welcome to Your Clinic.',
        timezone: 'Australia/Brisbane',
      });
      console.log('[DB] Seeded default tenant');
    }
  }
}

export const storage = new DatabaseStorage();
