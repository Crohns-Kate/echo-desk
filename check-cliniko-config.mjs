// Quick script to check Cliniko configuration for a tenant
import { db } from './server/db.js';
import { tenants } from './shared/schema.js';
import { eq } from 'drizzle-orm';

async function checkClinikoConfig() {
  try {
    console.log('\n=== Checking Cliniko Configuration ===\n');

    // Get all tenants
    const allTenants = await db.select().from(tenants);

    console.log(`Found ${allTenants.length} tenant(s)\n`);

    for (const tenant of allTenants) {
      console.log(`--- Tenant: ${tenant.clinicName} (${tenant.slug}) ---`);
      console.log(`ID: ${tenant.id}`);
      console.log(`Active: ${tenant.isActive}`);
      console.log(`\nCliniko Configuration:`);
      console.log(`  API Key: ${tenant.clinikoApiKey ? '✅ SET (encrypted)' : '❌ NOT SET'}`);
      console.log(`  Shard: ${tenant.clinikoShard || '❌ NOT SET'}`);
      console.log(`  Business ID: ${tenant.clinikoBusinessId || '❌ NOT SET'}`);
      console.log(`  Practitioner ID: ${tenant.clinikoPractitionerId || '❌ NOT SET'}`);
      console.log(`  Standard Appt Type ID: ${tenant.clinikoStandardApptTypeId || '❌ NOT SET'}`);
      console.log(`  New Patient Appt Type ID: ${tenant.clinikoNewPatientApptTypeId || '❌ NOT SET'}`);
      console.log(`\nOther Settings:`);
      console.log(`  Timezone: ${tenant.timezone}`);
      console.log(`  Phone: ${tenant.phoneNumber || 'Not set'}`);
      console.log(`\n${'='.repeat(60)}\n`);

      // Check if all required fields are present
      const missingFields = [];
      if (!tenant.clinikoApiKey) missingFields.push('API Key');
      if (!tenant.clinikoShard) missingFields.push('Shard');
      if (!tenant.clinikoPractitionerId) missingFields.push('Practitioner ID');
      if (!tenant.clinikoStandardApptTypeId) missingFields.push('Standard Appt Type ID');

      if (missingFields.length > 0) {
        console.log(`⚠️  WARNING: Missing required fields for ${tenant.clinicName}:`);
        missingFields.forEach(field => console.log(`   - ${field}`));
        console.log('\nAppointment booking will fail without these!\n');
      } else {
        console.log(`✅ All required Cliniko fields are configured for ${tenant.clinicName}\n`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('Error checking config:', error);
    process.exit(1);
  }
}

checkClinikoConfig();
