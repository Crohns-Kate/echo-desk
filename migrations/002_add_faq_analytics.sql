-- Migration: Add FAQ analytics fields
-- Run with: psql "$DATABASE_URL" -f migrations/002_add_faq_analytics.sql

-- Add usage_count column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'faqs' AND column_name = 'usage_count') THEN
        ALTER TABLE faqs ADD COLUMN usage_count INTEGER DEFAULT 0;
        RAISE NOTICE 'Added usage_count column';
    ELSE
        RAISE NOTICE 'usage_count column already exists';
    END IF;
END $$;

-- Add last_used_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'faqs' AND column_name = 'last_used_at') THEN
        ALTER TABLE faqs ADD COLUMN last_used_at TIMESTAMP;
        RAISE NOTICE 'Added last_used_at column';
    ELSE
        RAISE NOTICE 'last_used_at column already exists';
    END IF;
END $$;

-- Verify the columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'faqs'
AND column_name IN ('usage_count', 'last_used_at')
ORDER BY column_name;
