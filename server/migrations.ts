/**
 * Database Migrations
 * Runs schema updates on server startup
 */

import { pool } from "./db";

interface Migration {
  name: string;
  sql: string;
}

// List of migrations to run (idempotent - safe to run multiple times)
const migrations: Migration[] = [
  {
    name: "add_google_maps_url_to_tenants",
    sql: `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS google_maps_url TEXT;`,
  },
  {
    name: "create_practitioners_table",
    sql: `
      CREATE TABLE IF NOT EXISTS practitioners (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        cliniko_practitioner_id TEXT,
        is_active BOOLEAN DEFAULT true,
        is_default BOOLEAN DEFAULT false,
        schedule JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `,
  },
  {
    name: "add_handoff_support",
    sql: `
      -- CALL LOGS: Add handoff tracking fields
      ALTER TABLE call_logs
        ADD COLUMN IF NOT EXISTS handoff_triggered BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS handoff_reason TEXT,
        ADD COLUMN IF NOT EXISTS handoff_mode TEXT,
        ADD COLUMN IF NOT EXISTS handoff_status TEXT,
        ADD COLUMN IF NOT EXISTS handoff_target TEXT,
        ADD COLUMN IF NOT EXISTS handoff_notes TEXT;

      CREATE INDEX IF NOT EXISTS idx_call_logs_handoff_triggered ON call_logs(handoff_triggered);
      CREATE INDEX IF NOT EXISTS idx_call_logs_handoff_status ON call_logs(handoff_status);

      -- TENANTS: Add handoff configuration fields
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS handoff_mode TEXT DEFAULT 'callback',
        ADD COLUMN IF NOT EXISTS handoff_phone TEXT,
        ADD COLUMN IF NOT EXISTS after_hours_mode TEXT DEFAULT 'callback',
        ADD COLUMN IF NOT EXISTS handoff_sms_template TEXT DEFAULT 'Hi, you requested a callback from {{clinic_name}}. We''ll call you back shortly.';
    `,
  },
];

/**
 * Run all pending migrations
 * All migrations are idempotent (safe to run multiple times)
 */
export async function runMigrations(): Promise<void> {
  console.log("[Migrations] Running database migrations...");

  const client = await pool.connect();

  try {
    for (const migration of migrations) {
      try {
        await client.query(migration.sql);
        console.log(`[Migrations] ✓ ${migration.name}`);
      } catch (error: any) {
        // Ignore "already exists" errors for idempotent migrations
        if (error.code === "42701" || error.code === "42P07") {
          console.log(`[Migrations] ✓ ${migration.name} (already exists)`);
        } else {
          throw error;
        }
      }
    }
    console.log("[Migrations] All migrations completed successfully");
  } finally {
    client.release();
  }
}
