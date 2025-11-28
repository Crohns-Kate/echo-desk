#!/usr/bin/env node
/**
 * Helper script to fetch your Cliniko configuration IDs
 * Run this with your CLINIKO_API_KEY and CLINIKO_REGION set
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
  // No .env file - that's okay
}

const apiKey = process.env.CLINIKO_API_KEY;
const region = process.env.CLINIKO_REGION || 'au1';

if (!apiKey) {
  console.log('❌ ERROR: CLINIKO_API_KEY is not set\n');
  console.log('Please run this script with your Cliniko API key:');
  console.log('  CLINIKO_API_KEY=your_key_here node setup-cliniko-config.mjs\n');
  console.log('Or add it to your .env file.\n');
  console.log('To get your API key:');
  console.log('  1. Log in to Cliniko');
  console.log('  2. Go to Settings → API Keys');
  console.log('  3. Create a new API key with read/write permissions\n');
  process.exit(1);
}

const base = `https://api.${region}.cliniko.com/v1`;
const authHeader = `Basic ${Buffer.from(apiKey + ':').toString('base64')}`;

console.log('=== Cliniko Configuration Setup ===\n');
console.log(`Region: ${region}`);
console.log(`API Base: ${base}\n`);

async function fetchConfig() {
  try {
    // Fetch businesses
    console.log('1️⃣ Fetching businesses...');
    const bizResponse = await fetch(`${base}/businesses`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Echo Desk Setup',
        'Authorization': authHeader
      }
    });

    if (!bizResponse.ok) {
      throw new Error(`API error: ${bizResponse.status} ${bizResponse.statusText}`);
    }

    const bizData = await bizResponse.json();
    const businesses = bizData.businesses || [];

    if (businesses.length === 0) {
      console.log('   ❌ No businesses found in your Cliniko account\n');
      return;
    }

    console.log(`   ✅ Found ${businesses.length} business(es):`);
    businesses.forEach((biz, i) => {
      console.log(`      ${i + 1}. ${biz.name} (ID: ${biz.id})`);
    });

    const selectedBusiness = businesses[0];
    console.log(`\n   📌 Using: ${selectedBusiness.name}\n`);

    // Fetch practitioners
    console.log('2️⃣ Fetching practitioners...');
    const practResponse = await fetch(`${base}/practitioners?per_page=50`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Echo Desk Setup',
        'Authorization': authHeader
      }
    });

    if (!practResponse.ok) {
      throw new Error(`API error: ${practResponse.status} ${practResponse.statusText}`);
    }

    const practData = await practResponse.json();
    const allPractitioners = practData.practitioners || [];
    const practitioners = allPractitioners.filter(p => p.show_in_online_bookings && p.active);

    if (practitioners.length === 0) {
      console.log('   ❌ No active practitioners found with online bookings enabled\n');
      return;
    }

    console.log(`   ✅ Found ${practitioners.length} practitioner(s) available for online booking:`);
    practitioners.forEach((prac, i) => {
      console.log(`      ${i + 1}. ${prac.first_name} ${prac.last_name} (ID: ${prac.id})`);
    });

    const selectedPractitioner = practitioners[0];
    console.log(`\n   📌 Using: ${selectedPractitioner.first_name} ${selectedPractitioner.last_name}\n`);

    // Fetch appointment types for the practitioner
    console.log('3️⃣ Fetching appointment types...');
    const apptTypeResponse = await fetch(
      `${base}/practitioners/${selectedPractitioner.id}/appointment_types?per_page=50`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Echo Desk Setup',
          'Authorization': authHeader
        }
      }
    );

    if (!apptTypeResponse.ok) {
      throw new Error(`API error: ${apptTypeResponse.status} ${apptTypeResponse.statusText}`);
    }

    const apptTypeData = await apptTypeResponse.json();
    const allApptTypes = apptTypeData.appointment_types || [];
    const apptTypes = allApptTypes.filter(at => at.show_in_online_bookings);

    if (apptTypes.length === 0) {
      console.log('   ❌ No appointment types found with online bookings enabled\n');
      return;
    }

    console.log(`   ✅ Found ${apptTypes.length} appointment type(s):`);
    apptTypes.forEach((type, i) => {
      console.log(`      ${i + 1}. ${type.name} (ID: ${type.id}, Duration: ${type.duration_in_minutes}min)`);
    });

    const standardApptType = apptTypes[0];
    const newPatientApptType = apptTypes.find(t =>
      t.name.toLowerCase().includes('new') ||
      t.name.toLowerCase().includes('initial') ||
      t.name.toLowerCase().includes('first')
    ) || apptTypes[0];

    console.log(`\n   📌 Standard appointment: ${standardApptType.name}`);
    console.log(`   📌 New patient appointment: ${newPatientApptType.name}\n`);

    // Output configuration
    console.log('═'.repeat(70));
    console.log('\n✅ CONFIGURATION COMPLETE\n');
    console.log('Add these to your .env file or deployment environment:\n');
    console.log('─'.repeat(70));
    console.log(`CLINIKO_API_KEY=${apiKey}`);
    console.log(`CLINIKO_REGION=${region}`);
    console.log(`CLINIKO_BUSINESS_ID=${selectedBusiness.id}`);
    console.log(`CLINIKO_PRACTITIONER_ID=${selectedPractitioner.id}`);
    console.log(`CLINIKO_APPT_TYPE_ID=${standardApptType.id}`);
    console.log(`CLINIKO_NEW_PATIENT_APPT_TYPE_ID=${newPatientApptType.id}`);
    console.log('─'.repeat(70));
    console.log('\nNote: CLINIKO_BUSINESS_ID will be auto-fetched if not set (thanks to recent fix!)');
    console.log('\n📚 You can now use these values to configure your Echo Desk deployment.\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('401')) {
      console.log('\n💡 Your API key may be invalid. Please check:');
      console.log('   1. The API key is correct');
      console.log('   2. The API key has not been revoked');
      console.log('   3. The CLINIKO_REGION is correct\n');
    }
  }
}

fetchConfig();
