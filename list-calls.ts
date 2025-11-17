import { storage } from './server/storage';

async function listCalls() {
  try {
    const calls = await storage.listCalls(undefined, 10);

    const summary = {
      totalCalls: calls.length,
      calls: calls.map(c => ({
        callSid: c.callSid,
        createdAt: c.createdAt,
        intent: c.intent,
        summary: c.summary,
        hasTranscript: !!c.transcript,
        hasRecording: !!c.recordingUrl,
        duration: c.duration
      }))
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (error: any) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
  }
}

listCalls();
