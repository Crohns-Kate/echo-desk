import { sql } from "drizzle-orm";
import { pgTable, serial, text, boolean, timestamp, integer, jsonb, varchar, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// ============================================================================
// USERS & AUTHENTICATION
// ============================================================================

// Users table - authentication for tenant admins and super admins
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("tenant_admin"), // 'super_admin', 'tenant_admin', 'tenant_staff'
  name: text("name"),
  isActive: boolean("is_active").default(true),
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: text("email_verification_token"),
  passwordResetToken: text("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires"),
  mustChangePassword: boolean("must_change_password").default(false),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sessions table - for express-session with connect-pg-simple
export const sessions = pgTable("sessions", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => ({
  expireIdx: index("idx_sessions_expire").on(table.expire),
}));

// Audit log - tracks changes for security and debugging
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  tenantId: integer("tenant_id").references(() => tenants.id),
  action: text("action").notNull(), // 'login', 'logout', 'update_settings', 'create_faq', etc.
  entityType: text("entity_type"), // 'tenant', 'faq', 'user', etc.
  entityId: integer("entity_id"),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// PHONE NUMBER POOL
// ============================================================================

// Phone number pool - pre-provisioned Twilio numbers for instant assignment
export const phoneNumberPool = pgTable("phone_number_pool", {
  id: serial("id").primaryKey(),
  phoneNumber: text("phone_number").notNull().unique(),
  twilioPhoneSid: text("twilio_phone_sid").notNull(),
  areaCode: text("area_code"), // '02', '03', '07', '08'
  status: text("status").notNull().default("available"), // 'available', 'assigned', 'releasing'
  tenantId: integer("tenant_id").references(() => tenants.id),
  assignedAt: timestamp("assigned_at"),
  releasedAt: timestamp("released_at"),
  quarantineEndsAt: timestamp("quarantine_ends_at"), // When number can be reused
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  statusAreaCodeIdx: index("idx_phone_pool_status_area").on(table.status, table.areaCode),
}));

// ============================================================================
// TENANTS (existing table with new columns)
// ============================================================================

