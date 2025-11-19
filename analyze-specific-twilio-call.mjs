#!/usr/bin/env node
/**
 * Analyze a specific Twilio call to see what happened
 */
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const callSid = process.argv[2];

if (!callSid) {
  console.error('Usage: node analyze-specific-twilio-call.mjs <CallSID>');
  process.exit(1);
}

const client = twilio(accountSid, authToken);

console.log(`🔍 Analyzing call: ${callSid}\n`);

try {
  // Get call details
  const call = await client.calls(callSid).fetch();

  console.log('Call Details:');
  console.log(`  Status: ${call.status}`);
  console.log(`  From: ${call.from}`);
  console.log(`  To: ${call.to}`);
  console.log(`  Direction: ${call.direction}`);
  console.log(`  Duration: ${call.duration}s`);
  console.log(`  Start Time: ${call.startTime}`);
  console.log(`  End Time: ${call.endTime}`);
  console.log(`  Price: ${call.price} ${call.priceUnit}`);
  console.log('');

  // Get recordings
  console.log('Recordings:');
  const recordings = await client.recordings.list({ callSid: callSid });
  if (recordings.length === 0) {
    console.log('  ❌ No recordings found');
  } else {
    recordings.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec.sid}`);
      console.log(`     Status: ${rec.status}`);
      console.log(`     Duration: ${rec.duration}s`);
      console.log(`     URL: ${rec.uri}`);
    });
  }
  console.log('');

  // Get notifications (errors)
  console.log('Notifications/Errors:');
  const notifications = await client.calls(callSid).notifications.list();
  if (notifications.length === 0) {
    console.log('  ✅ No errors');
  } else {
    notifications.forEach((notif, index) => {
      console.log(`  ${index + 1}. ${notif.errorCode}: ${notif.messageText}`);
      console.log(`     Date: ${notif.messageDate}`);
    });
  }

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
