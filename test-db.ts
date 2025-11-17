import { storage } from './server/storage';

async function testDb() {
  try {
    const tenant = await storage.getTenant('default');
    const calls = await storage.listCalls(undefined, 5);

    console.log(JSON.stringify({
      dbConnected: !!tenant,
      tenant: tenant?.clinicName,
      totalCalls: calls.length,
      mostRecentCall: calls[0]?.callSid,
      mostRecentDate: calls[0]?.createdAt
    }, null, 2));
  } catch (error: any) {
    console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
  }
}

testDb();
