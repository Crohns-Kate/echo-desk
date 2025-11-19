#!/usr/bin/env node
/**
 * Check recent Twilio calls
 */
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const client = twilio(accountSid, authToken);

console.log('📞 Fetching recent Twilio calls...\n');

try {
  const calls = await client.calls.list({ limit: 10 });

  if (calls.length === 0) {
    console.log('No recent calls found');
    process.exit(0);
  }

  console.log(`Found ${calls.length} recent calls:\n`);

  calls.forEach((call, index) => {
    const createdDate = new Date(call.dateCreated);
    const ageMinutes = Math.round((Date.now() - createdDate.getTime()) / 60000);

    console.log(`${index + 1}. Call SID: ${call.sid}`);
    console.log(`   Status: ${call.status}`);
    console.log(`   From: ${call.from}`);
    console.log(`   To: ${call.to}`);
    console.log(`   Direction: ${call.direction}`);
    console.log(`   Duration: ${call.duration || 0}s`);
    console.log(`   Created: ${createdDate.toISOString()} (${ageMinutes} min ago)`);

    if (call.status === 'failed' || call.status === 'no-answer') {
      console.log(`   ⚠️  Call failed or not answered`);
    }

    console.log('');
  });
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
