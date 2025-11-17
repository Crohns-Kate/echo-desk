import { storage } from './server/storage';

async function analyzeCall117() {
  try {
    const call = await storage.getCallByCallSid('CA286f87aad42840a8fa6a0493d98ad6a0');

    if (!call) {
      console.log(JSON.stringify({ error: 'Call not found' }, null, 2));
      process.exit(1);
    }

    let conversationContext = null;
    if (call.conversationId) {
      const conversation = await storage.getConversation(call.conversationId);
      conversationContext = conversation?.context || null;
    }

    console.log(JSON.stringify({
      callSid: call.callSid,
      intent: call.intent,
      summary: call.summary,
      context: conversationContext
    }, null, 2));
  } catch (error: any) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
  }
}

analyzeCall117();
