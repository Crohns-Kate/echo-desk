#!/usr/bin/env node
/**
 * Test script to diagnose Cliniko availability issues
 * This will help identify configuration problems or API errors
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

// Simple fetch-based test without importing the full server
async function testClinikoAvailability() {
  console.log('=== Cliniko Availability Diagnostic ===\n');

  // Check environment variables
  console.log('1. Checking environment variables:');
  const requiredVars = [
    'CLINIKO_API_KEY',
    'CLINIKO_BUSINESS_ID',
    'CLINIKO_PRACTITIONER_ID',
    'CLINIKO_APPT_TYPE_ID'
  ];

  const missingVars = [];
  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (!value || value === '' || value.includes('xxx')) {
      console.log(`   ❌ ${varName}: NOT SET or placeholder`);
      missingVars.push(varName);
    } else {
      // Mask the value for security
      const masked = value.substring(0, 4) + '...' + value.substring(value.length - 4);
      console.log(`   ✓ ${varName}: ${masked}`);
    }
  }

  console.log(`\n   Region: ${process.env.CLINIKO_REGION || 'NOT SET (will default to au1)'}`);
  console.log(`   Timezone: ${process.env.TZ || 'NOT SET'}\n`);

  if (missingVars.length > 0) {
    console.log('❌ CONFIGURATION ERROR:');
    console.log(`   Missing required variables: ${missingVars.join(', ')}`);
    console.log('\n   These must be set in your .env file for appointment booking to work.');
    console.log('   See .env.example for reference.\n');
    return;
  }

  // Test API connectivity
  console.log('2. Testing Cliniko API connectivity:');
  const shard = process.env.CLINIKO_REGION || 'au1';
  const base = `https://api.${shard}.cliniko.com/v1`;
  const apiKey = process.env.CLINIKO_API_KEY;

  try {
    // Test basic API access
    console.log(`   Testing connection to ${base}...`);
    const response = await fetch(`${base}/users`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Echo Desk Diagnostic',
        'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`
      }
    });

    if (!response.ok) {
      console.log(`   ❌ API Error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.log(`   Response: ${text.substring(0, 200)}`);
      return;
    }

    console.log('   ✓ API connection successful\n');

    // Test practitioner access
    console.log('3. Testing practitioner configuration:');
    const practitionerId = process.env.CLINIKO_PRACTITIONER_ID;

    const practResponse = await fetch(
      `${base}/practitioners/${practitionerId}/appointment_types`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Echo Desk Diagnostic',
          'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`
        }
      }
    );

    if (!practResponse.ok) {
      console.log(`   ❌ Practitioner Error: ${practResponse.status} ${practResponse.statusText}`);
      console.log(`   Practitioner ID ${practitionerId} may not exist or API key lacks access`);
      return;
    }

    const practData = await practResponse.json();
    const appointmentTypes = practData.appointment_types || [];

    console.log(`   ✓ Practitioner found with ${appointmentTypes.length} appointment types:`);
    appointmentTypes.forEach(at => {
      console.log(`     - ${at.name} (ID: ${at.id}, Duration: ${at.duration_in_minutes}min)`);
    });

    // Check if configured appointment type exists
    console.log('\n4. Validating appointment type configuration:');
    const configuredApptTypeId = process.env.CLINIKO_APPT_TYPE_ID;
    const foundType = appointmentTypes.find(at => at.id === configuredApptTypeId);

    if (!foundType) {
      console.log(`   ❌ CONFIGURATION ERROR:`);
      console.log(`   Appointment type ${configuredApptTypeId} not found for this practitioner`);
      console.log(`\n   Available appointment types (use one of these IDs):`);
      appointmentTypes.forEach(at => {
        console.log(`     ${at.id} - ${at.name}`);
      });
      return;
    }

    console.log(`   ✓ Appointment type found: ${foundType.name} (${foundType.duration_in_minutes}min)`);

    // Test availability retrieval
    console.log('\n5. Testing availability retrieval for TODAY:');
    const today = new Date().toISOString().split('T')[0];
    const businessId = process.env.CLINIKO_BUSINESS_ID;

    const availUrl = `${base}/businesses/${businessId}/practitioners/${practitionerId}/appointment_types/${configuredApptTypeId}/available_times?from=${today}&to=${today}&per_page=10`;
    console.log(`   Fetching: ...available_times?from=${today}&to=${today}&per_page=10`);

    const availResponse = await fetch(availUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Echo Desk Diagnostic',
        'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`
      }
    });

    if (!availResponse.ok) {
      console.log(`   ❌ Availability Error: ${availResponse.status} ${availResponse.statusText}`);
      const text = await availResponse.text();
      console.log(`   Response: ${text.substring(0, 300)}`);
      return;
    }

    const availData = await availResponse.json();
    const slots = availData.available_times || [];

    if (slots.length === 0) {
      console.log(`   ⚠️  No availability found for today (${today})`);
      console.log(`   This may be expected if there are no slots available`);
      console.log(`   Try checking in Cliniko's calendar for available times\n`);
    } else {
      console.log(`   ✓ Found ${slots.length} available slots for today:`);
      slots.slice(0, 5).forEach(slot => {
        const time = new Date(slot.appointment_start).toLocaleString('en-AU', {
          timeZone: process.env.TZ || 'Australia/Brisbane',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        console.log(`     - ${time}`);
      });
      if (slots.length > 5) {
        console.log(`     ... and ${slots.length - 5} more`);
      }
    }

    console.log('\n=== ✓ ALL TESTS PASSED ===');
    console.log('Cliniko configuration is correct and API is accessible.\n');

  } catch (error) {
    console.log('\n❌ UNEXPECTED ERROR:');
    console.log(error);
  }
}

testClinikoAvailability();
