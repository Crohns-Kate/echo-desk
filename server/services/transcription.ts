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

  // Use response.buffer() which directly returns a Node.js Buffer (node-fetch v3)
  // This is more efficient than arrayBuffer() + conversion
  const audioBuffer = await response.buffer();
  console.log('[TRANSCRIPTION] ✅ Downloaded recording:', audioBuffer.length, 'bytes');

  // Pass the audio buffer directly to AssemblyAI (avoids auth issues)
  console.log('[TRANSCRIPTION] 🔄 Submitting to AssemblyAI...');
  console.log('[TRANSCRIPTION]   - Buffer size:', audioBuffer.length, 'bytes');
  console.log('[TRANSCRIPTION]   - Buffer type:', audioBuffer.constructor.name);
  
  let transcript;
  try {
    // Add timeout to prevent hanging (AssemblyAI typically takes 5-30 seconds)
    const transcribePromise = client.transcripts.transcribe({
      audio: audioBuffer
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Transcription timeout after 60 seconds')), 60000);
    });
    
    transcript = await Promise.race([transcribePromise, timeoutPromise]) as any;
    console.log('[TRANSCRIPTION] 📋 Received transcript response');
    console.log('[TRANSCRIPTION]   - Transcript ID:', transcript.id);
    console.log('[TRANSCRIPTION]   - Status:', transcript.status);
  } catch (error: any) {
    console.error('[TRANSCRIPTION] ❌ Exception during AssemblyAI transcribe call:', error);
    console.error('[TRANSCRIPTION]   - Error message:', error?.message);
    console.error('[TRANSCRIPTION]   - Error stack:', error?.stack);
    console.error('[TRANSCRIPTION]   - Error name:', error?.name);
    if (error?.response) {
      console.error('[TRANSCRIPTION]   - API Response status:', error.response.status);
      console.error('[TRANSCRIPTION]   - API Response data:', error.response.data);
    }
    throw new Error(`Transcription API call failed: ${error?.message || 'Unknown error'}`);
  }

  // Log full transcript object for debugging (first 500 chars of text to avoid huge logs)
  const transcriptPreview = {
    id: transcript.id,
    status: transcript.status,
    text: transcript.text ? transcript.text.substring(0, 500) + (transcript.text.length > 500 ? '...' : '') : null,
    textLength: transcript.text?.length || 0,
    confidence: transcript.confidence,
    error: transcript.error,
    hasText: !!transcript.text
  };
  console.log('[TRANSCRIPTION] 📊 Transcript object:', JSON.stringify(transcriptPreview, null, 2));

  // Check transcript status
  if (transcript.status === 'error') {
    const errorMsg = transcript.error || 'Unknown error';
    console.error('[TRANSCRIPTION] ❌ AssemblyAI error:', errorMsg);
    throw new Error(`Transcription failed: ${errorMsg}`);
  }

  if (transcript.status !== 'completed') {
    console.warn('[TRANSCRIPTION] ⚠️  Unexpected transcript status:', transcript.status);
    console.warn('[TRANSCRIPTION]   - Full transcript keys:', Object.keys(transcript));
    // Still try to return text if available, even if status isn't 'completed'
  }

  const transcriptText = transcript.text || '';
  if (!transcriptText && transcript.status === 'completed') {
    console.warn('[TRANSCRIPTION] ⚠️  Status is completed but no text available');
  }

  console.log('[TRANSCRIPTION] ✅ Transcription completed');
  console.log('[TRANSCRIPTION]   - Status:', transcript.status);
  console.log('[TRANSCRIPTION]   - Text length:', transcriptText.length, 'characters');
  console.log('[TRANSCRIPTION]   - Confidence:', transcript.confidence);

  return transcriptText;
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
