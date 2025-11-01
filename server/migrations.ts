import { Pool } from 'pg';

interface MigrationStep {
  id: string;
  sql: string[];
}

interface MigrationResult {
  executed: string[];
  skipped: string[];
  timings: Record<string, number>;
}

interface RunMigrationsOptions {
  client: Pool;
  logger?: typeof console;
  dryRun?: boolean;
}

// All migrations must be idempotent using IF NOT EXISTS
const migrations: MigrationStep[] = [
  {
    id: '2025-11-01-create-schema-migrations',
    sql: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        executed_at timestamptz NOT NULL DEFAULT now()
      )`
    ]
  },
  {
    id: '2025-11-01-create-tenants',
    sql: [
      `CREATE TABLE IF NOT EXISTS tenants (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        clinic_name text NOT NULL,
        greeting text NOT NULL DEFAULT 'Hello and welcome',
        timezone text NOT NULL DEFAULT 'Australia/Brisbane',
        created_at timestamptz DEFAULT now()
      )`
    ]
  },
  {
    id: '2025-11-01-create-phone-map',
    sql: [
      `CREATE TABLE IF NOT EXISTS phone_map (
        id serial PRIMARY KEY,
        phone text NOT NULL UNIQUE,
        full_name text,
        email text,
        patient_id text,
        updated_at timestamptz DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_phone_map_phone ON phone_map (phone)`,
      `CREATE INDEX IF NOT EXISTS idx_phone_map_email ON phone_map (email)`
    ]
  },
  {
    id: '2025-11-01-create-leads',
    sql: [
      `CREATE TABLE IF NOT EXISTS leads (
        id serial PRIMARY KEY,
        phone text NOT NULL,
        opted_out boolean DEFAULT false,
        opt_out_date timestamptz,
        created_at timestamptz DEFAULT now()
      )`
    ]
  },
  {
    id: '2025-11-01-create-conversations',
    sql: [
      `CREATE TABLE IF NOT EXISTS conversations (
        id serial PRIMARY KEY,
        tenant_id integer REFERENCES tenants(id),
        lead_id integer,
        is_voice boolean DEFAULT true,
        state text DEFAULT 'active',
        context jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_conversations_tenant_id ON conversations (tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations (created_at)`
    ]
  },
  {
    id: '2025-11-01-create-call-logs',
    sql: [
      `CREATE TABLE IF NOT EXISTS call_logs (
        id serial PRIMARY KEY,
        tenant_id integer REFERENCES tenants(id),
        conversation_id integer,
        call_sid text,
        from_number text,
        to_number text,
        intent text,
        summary text,
        recording_url text,
        transcript text,
        duration integer,
        created_at timestamptz DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_call_logs_call_sid ON call_logs (call_sid)`,
      `CREATE INDEX IF NOT EXISTS idx_call_logs_tenant_id ON call_logs (tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON call_logs (created_at)`
    ]
  },
  {
    id: '2025-11-01-create-alerts',
    sql: [
      `CREATE TABLE IF NOT EXISTS alerts (
        id serial PRIMARY KEY,
        tenant_id integer REFERENCES tenants(id),
        conversation_id integer,
        reason text,
        payload jsonb,
        status text DEFAULT 'open',
        created_at timestamptz DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_alerts_tenant_id ON alerts (tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts (status)`
    ]
  },
  {
    id: '2025-11-01-create-appointments',
    sql: [
      `CREATE TABLE IF NOT EXISTS appointments (
        id serial PRIMARY KEY,
        phone text NOT NULL,
        patient_id text,
        cliniko_appointment_id text NOT NULL,
        starts_at timestamptz NOT NULL,
        status text DEFAULT 'scheduled',
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments (phone)`,
      `CREATE INDEX IF NOT EXISTS idx_appointments_cliniko_id ON appointments (cliniko_appointment_id)`,
      `CREATE INDEX IF NOT EXISTS idx_appointments_starts_at ON appointments (starts_at)`
    ]
  }
];

export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationResult> {
  const { client, logger = console, dryRun = false } = options;
  
  const result: MigrationResult = {
    executed: [],
    skipped: [],
    timings: {}
  };

  try {
    logger.log('[MIGRATIONS] Starting migration process...');
    
    // Ensure schema_migrations table exists (outside transaction for safety)
    if (!dryRun) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id text PRIMARY KEY,
          executed_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    }

    // Get already executed migrations
    const executedResult = await client.query('SELECT id FROM schema_migrations');
    const executedIds = new Set(executedResult.rows.map((row: any) => row.id));

    // Process each migration
    for (const migration of migrations) {
      if (executedIds.has(migration.id)) {
        result.skipped.push(migration.id);
        logger.log(`[MIGRATIONS] ⏭️  Skipping ${migration.id} (already executed)`);
        continue;
      }

      if (dryRun) {
        logger.log(`[MIGRATIONS] 🔍 DRY RUN: Would execute ${migration.id}`);
        logger.log(`   SQL steps: ${migration.sql.length}`);
        result.executed.push(migration.id);
        continue;
      }

      // Execute migration in transaction
      const startTime = Date.now();
      logger.log(`[MIGRATIONS] 🚀 Executing ${migration.id}...`);

      try {
        await client.query('BEGIN');

        // Execute all SQL statements in the migration
        for (const sql of migration.sql) {
          await client.query(sql);
        }

        // Record migration as executed
        await client.query(
          'INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
          [migration.id]
        );

        await client.query('COMMIT');

        const duration = Date.now() - startTime;
        result.timings[migration.id] = duration;
        result.executed.push(migration.id);
        logger.log(`[MIGRATIONS] ✅ Completed ${migration.id} (${duration}ms)`);
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`[MIGRATIONS] ❌ Failed ${migration.id}:`, error);
        throw error;
      }
    }

    logger.log('[MIGRATIONS] Migration process complete');
    logger.log(`  Executed: ${result.executed.length}`);
    logger.log(`  Skipped: ${result.skipped.length}`);

    return result;
  } catch (error) {
    logger.error('[MIGRATIONS] Fatal error during migration:', error);
    throw error;
  }
}
