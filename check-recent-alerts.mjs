// Check recent alerts for Cliniko errors
import { db } from './server/db.js';
import { alerts } from './shared/schema.js';
import { desc } from 'drizzle-orm';

async function checkAlerts() {
  try {
    console.log('\n=== Recent Alerts (Last 10) ===\n');

    const recentAlerts = await db
      .select()
      .from(alerts)
      .orderBy(desc(alerts.createdAt))
      .limit(10);

    if (recentAlerts.length === 0) {
      console.log('No alerts found.');
      process.exit(0);
    }

    for (const alert of recentAlerts) {
      console.log(`\n--- Alert #${alert.id} ---`);
      console.log(`Created: ${alert.createdAt}`);
      console.log(`Tenant ID: ${alert.tenantId}`);
      console.log(`Reason: ${alert.reason}`);
      console.log(`Resolved: ${alert.resolved ? 'Yes' : 'No'}`);

      if (alert.payload) {
        console.log('\nPayload:');
        const payload = typeof alert.payload === 'string'
          ? JSON.parse(alert.payload)
          : alert.payload;

        if (payload.error) {
          console.log(`  ❌ ERROR: ${payload.error}`);
        }
        if (payload.endpoint) {
          console.log(`  📍 Endpoint: ${payload.endpoint}`);
        }
        if (payload.parameters) {
          console.log(`  📋 Parameters:`, JSON.stringify(payload.parameters, null, 2));
        }
        if (payload.stack) {
          console.log(`  📚 Stack trace:`);
          console.log(`     ${payload.stack.split('\n').slice(0, 3).join('\n     ')}`);
        }
      }
      console.log('─'.repeat(60));
    }

    process.exit(0);
  } catch (error) {
    console.error('Error checking alerts:', error);
    process.exit(1);
  }
}

checkAlerts();
