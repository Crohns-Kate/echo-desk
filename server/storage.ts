// Referenced from blueprint:javascript_database
import {
  tenants,
  phoneMap,
  conversations,
  callLogs,
  alerts,
  appointments,
  qaReports,
  faqs,
  type Tenant,
  type PhoneMap,
  type Conversation,
  type CallLog,
  type Alert,
  type Appointment,
  type QaReport,
  type Faq,
  type InsertTenant,
  type InsertPhoneMap,
  type InsertCallLog,
  type InsertAlert,
  type InsertAppointment,
  type InsertQaReport,
  type InsertFaq
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, gt } from "drizzle-orm";

export interface IStorage {
  // Tenants
  getTenant(slug: string): Promise<Tenant | undefined>;
  getTenantByPhone(phoneNumber: string): Promise<Tenant | undefined>;
  getTenantById(id: number): Promise<Tenant | undefined>;
  listTenants(): Promise<Tenant[]>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenant(id: number, updates: Partial<InsertTenant>): Promise<Tenant | undefined>;

  // Phone mapping
  getPhoneMap(phone: string): Promise<PhoneMap | undefined>;
  upsertPhoneMap(data: InsertPhoneMap): Promise<PhoneMap>;

  // Conversations
  createConversation(tenantId: number, leadId?: number, isVoice?: boolean): Promise<Conversation>;
  getConversation(id: number): Promise<Conversation | undefined>;
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

  // QA Reports
  saveQaReport(data: InsertQaReport): Promise<QaReport>;
  getQaReportByCallSid(callSid: string): Promise<QaReport | undefined>;
  listQaReports(limit?: number): Promise<QaReport[]>;

  // FAQs
  createFaq(data: InsertFaq): Promise<Faq>;
  updateFaq(id: number, updates: Partial<InsertFaq>): Promise<Faq | undefined>;
  deleteFaq(id: number): Promise<boolean>;
  getFaqById(id: number): Promise<Faq | undefined>;
  listFaqs(tenantId?: number, activeOnly?: boolean): Promise<Faq[]>;
  searchFaqs(query: string, tenantId?: number): Promise<Faq[]>;
  trackFaqUsage(id: number): Promise<void>;

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

  async getTenantByPhone(phoneNumber: string): Promise<Tenant | undefined> {
    if (!phoneNumber) return undefined;
    const [tenant] = await db.select().from(tenants)
      .where(eq(tenants.phoneNumber, phoneNumber))
      .limit(1);
    return tenant || undefined;
  }

