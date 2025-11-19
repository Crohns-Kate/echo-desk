#!/usr/bin/env node
/**
 * Check Twilio webhook configuration
 */
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
const publicBaseUrl = process.env.PUBLIC_BASE_URL;

console.log('🔍 Checking Twilio Configuration\n');
console.log('Environment Variables:');
console.log(`  TWILIO_ACCOUNT_SID: ${accountSid ? '✅ Set' : '❌ Missing'}`);
console.log(`  TWILIO_AUTH_TOKEN: ${authToken ? '✅ Set' : '❌ Missing'}`);
console.log(`  TWILIO_PHONE_NUMBER: ${phoneNumber || '❌ Missing'}`);
console.log(`  PUBLIC_BASE_URL: ${publicBaseUrl || '❌ Missing'}\n`);

if (!accountSid || !authToken) {
  console.error('❌ Missing Twilio credentials');
  process.exit(1);
}

const client = twilio(accountSid, authToken);

try {
  console.log('📞 Fetching phone number configuration...\n');
  const numbers = await client.incomingPhoneNumbers.list();

  if (numbers.length === 0) {
    console.log('❌ No phone numbers found in Twilio account');
    process.exit(1);
  }

  console.log(`Found ${numbers.length} phone number(s):\n`);

  numbers.forEach((number, index) => {
    console.log(`${index + 1}. ${number.phoneNumber}`);
    console.log(`   Voice URL: ${number.voiceUrl || '❌ NOT SET'}`);
    console.log(`   Voice Method: ${number.voiceMethod || 'POST'}`);
    console.log(`   SMS URL: ${number.smsUrl || '❌ NOT SET'}`);

    const expectedUrl = `${publicBaseUrl}/api/voice/incoming`;
    const isCorrect = number.voiceUrl === expectedUrl;

    if (number.phoneNumber === phoneNumber) {
      console.log(`   ⭐ This is your configured number`);
      if (isCorrect) {
        console.log(`   ✅ Webhook is correctly configured`);
      } else {
        console.log(`   ❌ WEBHOOK INCORRECT!`);
        console.log(`      Expected: ${expectedUrl}`);
        console.log(`      Actual:   ${number.voiceUrl}`);
      }
    }
    console.log('');
  });

  // Show expected configuration
  console.log('━'.repeat(80));
  console.log('Expected Webhook Configuration:');
  console.log(`  Voice URL: ${publicBaseUrl}/api/voice/incoming`);
  console.log(`  Voice Method: POST`);
  console.log('━'.repeat(80));

} catch (error) {
  console.error('❌ Error:', error.message);
  if (error.code === 20003) {
    console.error('\nAuthentication failed. Check your TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
  }
  process.exit(1);
}
