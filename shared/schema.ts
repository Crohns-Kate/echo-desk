import { sql } from "drizzle-orm";
import { pgTable, serial, text, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Tenants table - multi-tenant support for different clinics
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  clinicName: text("clinic_name").notNull(),

  // Contact Info
  phoneNumber: text("phone_number").unique(), // Twilio phone number (E.164)
  email: text("email"),
  address: text("address"),

  // Timezone
  timezone: text("timezone").notNull().default("Australia/Brisbane"),

  // Voice Configuration
  voiceName: text("voice_name").default("Polly.Olivia-Neural"),
  greeting: text("greeting").notNull().default("Thanks for calling"),
  fallbackMessage: text("fallback_message"),

  // Business Hours (JSON)
  businessHours: jsonb("business_hours").default(sql`'{}'::jsonb`),

  // Cliniko Integration
  clinikoApiKeyEncrypted: text("cliniko_api_key_encrypted"),
  clinikoShard: text("cliniko_shard").default("au1"),
  clinikoPractitionerId: text("cliniko_practitioner_id"),
  clinikoStandardApptTypeId: text("cliniko_standard_appt_type_id"),
  clinikoNewPatientApptTypeId: text("cliniko_new_patient_appt_type_id"),

  // Feature Flags
  recordingEnabled: boolean("recording_enabled").default(true),
  transcriptionEnabled: boolean("transcription_enabled").default(true),
  qaAnalysisEnabled: boolean("qa_analysis_enabled").default(true),
  faqEnabled: boolean("faq_enabled").default(true),
  smsEnabled: boolean("sms_enabled").default(true),

  // Subscription/Billing
  subscriptionTier: text("subscription_tier").default("free"), // free, starter, pro, enterprise
  subscriptionStatus: text("subscription_status").default("active"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),

  // Metadata
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Phone mapping - stores caller identity (tenant-scoped)
export const phoneMap = pgTable("phone_map", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  phone: text("phone").notNull(),
  fullName: text("full_name"),
  email: text("email"),
  patientId: text("patient_id"), // Cliniko patient IDs are TEXT
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Leads - tracking phone numbers
export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  optedOut: boolean("opted_out").default(false),
  optOutDate: timestamp("opt_out_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Conversations - tracks multi-turn interactions
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  leadId: integer("lead_id"),
  isVoice: boolean("is_voice").default(true),
  state: text("state").default("active"),
  context: jsonb("context").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
});

// Call logs - comprehensive call history
export const callLogs = pgTable("call_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  conversationId: integer("conversation_id"),
  callSid: text("call_sid"),
  fromNumber: text("from_number"),
  toNumber: text("to_number"),
  intent: text("intent"),
  summary: text("summary"),
  recordingSid: text("recording_sid"),
  recordingUrl: text("recording_url"),
  recordingStatus: text("recording_status"),
  transcript: text("transcript"),
  duration: integer("duration"), // in seconds
  createdAt: timestamp("created_at").defaultNow(),
});

// Alerts - notifications for receptionist
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  conversationId: integer("conversation_id"),
  reason: text("reason"), // 'human_request' | 'booking_failed' | etc
  payload: jsonb("payload"),
  status: text("status").default("open"), // 'open' | 'dismissed'
  createdAt: timestamp("created_at").defaultNow(),
});

// Appointments - tracks booked appointments for reschedule/cancel lookup (tenant-scoped)
export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  phone: text("phone").notNull(),
  patientId: text("patient_id"), // Cliniko patient ID
  clinikoAppointmentId: text("cliniko_appointment_id").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  status: text("status").default("scheduled"), // 'scheduled' | 'rescheduled' | 'cancelled'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// QA Reports - stores detailed quality analysis for each call (tenant-scoped)
export const qaReports = pgTable("qa_reports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  callSid: text("call_sid").notNull().unique(),
  callLogId: integer("call_log_id"),
  identityDetectionScore: integer("identity_detection_score"), // 0-10
  patientClassificationScore: integer("patient_classification_score"), // 0-10
  emailCaptureScore: integer("email_capture_score"), // 0-10
  appointmentTypeScore: integer("appointment_type_score"), // 0-10
  promptClarityScore: integer("prompt_clarity_score"), // 0-10
  overallScore: integer("overall_score"), // 0-10
  issues: jsonb("issues").default(sql`'[]'::jsonb`), // Array of detected issues
  createdAt: timestamp("created_at").defaultNow(),
});

// FAQs - knowledge base for common questions
export const faqs = pgTable("faqs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  category: text("category").notNull(), // 'hours', 'location', 'parking', 'billing', etc.
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  keywords: text("keywords").array(), // For keyword matching
  priority: integer("priority").default(0), // Higher = more important
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const tenantsRelations = relations(tenants, ({ many }) => ({
  callLogs: many(callLogs),
  alerts: many(alerts),
  conversations: many(conversations),
}));

export const conversationsRelations = relations(conversations, ({ one }) => ({
  tenant: one(tenants, {
    fields: [conversations.tenantId],
    references: [tenants.id],
  }),
}));

export const callLogsRelations = relations(callLogs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [callLogs.tenantId],
    references: [tenants.id],
  }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [alerts.tenantId],
    references: [tenants.id],
  }),
}));

// Insert schemas
export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
});

export const insertPhoneMapSchema = createInsertSchema(phoneMap).omit({
  id: true,
  updatedAt: true,
});

export const insertCallLogSchema = createInsertSchema(callLogs).omit({
  id: true,
  createdAt: true,
});

export const insertAlertSchema = createInsertSchema(alerts).omit({
  id: true,
  createdAt: true,
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertQaReportSchema = createInsertSchema(qaReports).omit({
  id: true,
  createdAt: true,
});

export const insertFaqSchema = createInsertSchema(faqs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

export type PhoneMap = typeof phoneMap.$inferSelect;
export type InsertPhoneMap = z.infer<typeof insertPhoneMapSchema>;

export type Lead = typeof leads.$inferSelect;

export type Conversation = typeof conversations.$inferSelect;

export type CallLog = typeof callLogs.$inferSelect;
export type InsertCallLog = z.infer<typeof insertCallLogSchema>;

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = z.infer<typeof insertAlertSchema>;

export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;

export type QaReport = typeof qaReports.$inferSelect;
export type InsertQaReport = z.infer<typeof insertQaReportSchema>;

export type Faq = typeof faqs.$inferSelect;
export type InsertFaq = z.infer<typeof insertFaqSchema>;
