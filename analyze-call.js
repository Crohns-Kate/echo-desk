// Temporary script to fetch call analysis data
import { storage } from './server/storage.js';

async function analyzeLastCall() {
  try {
    // Get last call
    const calls = await storage.listCalls(undefined, 1);

    if (calls.length === 0) {
      console.log(JSON.stringify({ error: 'No calls found' }, null, 2));
      process.exit(1);
    }

    const call = calls[0];

    // Get conversation context
    let conversationContext = null;
    if (call.conversationId) {
      const conversation = await storage.getConversation(call.conversationId);
      conversationContext = conversation?.context || null;
    }

    // Get related alerts
    const allAlerts = await storage.listAlerts(call.tenantId, 50);
    const relatedAlerts = allAlerts.filter(alert =>
      alert.conversationId === call.conversationId ||
      (alert.payload)?.callSid === call.callSid
    );

    // Build analysis data
    const analysisData = {
      callSid: call.callSid,
      fromNumber: call.fromNumber,
      toNumber: call.toNumber,
      duration: call.duration,
      createdAt: call.createdAt,
      intent: call.intent,
      summary: call.summary,
      transcript: call.transcript || null,
      recordingUrl: call.recordingUrl || null,
      recordingSid: call.recordingSid || null,
      recordingStatus: call.recordingStatus || null,
      context: conversationContext,
      patientMode: conversationContext?.patientMode || null,
      patientId: conversationContext?.patientId || null,
      existingPatientId: conversationContext?.existingPatientId || null,
      existingPatientName: conversationContext?.existingPatientName || null,
      fullName: conversationContext?.fullName || null,
      firstName: conversationContext?.firstName || null,
      email: conversationContext?.email || null,
      isNewPatient: conversationContext?.isNewPatient || false,
      isReturning: conversationContext?.isReturning || false,
      alerts: relatedAlerts
    };

    console.log(JSON.stringify(analysisData, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
    process.exit(1);
  }
}

analyzeLastCall();
