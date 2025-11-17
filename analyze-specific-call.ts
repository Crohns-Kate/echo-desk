import { storage } from './server/storage';

async function analyzeCall() {
  try {
    const call = await storage.getCallByCallSid('CA150242df0c397820cd1aa8c086621e03');

    if (!call) {
      console.log(JSON.stringify({ error: 'Call not found' }, null, 2));
      process.exit(1);
    }

    let conversationContext = null;
    if (call.conversationId) {
      const conversation = await storage.getConversation(call.conversationId);
      conversationContext = conversation?.context || null;
    }

    const analysisData = {
      callSid: call.callSid,
      fromNumber: call.fromNumber,
      duration: call.duration,
      createdAt: call.createdAt,
      intent: call.intent,
      summary: call.summary,
      transcript: call.transcript,
      recordingUrl: call.recordingUrl,
      context: conversationContext
    };

    console.log(JSON.stringify(analysisData, null, 2));
  } catch (error: any) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
  }
}

analyzeCall();
