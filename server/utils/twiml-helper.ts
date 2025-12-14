/**
 * TwiML Helper
 * Post-processes TwiML XML to fix SSML escaping issues
 */

import { unescapeSSMLInTwiml } from './voice-constants';

/**
 * Get TwiML XML string from VoiceResponse, with SSML properly unescaped for Polly
 * Use this instead of vr.toString() when sending TwiML responses
 */
export function getTwimlXml(vr: any): string {
  const rawXml = vr.toString();
  
  // Unescape SSML in TwiML for Polly voices
  // This fixes the issue where Twilio SDK escapes SSML tags
  return unescapeSSMLInTwiml(rawXml);
}
