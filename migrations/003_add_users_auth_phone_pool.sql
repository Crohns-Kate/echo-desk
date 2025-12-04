-- Migration 003: Add users, sessions, phone pool, and audit log tables
-- Also adds new columns to tenants table for onboarding

-- ============================================================================
-- USERS TABLE (Authentication)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'tenant_admin', -- 'super_admin', 'tenant_admin', 'tenant_staff'
  name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_token TEXT,
  password_reset_token TEXT,
  password_reset_expires TIMESTAMP,
  must_change_password BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for quick email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- ============================================================================
-- SESSIONS TABLE (express-session with connect-pg-simple)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

-- ============================================================================
-- AUDIT LOG TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  tenant_id INTEGER REFERENCES tenants(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- ============================================================================
-- PHONE NUMBER POOL TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS phone_number_pool (
  id SERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,
  twilio_phone_sid TEXT NOT NULL,
  area_code TEXT,
  status TEXT NOT NULL DEFAULT 'available', -- 'available', 'assigned', 'releasing'
  tenant_id INTEGER REFERENCES tenants(id),
  assigned_at TIMESTAMP,
  released_at TIMESTAMP,
  quarantine_ends_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_pool_status_area ON phone_number_pool(status, area_code);
CREATE INDEX IF NOT EXISTS idx_phone_pool_tenant ON phone_number_pool(tenant_id);

-- ============================================================================
-- ADD NEW COLUMNS TO TENANTS TABLE
-- ============================================================================

-- Subscription/Billing enhancements
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS trial_extension_count INTEGER DEFAULT 0;

-- Update subscription_tier default to 'trial'
-- Note: This only affects new rows, existing rows keep their values

-- Phone Setup columns
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS phone_setup_type TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS twilio_phone_sid TEXT,
  ADD COLUMN IF NOT EXISTS forwarding_source_number TEXT,
  ADD COLUMN IF NOT EXISTS forwarding_schedule TEXT DEFAULT 'after_hours';

-- Onboarding Progress columns
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP;

-- Extended Business Details
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS address_street TEXT,
  ADD COLUMN IF NOT EXISTS address_city TEXT,
  ADD COLUMN IF NOT EXISTS address_state TEXT,
  ADD COLUMN IF NOT EXISTS address_postcode TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT;

-- Notification Preferences
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS alert_emails TEXT[],
  ADD COLUMN IF NOT EXISTS weekly_report_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS after_hours_message TEXT,
  ADD COLUMN IF NOT EXISTS hold_message TEXT;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================
COMMENT ON TABLE users IS 'User accounts for authentication - tenant admins and super admins';
COMMENT ON TABLE sessions IS 'Express session storage for authenticated users';
COMMENT ON TABLE audit_log IS 'Tracks all changes for security and debugging';
COMMENT ON TABLE phone_number_pool IS 'Pre-provisioned Twilio numbers for instant tenant assignment';

COMMENT ON COLUMN users.role IS 'super_admin = all access, tenant_admin = their tenant only, tenant_staff = view only';
COMMENT ON COLUMN phone_number_pool.status IS 'available = ready to assign, assigned = in use, releasing = in quarantine';
COMMENT ON COLUMN tenants.phone_setup_type IS 'pending = not set up, provisioned = has Twilio number, forwarding = uses forwarded calls';
COMMENT ON COLUMN tenants.trial_extension_count IS 'Max 2 extensions allowed (21 days total trial)';
