/**
 * Test endpoint to verify SSML is properly rendered in TwiML
 * GET /api/test/ssml - Returns TwiML with SSML greeting to verify it's not escaped
 */

import { Express, Request, Response } from 'express';
import twilio from 'twilio';
import { saySafeSSML, ttsGreeting, ttsThinking, ttsBookingConfirmed, ttsDirections, ttsGoodbye } from '../utils/voice-constants';
import { getTwimlXml } from '../utils/twiml-helper';

export function registerTestSSML(app: Express) {
  app.get('/api/test/ssml', (req: Request, res: Response) => {
    const vr = new twilio.twiml.VoiceResponse();
    
    // Test greeting with SSML
    saySafeSSML(vr, ttsGreeting('Test Clinic'));
    
    // Get TwiML with SSML unescaped
    const twimlXml = getTwimlXml(vr);
    
    // Log for debugging
    console.log('[TEST][SSML] Generated TwiML:', twimlXml);
    
    // Check if SSML is properly unescaped
    const hasRawSSML = twimlXml.includes('<speak>') && twimlXml.includes('<break');
    const hasEscaped = twimlXml.includes('&lt;speak&gt;') || twimlXml.includes('&lt;break');
    
    res.type('text/xml');
    res.send(twimlXml);
    
    console.log(`[TEST][SSML] SSML status: hasRawSSML=${hasRawSSML}, hasEscaped=${hasEscaped}`);
  });

  app.get('/api/test/ssml-all', (req: Request, res: Response) => {
    const vr = new twilio.twiml.VoiceResponse();
    
    // Test all SSML helpers
    saySafeSSML(vr, ttsGreeting('Test Clinic'));
    vr.pause({ length: 1 });
    saySafeSSML(vr, ttsThinking());
    vr.pause({ length: 1 });
    saySafeSSML(vr, ttsBookingConfirmed('John', 'Monday at 2:30 PM', 'Dr. Smith', '1234'));
    vr.pause({ length: 1 });
    saySafeSSML(vr, ttsDirections('Test Clinic'));
    vr.pause({ length: 1 });
    saySafeSSML(vr, ttsGoodbye());
    vr.hangup();
    
    const twimlXml = getTwimlXml(vr);
    res.type('text/xml').send(twimlXml);
  });
}
