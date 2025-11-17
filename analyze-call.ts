// Temporary script to fetch call analysis data
import { storage } from './server/storage';

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
      (alert.payload as any)?.callSid === call.callSid
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
      transcriptLength: call.transcript?.length || 0,
      recordingUrl: call.recordingUrl || null,
      recordingSid: call.recordingSid || null,
      recordingStatus: call.recordingStatus || null,
      context: conversationContext,
      patientMode: (conversationContext as any)?.patientMode || null,
      patientId: (conversationContext as any)?.patientId || null,
      existingPatientId: (conversationContext as any)?.existingPatientId || null,
      existingPatientName: (conversationContext as any)?.existingPatientName || null,
      fullName: (conversationContext as any)?.fullName || null,
      firstName: (conversationContext as any)?.firstName || null,
      email: (conversationContext as any)?.email || null,
      isNewPatient: (conversationContext as any)?.isNewPatient || false,
      isReturning: (conversationContext as any)?.isReturning || false,
      identityConfirmed: (conversationContext as any)?.identityConfirmed || false,
      alertsCount: relatedAlerts.length,
      alerts: relatedAlerts
    };

    console.log(JSON.stringify(analysisData, null, 2));
    process.exit(0);
  } catch (error: any) {
    console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
    process.exit(1);
  }
}

analyzeLastCall();
