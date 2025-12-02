#!/usr/bin/env node

/**
 * Verify Cliniko configuration by testing API access
 */

import { readFileSync } from 'fs';

// Load .env file manually
try {
  const envFile = readFileSync('.env', 'utf-8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=:#]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      process.env[key] = value;
    }
  });
} catch (e) {
  // .env file not found, will use environment variables
}

const CLINIKO_API_KEY = process.env.CLINIKO_API_KEY;
const CLINIKO_REGION = process.env.CLINIKO_REGION || process.env.CLINIKO_SHARD || 'au4';

if (!CLINIKO_API_KEY) {
  console.error('❌ CLINIKO_API_KEY not set in environment');
  process.exit(1);
}

const base = `https://api.${CLINIKO_REGION}.cliniko.com/v1`;
const headers = {
  'Accept': 'application/json',
  'Authorization': `Basic ${Buffer.from(CLINIKO_API_KEY + ':').toString('base64')}`
};

console.log('🔍 Testing Cliniko API Configuration...\n');
console.log(`Region: ${CLINIKO_REGION}`);
console.log(`Base URL: ${base}\n`);

// Test 1: List practitioners
console.log('📋 Test 1: Fetching practitioners...');
try {
  const response = await fetch(`${base}/practitioners?per_page=50`, { headers });

  if (!response.ok) {
    const text = await response.text();
    console.error(`❌ Failed to fetch practitioners (${response.status}):`, text);
  } else {
    const data = await response.json();
    const practitioners = data.practitioners || [];

    console.log(`✅ Found ${practitioners.length} practitioner(s):\n`);

    practitioners.forEach((p, index) => {
      console.log(`${index + 1}. ${p.first_name} ${p.last_name}`);
      console.log(`   ID: ${p.id}`);
      console.log(`   Active: ${p.active ? '✅' : '❌'}`);
      console.log(`   Show in online bookings: ${p.show_in_online_bookings ? '✅' : '❌'}`);
      console.log('');
    });
  }
} catch (error) {
  console.error('❌ Error fetching practitioners:', error.message);
}

// Test 2: List businesses
console.log('\n📋 Test 2: Fetching businesses...');
try {
  const response = await fetch(`${base}/businesses?per_page=50`, { headers });

  if (!response.ok) {
    const text = await response.text();
    console.error(`❌ Failed to fetch businesses (${response.status}):`, text);
  } else {
    const data = await response.json();
    const businesses = data.businesses || [];

    console.log(`✅ Found ${businesses.length} business(es):\n`);

    businesses.forEach((b, index) => {
      console.log(`${index + 1}. ${b.name}`);
      console.log(`   ID: ${b.id}`);
      console.log('');
    });
  }
} catch (error) {
  console.error('❌ Error fetching businesses:', error.message);
}

// Test 3: Try to access specific practitioner
const PRACTITIONER_ID = '1797514426522281888';
console.log(`\n📋 Test 3: Testing access to practitioner ${PRACTITIONER_ID}...`);
try {
  const response = await fetch(`${base}/practitioners/${PRACTITIONER_ID}`, { headers });

  if (!response.ok) {
    const text = await response.text();
    console.error(`❌ Cannot access practitioner ${PRACTITIONER_ID} (${response.status}):`, text);
    console.log('\n⚠️  This practitioner ID is in your Railway config but cannot be accessed.');
    console.log('   Possible reasons:');
    console.log('   1. Practitioner was deleted or deactivated in Cliniko');
    console.log('   2. API key lacks permission to access this practitioner');
    console.log('   3. Practitioner ID is incorrect');
  } else {
    const practitioner = await response.json();
    console.log(`✅ Successfully accessed practitioner:`);
    console.log(`   Name: ${practitioner.first_name} ${practitioner.last_name}`);
    console.log(`   Active: ${practitioner.active ? '✅' : '❌'}`);
    console.log(`   Show in online bookings: ${practitioner.show_in_online_bookings ? '✅' : '❌'}`);
  }
} catch (error) {
  console.error('❌ Error accessing practitioner:', error.message);
}

console.log('\n✅ Configuration test complete!');
