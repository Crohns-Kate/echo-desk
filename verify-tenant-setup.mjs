#!/usr/bin/env node
import { storage } from './server/storage.js';

async function verifySetup() {
  console.log('\n📋 Verifying Tenant Setup\n');

  try {
    // Get all tenants
    const tenants = await storage.listTenants();
    console.log(`Found ${tenants.length} tenant(s):\n`);

    for (const tenant of tenants) {
      console.log(`Tenant: ${tenant.slug} (${tenant.clinicName})`);
      console.log(`  ID: ${tenant.id}`);
      console.log(`  Phone: ${tenant.phoneNumber || '❌ NOT SET'}`);
      console.log(`  Greeting: ${tenant.greeting?.substring(0, 50)}...`);
      console.log('');
    }

    // Check spinalogic specifically
    const spinalogic = tenants.find(t => t.slug === 'spinalogic');
    if (spinalogic) {
      console.log('✅ Spinalogic tenant found');
      if (spinalogic.phoneNumber) {
        console.log(`   Phone: ${spinalogic.phoneNumber}`);
      } else {
        console.log('   ⚠️  WARNING: No phone number set!');
        console.log('   Calls to this clinic will not be routed correctly.');
      }
    } else {
      console.log('❌ Spinalogic tenant NOT found in database');
    }

    // Check knowledge base file
    const fs = await import('fs');
    const kbPath = './knowledgebase/spinalogic.md';
    if (fs.existsSync(kbPath)) {
      console.log('\n✅ Knowledge base file exists: knowledgebase/spinalogic.md');
    } else {
      console.log('\n❌ Knowledge base file NOT found: knowledgebase/spinalogic.md');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }

  process.exit(0);
}

verifySetup();
