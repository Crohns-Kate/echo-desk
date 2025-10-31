// Referenced from blueprint:javascript_database
import { 
  tenants, 
  phoneMap, 
  conversations, 
  callLogs, 
  alerts,
  type Tenant, 
  type PhoneMap,
  type Conversation,
  type CallLog,
  type Alert,
  type InsertTenant,
  type InsertPhoneMap,
  type InsertCallLog,
  type InsertAlert
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";

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

  // Stats
  getStats(tenantId?: number): Promise<{
    activeCalls: number;
    pendingAlerts: number;
    todayCalls: number;
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
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const allAlerts = await this.listAlerts(tenantId, 1000);
    const pendingAlerts = allAlerts.filter(a => a.status === 'open').length;

    const allCalls = await this.listCalls(tenantId, 1000);
    const todayCalls = allCalls.filter(c => 
      c.createdAt && new Date(c.createdAt) >= today
    ).length;

    return {
      activeCalls: 0, // Would need real-time tracking via Twilio Status Callbacks
      pendingAlerts,
      todayCalls,
    };
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
