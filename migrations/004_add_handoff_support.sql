-- Migration 004: Add handoff support for human transfer
-- Adds handoff fields to call_logs and tenant settings

-- ============================================================================
-- CALL LOGS: Add handoff tracking fields
-- ============================================================================
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS handoff_triggered BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS handoff_reason TEXT,
  ADD COLUMN IF NOT EXISTS handoff_mode TEXT, -- 'transfer' | 'callback' | 'sms_only'
  ADD COLUMN IF NOT EXISTS handoff_status TEXT, -- 'pending' | 'transferred' | 'failed' | 'callback_requested' | 'completed'
  ADD COLUMN IF NOT EXISTS handoff_target TEXT, -- Phone number or callback info
  ADD COLUMN IF NOT EXISTS handoff_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_call_logs_handoff_triggered ON call_logs(handoff_triggered);
CREATE INDEX IF NOT EXISTS idx_call_logs_handoff_status ON call_logs(handoff_status);

-- ============================================================================
-- TENANTS: Add handoff configuration fields
-- ============================================================================
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS handoff_mode TEXT DEFAULT 'callback', -- 'transfer' | 'callback' | 'sms_only'
  ADD COLUMN IF NOT EXISTS handoff_phone TEXT, -- Phone number for transfer (E.164 format)
  ADD COLUMN IF NOT EXISTS after_hours_mode TEXT DEFAULT 'callback', -- 'transfer' | 'callback' | 'sms_only'
  ADD COLUMN IF NOT EXISTS handoff_sms_template TEXT DEFAULT 'Hi, you requested a callback from {{clinic_name}}. We''ll call you back shortly.';

-- ============================================================================
-- ALERTS: Add callback request type
-- ============================================================================
-- Note: alerts.reason already supports 'human_request', we'll use 'callback_requested' for callback queue