  async getTenantById(id: number): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return tenant || undefined;
  }

  async listTenants(): Promise<Tenant[]> {
    return db.select().from(tenants).orderBy(tenants.clinicName);
  }

  async createTenant(insertTenant: InsertTenant): Promise<Tenant> {
    const [tenant] = await db.insert(tenants).values(insertTenant).returning();
    return tenant;
  }

  async updateTenant(id: number, updates: Partial<InsertTenant>): Promise<Tenant | undefined> {
    const [tenant] = await db.update(tenants)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    return tenant || undefined;
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

  async saveQaReport(data: InsertQaReport): Promise<QaReport> {
    const [qaReport] = await db
      .insert(qaReports)
      .values(data)
      .onConflictDoUpdate({
        target: qaReports.callSid,
        set: {
          identityDetectionScore: data.identityDetectionScore,
          patientClassificationScore: data.patientClassificationScore,
          emailCaptureScore: data.emailCaptureScore,
          appointmentTypeScore: data.appointmentTypeScore,
          promptClarityScore: data.promptClarityScore,
          overallScore: data.overallScore,
          issues: data.issues,
        },
      })
      .returning();
    return qaReport;
  }

  async getQaReportByCallSid(callSid: string): Promise<QaReport | undefined> {
    const [qaReport] = await db
      .select()
      .from(qaReports)
      .where(eq(qaReports.callSid, callSid))
      .limit(1);
    return qaReport || undefined;
  }

  async listQaReports(limit: number = 50): Promise<QaReport[]> {
    return db
      .select()
      .from(qaReports)
      .orderBy(desc(qaReports.createdAt))
      .limit(limit);
  }

  async createFaq(data: InsertFaq): Promise<Faq> {
    const [faq] = await db
      .insert(faqs)
      .values(data)
      .returning();
    return faq;
  }

  async updateFaq(id: number, updates: Partial<InsertFaq>): Promise<Faq | undefined> {
    const [faq] = await db
      .update(faqs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(faqs.id, id))
      .returning();
    return faq || undefined;
  }

  async deleteFaq(id: number): Promise<boolean> {
    const result = await db
      .delete(faqs)
      .where(eq(faqs.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getFaqById(id: number): Promise<Faq | undefined> {
    const [faq] = await db
      .select()
      .from(faqs)
      .where(eq(faqs.id, id))
      .limit(1);
    return faq || undefined;
  }

  async listFaqs(tenantId?: number, activeOnly: boolean = true): Promise<Faq[]> {
    const conditions = [];

    if (tenantId) {
      conditions.push(eq(faqs.tenantId, tenantId));
    }

    if (activeOnly) {
      conditions.push(eq(faqs.isActive, true));
    }

    const query = conditions.length > 0
      ? db.select().from(faqs).where(and(...conditions))
      : db.select().from(faqs);

    return query.orderBy(desc(faqs.priority), faqs.category);
  }

  async searchFaqs(query: string, tenantId?: number): Promise<Faq[]> {
    const searchLower = query.toLowerCase();

    // Get all FAQs (filtered by tenant if specified)
    const allFaqs = await this.listFaqs(tenantId, true);

    // Remove common stop words for better matching
    const stopWords = new Set(['what', 'is', 'are', 'the', 'your', 'my', 'do', 'does', 'can', 'i', 'you', 'a', 'an']);
    const queryWords = searchLower.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));

    // Score each FAQ with enhanced semantic matching
    const scored = allFaqs.map(faq => {
      let score = 0;
      const faqQuestion = faq.question.toLowerCase();
      const faqAnswer = faq.answer.toLowerCase();
      const faqCategory = faq.category.toLowerCase();

      // Exact phrase match in question (highest priority)
      if (faqQuestion.includes(searchLower)) {
        score += 20;
      }

      // Word-level matching
      for (const word of queryWords) {
        // Keywords get highest word-level weight
        if (faq.keywords && faq.keywords.length > 0) {
          for (const keyword of faq.keywords) {
            const kwLower = keyword.toLowerCase();
            if (kwLower === word) {
              score += 15; // Exact keyword match
            } else if (kwLower.includes(word) || word.includes(kwLower)) {
              score += 7; // Partial keyword match
            }
          }
        }

        // Category matching
        if (faqCategory === word || faqCategory.includes(word)) {
          score += 12;
        }

        // Answer matching (lower weight - less relevant)
        if (faqAnswer.includes(word)) {
          score += 2;
        }

        // Question word matching
        if (faqQuestion.includes(word)) {
          score += 5;
        }
      }

      // Exact phrase in answer (medium priority)
      if (faqAnswer.includes(searchLower)) {
        score += 10;
      }

      // Apply priority multiplier (priority 0-100 => multiplier 1.0-2.0)
      const priorityMultiplier = 1 + ((faq.priority || 0) / 100);
      score = Math.round(score * priorityMultiplier);

      return { faq, score };
    });

    // Filter by score > 0 and sort by score descending
    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.faq);
  }

  async trackFaqUsage(id: number): Promise<void> {
    await db
      .update(faqs)
      .set({
        usageCount: sql`${faqs.usageCount} + 1`,
        lastUsedAt: new Date(),
      })
      .where(eq(faqs.id, id));
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
