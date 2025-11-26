-- Migration: Add tenant knowledge fields
-- Run with: psql "$DATABASE_URL" -f migrations/001_add_tenant_knowledge_fields.sql

-- Add parking_text column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'parking_text') THEN
        ALTER TABLE tenants ADD COLUMN parking_text TEXT;
        RAISE NOTICE 'Added parking_text column';
    ELSE
        RAISE NOTICE 'parking_text column already exists';
    END IF;
END $$;

-- Add services_text column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'services_text') THEN
        ALTER TABLE tenants ADD COLUMN services_text TEXT;
        RAISE NOTICE 'Added services_text column';
    ELSE
        RAISE NOTICE 'services_text column already exists';
    END IF;
END $$;

-- Add first_visit_text column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'first_visit_text') THEN
        ALTER TABLE tenants ADD COLUMN first_visit_text TEXT;
        RAISE NOTICE 'Added first_visit_text column';
    ELSE
        RAISE NOTICE 'first_visit_text column already exists';
    END IF;
END $$;

-- Add about_text column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'about_text') THEN
        ALTER TABLE tenants ADD COLUMN about_text TEXT;
        RAISE NOTICE 'Added about_text column';
    ELSE
        RAISE NOTICE 'about_text column already exists';
    END IF;
END $$;

-- Add health_text column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'health_text') THEN
        ALTER TABLE tenants ADD COLUMN health_text TEXT;
        RAISE NOTICE 'Added health_text column';
    ELSE
        RAISE NOTICE 'health_text column already exists';
    END IF;
END $$;

-- Add faq_json column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'faq_json') THEN
        ALTER TABLE tenants ADD COLUMN faq_json JSONB DEFAULT '[]'::jsonb;
        RAISE NOTICE 'Added faq_json column';
    ELSE
        RAISE NOTICE 'faq_json column already exists';
    END IF;
END $$;

-- Verify the columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tenants'
AND column_name IN ('parking_text', 'services_text', 'first_visit_text', 'about_text', 'health_text', 'faq_json')
ORDER BY column_name;
