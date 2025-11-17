import { storage } from './server/storage';

async function checkTranscripts() {
  try {
    const calls = await storage.listCalls(undefined, 20);

    const callsWithTranscripts = calls.filter(c => c.transcript && c.transcript.length > 0);

    console.log(JSON.stringify({
      totalCalls: calls.length,
      callsWithTranscripts: callsWithTranscripts.length,
      transcripts: callsWithTranscripts.map(c => ({
        callSid: c.callSid,
        createdAt: c.createdAt,
        transcriptLength: c.transcript?.length || 0,
        transcript: c.transcript?.substring(0, 200) + '...',
        recordingUrl: c.recordingUrl
      }))
    }, null, 2));
  } catch (error: any) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
  }
}

checkTranscripts();
