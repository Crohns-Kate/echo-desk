/**
 * TwiML Helper
 * Post-processes TwiML XML to fix SSML escaping issues
 */

import twilio from 'twilio';
import { unescapeSSMLInTwiml } from './voice-constants';

/**
 * Get TwiML XML string from VoiceResponse, with SSML properly unescaped for Polly
 * Use this instead of vr.toString() when sending TwiML responses
 * 
 * Includes error handling to ensure valid TwiML is always returned
 */
export function getTwimlXml(vr: any): string {
  try {
    const rawXml = vr.toString();
    
    // Unescape SSML in TwiML for Polly voices
    // This fixes the issue where Twilio SDK escapes SSML tags
    return unescapeSSMLInTwiml(rawXml);
  } catch (error) {
    console.error('[getTwimlXml] Error generating TwiML, returning fallback:', error);
    // Fallback: return basic TwiML with error message
    const fallbackVr = new twilio.twiml.VoiceResponse();
    fallbackVr.say({ voice: 'alice', language: 'en-AU' }, 'Sorry, there was a problem. Please try again.');
    fallbackVr.hangup();
    return fallbackVr.toString();
  }
}
