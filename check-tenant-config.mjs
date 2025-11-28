#!/usr/bin/env node
/**
 * Check tenant configuration in the database
 */

import { readFileSync } from 'fs';

// Load .env file manually
try {
  const envFile = readFileSync('.env', 'utf-8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^#][^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
} catch (e) {
  console.log('⚠️  No .env file found - using existing environment variables only\n');
}

// Import database storage
const { storage } = await import('./server/storage.ts');

console.log('=== Tenant Cliniko Configuration Check ===\n');

try {
  // Get all tenants
  const tenants = await storage.getAllTenants?.() || [];

  if (tenants.length === 0) {
    console.log('❌ No tenants found in database');
    console.log('   The system needs at least one tenant configured.\n');
    process.exit(0);
  }

  console.log(`Found ${tenants.length} tenant(s):\n`);

  for (const tenant of tenants) {
    console.log(`📋 Tenant: ${tenant.clinicName} (slug: ${tenant.slug})`);
    console.log(`   ID: ${tenant.id}`);
    console.log(`   Phone: ${tenant.phoneNumber || 'NOT SET'}`);
    console.log(`   Timezone: ${tenant.timezone}`);
    console.log(`   Active: ${tenant.isActive ? 'Yes' : 'No'}`);
    console.log(`\n   Cliniko Configuration:`);
    console.log(`   - API Key: ${tenant.clinikoApiKeyEncrypted ? 'SET (encrypted)' : '❌ NOT SET'}`);
    console.log(`   - Shard: ${tenant.clinikoShard || 'NOT SET (will default to au1)'}`);
    console.log(`   - Practitioner ID: ${tenant.clinikoPractitionerId || '❌ NOT SET'}`);
    console.log(`   - Standard Appt Type ID: ${tenant.clinikoStandardApptTypeId || '❌ NOT SET'}`);
    console.log(`   - New Patient Appt Type ID: ${tenant.clinikoNewPatientApptTypeId || '❌ NOT SET'}`);

    // Check what's missing
    const missing = [];
    if (!tenant.clinikoApiKeyEncrypted) missing.push('API Key');
    if (!tenant.clinikoPractitionerId) missing.push('Practitioner ID');
    if (!tenant.clinikoStandardApptTypeId) missing.push('Standard Appointment Type ID');

    if (missing.length > 0) {
      console.log(`\n   ⚠️  Missing required fields: ${missing.join(', ')}`);
      console.log(`   💡 Appointment booking will NOT work until these are configured.`);
    } else {
      console.log(`\n   ✅ All required Cliniko fields are configured!`);
    }

    console.log('\n' + '─'.repeat(70) + '\n');
  }

  // Check environment fallbacks
  console.log('Environment Variable Fallbacks:');
  console.log(`   CLINIKO_API_KEY: ${process.env.CLINIKO_API_KEY ? 'SET' : '❌ NOT SET'}`);
  console.log(`   CLINIKO_BUSINESS_ID: ${process.env.CLINIKO_BUSINESS_ID || '❌ NOT SET'}`);
  console.log(`   CLINIKO_PRACTITIONER_ID: ${process.env.CLINIKO_PRACTITIONER_ID || '❌ NOT SET'}`);
  console.log(`   CLINIKO_APPT_TYPE_ID: ${process.env.CLINIKO_APPT_TYPE_ID || '❌ NOT SET'}`);
  console.log(`   CLINIKO_REGION: ${process.env.CLINIKO_REGION || '❌ NOT SET (will default to au1)'}\n`);

  console.log('Summary:');
  console.log('   If tenant Cliniko fields are not set, environment variables will be used as fallback.');
  console.log('   If NEITHER tenant NOR environment variables are set, demo mode activates (returns fake slots).\n');

} catch (error) {
  console.error('❌ Error checking tenant configuration:', error);
  process.exit(1);
}
