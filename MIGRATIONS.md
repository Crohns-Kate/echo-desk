# 🔒 Safe Database Migrations Guide

This application uses a **manual, idempotent migration system** to prevent data loss and deployment failures.

## 🚨 Quick Start: Prevent Deployment Failures

### Step 1: Set These Environment Variables

In Replit → Secrets, add:

```bash
RUN_MIGRATIONS_ON_BOOT=false
ADMIN_TOKEN=<generate-a-secure-random-string>
```

**Important:** Set `RUN_MIGRATIONS_ON_BOOT=false` to prevent automatic migrations during deployment.

### Step 2: Generate a Secure Admin Token

```bash
# Run this in the Shell to generate a random token:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and save it as your `ADMIN_TOKEN` secret.

---

## 📋 Two-Phase Deployment Process

Every time you deploy changes that include database schema updates:

### Phase A: Deploy Code (Without Migrations)

1. ✅ Ensure `RUN_MIGRATIONS_ON_BOOT=false` in Secrets
2. ✅ Publish your app (click the **Deploy** button)
3. ✅ Wait for deployment to complete

### Phase B: Run Migrations Manually

1. **Dry Run First** (see what would execute):
   ```
   GET https://your-app.replit.app/__admin/migrate/dry-run?token=YOUR_ADMIN_TOKEN
   ```

2. **Execute Migrations**:
   ```
   POST https://your-app.replit.app/__admin/migrate?token=YOUR_ADMIN_TOKEN
   ```

3. **Verify** your app works correctly

---

## 🔧 Admin Endpoints

### Health Check
```bash
GET /__admin/health
```
Returns system status (no authentication required).

**Example Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-01T12:00:00.000Z",
  "env": "production",
  "migrationsEnabled": false
}
```

### Dry Run (Preview Migrations)
```bash
GET /__admin/migrate/dry-run?token=YOUR_ADMIN_TOKEN
```
Shows which migrations would run **without executing them**.

**Example Response:**
```json
{
  "success": true,
  "dryRun": true,
  "result": {
    "wouldExecute": [
      "2025-11-01-create-appointments"
    ],
    "wouldSkip": [
      "2025-11-01-create-tenants",
      "2025-11-01-create-phone-map",
      "2025-11-01-create-calls"
    ],
    "totalSteps": 4
  },
  "message": "Dry run complete. No changes were made to the database."
}
```

### Execute Migrations
```bash
POST /__admin/migrate?token=YOUR_ADMIN_TOKEN
```
Runs pending migrations in a **transaction** (safe and atomic).

**Example Response:**
```json
{
  "success": true,
  "result": {
    "executed": ["2025-11-01-create-appointments"],
    "skipped": ["2025-11-01-create-tenants", "..."],
    "timings": {
      "2025-11-01-create-appointments": "45ms"
    },
    "totalTime": "52ms"
  },
  "message": "Successfully executed 1 migration(s)"
}
```

---

## 🛡️ Safety Features

### ✅ Idempotent Migrations
All migrations use `IF NOT EXISTS` - safe to run multiple times.

```sql
CREATE TABLE IF NOT EXISTS appointments (...);
CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments (phone);
```

### ✅ Transactional
Each migration runs in a **transaction** - all-or-nothing execution.

```javascript
BEGIN;
  CREATE TABLE ...;
  CREATE INDEX ...;
  INSERT INTO schema_migrations ...;
COMMIT;
```

If any step fails → **automatic rollback** (no partial changes).

### ✅ Tracked Execution
The `schema_migrations` table tracks which migrations have run:

```sql
SELECT * FROM schema_migrations;
```
```
| id                                  | executed_at              |
|-------------------------------------|--------------------------|
| 2025-11-01-create-tenants          | 2025-11-01 10:00:00+00   |
| 2025-11-01-create-phone-map        | 2025-11-01 10:00:05+00   |
```

### ✅ Re-runnable
If deployment restarts mid-migration, you can safely re-run:
```bash
POST /__admin/migrate?token=YOUR_ADMIN_TOKEN
```
Already-executed migrations will be **skipped automatically**.

---

## 🔐 Security

### Admin Token Protection
All migration endpoints require authentication:

```bash
# ❌ Without token - returns 401
POST /__admin/migrate

# ✅ With valid token - executes
POST /__admin/migrate?token=YOUR_ADMIN_TOKEN
```

### Token Storage
**Never** commit `ADMIN_TOKEN` to git. Always store in Replit Secrets.

---

## 📝 Adding New Migrations

### Step 1: Create Migration

Edit `server/migrations.ts` and add a new migration step:

