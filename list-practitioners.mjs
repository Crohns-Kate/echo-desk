#!/usr/bin/env node

/**
 * List all practitioners from Cliniko to find the correct practitioner ID
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
const CLINIKO_SHARD = process.env.CLINIKO_REGION || process.env.CLINIKO_SHARD || 'au4';

if (!CLINIKO_API_KEY) {
  console.error('❌ CLINIKO_API_KEY not set in environment');
  process.exit(1);
}

const base = `https://api.${CLINIKO_SHARD}.cliniko.com/v1`;
const headers = {
  'Accept': 'application/json',
  'Authorization': `Basic ${Buffer.from(CLINIKO_API_KEY + ':').toString('base64')}`
};

console.log('🔍 Fetching practitioners from Cliniko...\n');

try {
  const response = await fetch(`${base}/practitioners?per_page=50`, { headers });

  if (!response.ok) {
    const text = await response.text();
    console.error(`❌ Cliniko API error ${response.status}:`, text);
    process.exit(1);
  }

  const data = await response.json();
  const practitioners = data.practitioners || [];

  if (practitioners.length === 0) {
    console.log('⚠️  No practitioners found');
    process.exit(0);
  }

  console.log(`✅ Found ${practitioners.length} practitioner(s):\n`);

  practitioners.forEach((p, index) => {
    console.log(`${index + 1}. ${p.first_name} ${p.last_name}`);
    console.log(`   ID: ${p.id}`);
    console.log(`   Active: ${p.active ? '✅' : '❌'}`);
    console.log(`   Show in online bookings: ${p.show_in_online_bookings ? '✅' : '❌'}`);
    console.log(`   User ID: ${p.user_id || 'N/A'}`);
    console.log('');
  });

  console.log('\n📋 To use a practitioner, set this in Railway:');
  console.log(`   CLINIKO_PRACTITIONER_ID=${practitioners[0].id}`);

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
