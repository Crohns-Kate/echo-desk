import { AssemblyAI } from 'assemblyai';
import { env } from '../utils/env';
import fetch from 'node-fetch';

/**
 * Transcribe a Twilio recording using AssemblyAI
 * @param recordingUrl The URL of the Twilio recording (must be accessible with auth)
 * @param twilioAccountSid Twilio Account SID for auth
 * @param twilioAuthToken Twilio Auth Token for auth
 * @returns The transcription text
 */
export async function transcribeRecording(
  recordingUrl: string,
  twilioAccountSid: string,
  twilioAuthToken: string
): Promise<string> {
  if (!env.ASSEMBLYAI_API_KEY) {
    throw new Error('ASSEMBLYAI_API_KEY not configured');
  }

  const client = new AssemblyAI({
    apiKey: env.ASSEMBLYAI_API_KEY
  });

  console.log('[TRANSCRIPTION] 🎤 Starting transcription with AssemblyAI');
  console.log('[TRANSCRIPTION]   - Recording URL:', recordingUrl);

  // AssemblyAI needs the MP3 URL with .mp3 extension
  const audioUrl = recordingUrl.endsWith('.mp3') ? recordingUrl : recordingUrl + '.mp3';

  // Download the recording from Twilio first (since it requires authentication)
  console.log('[TRANSCRIPTION] 📥 Downloading recording from Twilio...');
  const authHeader = 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');

  const response = await fetch(audioUrl, {
    headers: {
      'Authorization': authHeader
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download recording: ${response.status} ${response.statusText}`);
  }

  const audioBuffer = await response.arrayBuffer();
  console.log('[TRANSCRIPTION] ✅ Downloaded recording:', audioBuffer.byteLength, 'bytes');

  // Pass the audio buffer directly to AssemblyAI (avoids auth issues)
  console.log('[TRANSCRIPTION] 🔄 Submitting to AssemblyAI...');
  const transcript = await client.transcripts.transcribe({
    audio: audioBuffer
  });

  if (transcript.status === 'error') {
    console.error('[TRANSCRIPTION] ❌ AssemblyAI error:', transcript.error);
    throw new Error(`Transcription failed: ${transcript.error}`);
  }

  console.log('[TRANSCRIPTION] ✅ Transcription completed');
  console.log('[TRANSCRIPTION]   - Text length:', transcript.text?.length || 0, 'characters');
  console.log('[TRANSCRIPTION]   - Confidence:', transcript.confidence);

  return transcript.text || '';
}

/**
 * Transcribe a recording asynchronously (don't wait for completion)
 * Starts the transcription and polls for completion in the background
 */
export async function transcribeRecordingAsync(
  callSid: string,
  recordingUrl: string,
  twilioAccountSid: string,
  twilioAuthToken: string,
  onComplete: (transcript: string) => Promise<void>
): Promise<void> {
  // Run transcription in background
  setImmediate(async () => {
    try {
      console.log('[TRANSCRIPTION] 🔄 Starting async transcription for call:', callSid);
      const transcript = await transcribeRecording(recordingUrl, twilioAccountSid, twilioAuthToken);
      console.log('[TRANSCRIPTION] 📝 Calling completion handler for call:', callSid);
      await onComplete(transcript);
      console.log('[TRANSCRIPTION] ✅ Completion handler finished for call:', callSid);
    } catch (error: any) {
      console.error('[TRANSCRIPTION] ❌ Async transcription failed for call:', callSid);
      console.error('[TRANSCRIPTION]   - Error:', error.message);
      console.error('[TRANSCRIPTION]   - Stack:', error.stack);
    }
  });
}