// Tenants table - multi-tenant support for different clinics
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  clinicName: text("clinic_name").notNull(),

  // Contact Info
  phoneNumber: text("phone_number").unique(), // Twilio phone number (E.164)
  email: text("email"),
  address: text("address"),
  googleMapsUrl: text("google_maps_url"), // Google Maps link for directions

  // Timezone
  timezone: text("timezone").notNull().default("Australia/Brisbane"),

  // Voice Configuration
  voiceName: text("voice_name").default("Polly.Olivia-Neural"),
  greeting: text("greeting").notNull().default("Thanks for calling"),
  fallbackMessage: text("fallback_message"),

  // Business Hours (JSON)
  businessHours: jsonb("business_hours").default(sql`'{}'::jsonb`),

  // Clinic Settings (for knowledge base and voice responses)
  parkingText: text("parking_text"),
  servicesText: text("services_text"),
  firstVisitText: text("first_visit_text"),
  aboutText: text("about_text"),
  healthText: text("health_text"),
  faqJson: jsonb("faq_json").default(sql`'[]'::jsonb`),

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
  subscriptionTier: text("subscription_tier").default("trial"), // trial, starter, pro, enterprise
  subscriptionStatus: text("subscription_status").default("trialing"), // trialing, active, past_due, canceled
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  trialEndsAt: timestamp("trial_ends_at"), // When 7-day trial expires
  trialExtensionCount: integer("trial_extension_count").default(0), // Max 2 extensions

  // Phone Setup
  phoneSetupType: text("phone_setup_type").default("pending"), // pending, provisioned, forwarding
  twilioPhoneSid: text("twilio_phone_sid"), // SID of assigned Twilio number
  forwardingSourceNumber: text("forwarding_source_number"), // Their original number (if forwarding)
  forwardingSchedule: text("forwarding_schedule").default("after_hours"), // after_hours, busy, always

  // Onboarding Progress
  onboardingCompleted: boolean("onboarding_completed").default(false),
  onboardingStep: integer("onboarding_step").default(0), // 0-8
  activatedAt: timestamp("activated_at"), // When AI was first activated

  // Extended Business Details
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressPostcode: text("address_postcode"),
  websiteUrl: text("website_url"),

  // Notification Preferences
  alertEmails: text("alert_emails").array(), // Multiple alert recipients
  weeklyReportEnabled: boolean("weekly_report_enabled").default(true),
  afterHoursMessage: text("after_hours_message"),
  holdMessage: text("hold_message"),

  // Handoff Configuration
  handoffMode: text("handoff_mode").default("callback"), // 'transfer' | 'callback' | 'sms_only'
  handoffPhone: text("handoff_phone"), // Phone number for transfer (E.164 format)
  afterHoursMode: text("after_hours_mode").default("callback"), // 'transfer' | 'callback' | 'sms_only'
  handoffSmsTemplate: text("handoff_sms_template").default("Hi, you requested a callback from {{clinic_name}}. We'll call you back shortly."),

  // Metadata
  isActive: boolean("is_active").default(false), // Default false until onboarding complete
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Practitioners - supports multiple practitioners per tenant
export const practitioners = pgTable("practitioners", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),

  // Practitioner details
  name: text("name").notNull(),  // Display name, e.g., "Dr Michael Smith"
  clinikoPractitionerId: text("cliniko_practitioner_id"),  // Cliniko practitioner ID

  // Scheduling
  isActive: boolean("is_active").default(true),
  isDefault: boolean("is_default").default(false),  // Primary practitioner for this tenant
  schedule: jsonb("schedule").default(sql`'{}'::jsonb`),  // Working days/hours JSON

  // Metadata
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
  // Handoff tracking
  handoffTriggered: boolean("handoff_triggered").default(false),
  handoffReason: text("handoff_reason"),
  handoffMode: text("handoff_mode"), // 'transfer' | 'callback' | 'sms_only'
  handoffStatus: text("handoff_status"), // 'pending' | 'transferred' | 'failed' | 'callback_requested' | 'completed'
  handoffTarget: text("handoff_target"), // Phone number or callback info
  handoffNotes: text("handoff_notes"),
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

  // Analytics
  usageCount: integer("usage_count").default(0), // Track how many times used
  lastUsedAt: timestamp("last_used_at"), // When last accessed

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
}));

export const tenantsRelations = relations(tenants, ({ many }) => ({
  callLogs: many(callLogs),
  alerts: many(alerts),
  conversations: many(conversations),
  users: many(users),
  phoneNumbers: many(phoneNumberPool),
  practitioners: many(practitioners),
}));

export const practitionersRelations = relations(practitioners, ({ one }) => ({
  tenant: one(tenants, {
    fields: [practitioners.tenantId],
    references: [tenants.id],
  }),
}));

export const phoneNumberPoolRelations = relations(phoneNumberPool, ({ one }) => ({
  tenant: one(tenants, {
    fields: [phoneNumberPool.tenantId],
    references: [tenants.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, {
    fields: [auditLog.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [auditLog.tenantId],
    references: [tenants.id],
  }),
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

export const insertPractitionerSchema = createInsertSchema(practitioners).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
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

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({
  id: true,
  createdAt: true,
});

export const insertPhoneNumberPoolSchema = createInsertSchema(phoneNumberPool).omit({
  id: true,
  createdAt: true,
});

// ============================================================================
// TYPES
// ============================================================================

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

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export type PhoneNumberPoolEntry = typeof phoneNumberPool.$inferSelect;
export type InsertPhoneNumberPoolEntry = z.infer<typeof insertPhoneNumberPoolSchema>;

export type Session = typeof sessions.$inferSelect;

// User roles enum for type safety
export type UserRole = 'super_admin' | 'tenant_admin' | 'tenant_staff';

// Subscription tiers enum
export type SubscriptionTier = 'trial' | 'starter' | 'pro' | 'enterprise';

// Phone pool status enum
export type PhonePoolStatus = 'available' | 'assigned' | 'releasing';
