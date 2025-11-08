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
  greeting: text("greeting").notNull().default("Hello and welcome"),
  timezone: text("timezone").notNull().default("Australia/Brisbane"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Phone mapping - stores caller identity
export const phoneMap = pgTable("phone_map", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  fullName: text("full_name"),
  email: text("email"),
  patientId: text("patient_id"), // Cliniko patient IDs are TEXT
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

// Appointments - tracks booked appointments for reschedule/cancel lookup
export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  patientId: text("patient_id"), // Cliniko patient ID
  clinikoAppointmentId: text("cliniko_appointment_id").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  status: text("status").default("scheduled"), // 'scheduled' | 'rescheduled' | 'cancelled'
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