```typescript
{
  id: '2025-11-05-add-user-preferences',
  sql: [
    `CREATE TABLE IF NOT EXISTS user_preferences (
      id serial PRIMARY KEY,
      user_id text NOT NULL,
      theme text DEFAULT 'light',
      created_at timestamptz DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id 
     ON user_preferences (user_id)`
  ]
}
```

### Step 2: Update Drizzle Schema

Edit `shared/schema.ts`:

```typescript
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  theme: text("theme").default("light"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### Step 3: Deploy Using Two-Phase Process

1. Publish app (migrations disabled)
2. Run `GET /__admin/migrate/dry-run?token=...`
3. Run `POST /__admin/migrate?token=...`
4. Verify app works

---

## ⚠️ Migration Rules

### ✅ DO:
- ✅ **Add** new tables with `CREATE TABLE IF NOT EXISTS`
- ✅ **Add** new columns with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- ✅ **Add** indexes with `CREATE INDEX IF NOT EXISTS`
- ✅ **Use** default values for new NOT NULL columns
- ✅ **Test** in development first

### ❌ DON'T:
- ❌ **Remove** columns (code may still reference them)
- ❌ **Rename** tables or columns (breaks existing queries)
- ❌ **Change** column types (e.g., `text` → `integer`)
- ❌ **Remove** default values from existing columns
- ❌ **Drop** tables with existing data

### If You Need to Remove Something:

**Option 1: Deprecate First (Recommended)**
1. Deploy code that **stops using** the column
2. Wait 1 week (verify no errors)
3. Create a manual cleanup script

**Option 2: Two-Step Migration**
1. Migration 1: Make column nullable + add default
2. Deploy code that handles both states
3. Migration 2: Remove column (weeks later)

---

## 🐛 Troubleshooting

### "Invalid admin token"
**Solution:** Check that your `ADMIN_TOKEN` secret matches the token in your request URL.

```bash
# Verify in Replit Secrets that ADMIN_TOKEN is set
echo $ADMIN_TOKEN
```

### "Migration failed: table already exists"
**Solution:** This shouldn't happen with `IF NOT EXISTS`. Check your migration SQL.

### "Port already in use" error
**Solution:** 
```bash
# Kill existing process
pkill -f "tsx server/index.ts"
```

### Migrations running on every boot
**Solution:** Set `RUN_MIGRATIONS_ON_BOOT=false` in Secrets.

---

## 📊 Backup Strategy

### Before Major Migrations:

1. **Create Neon Branch** (instant snapshot):
   - Go to Neon Console
   - Click "Branches" → "Create Branch"
   - Name it: `prod-backup-YYYY-MM-DD`

2. **Export SQL Dump** (optional):
   ```bash
   pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
   ```

---

## 🎯 Best Practices Summary

1. **Always set** `RUN_MIGRATIONS_ON_BOOT=false` in production
2. **Always test** migrations in development first
3. **Always use** the two-phase deploy process
4. **Always run** dry-run before executing migrations
5. **Always backup** before major schema changes
6. **Only add** (never remove) in migrations
7. **Use transactions** (already built-in)
8. **Keep migrations idempotent** (use `IF NOT EXISTS`)

---

## 📚 Example Workflow

```bash
# 1. Make schema changes in development
# Edit: server/migrations.ts + shared/schema.ts

# 2. Test locally
npm run dev

# 3. Verify migrations work
GET http://localhost:5000/__admin/migrate/dry-run?token=dev-token

# 4. Deploy to production
# (with RUN_MIGRATIONS_ON_BOOT=false)
git push
# Click "Deploy" in Replit

# 5. Check production health
GET https://your-app.replit.app/__admin/health

# 6. Preview migrations
GET https://your-app.replit.app/__admin/migrate/dry-run?token=YOUR_PROD_TOKEN

# 7. Execute migrations
POST https://your-app.replit.app/__admin/migrate?token=YOUR_PROD_TOKEN

# 8. Verify app works
# Open your app and test key features

# 9. Monitor logs
# Check Replit → Publishing → Logs tab
```

---

## 🆘 Emergency Rollback

If something goes wrong after migration:

### Option 1: Neon Branch Restore
1. Go to Neon Console
2. Find your backup branch (`prod-backup-YYYY-MM-DD`)
3. Promote it to primary

### Option 2: SQL Restore
```bash
psql $DATABASE_URL < backup-YYYYMMDD.sql
```

---

## 📞 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review the Replit Publishing → Logs tab
3. Run health check: `GET /__admin/health`
4. Check migration status: `GET /__admin/migrate/dry-run?token=...`

---

**Remember:** With `RUN_MIGRATIONS_ON_BOOT=false`, you're in full control. No surprises, no data loss! 🎉
