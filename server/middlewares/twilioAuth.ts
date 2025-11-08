import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import { env } from '../utils/env';

declare module 'express-serve-static-core' {
  interface Request {
    twilioValid?: boolean;
  }
}

export function validateTwilioSignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers['x-twilio-signature'] as string;
  
  // Compute full URL as Twilio sees it (trust proxy must be enabled)
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  
  // Use rawBody for signature validation (set by express.json verify callback)
  const rawBody = (req as any).rawBody;
  const params = req.body || {};
  
  // Validate signature
  let valid = false;
  if (signature && env.TWILIO_AUTH_TOKEN) {
    try {
      valid = twilio.validateRequest(
        env.TWILIO_AUTH_TOKEN,
        signature,
        fullUrl,
        rawBody ? JSON.parse(rawBody.toString()) : params
      );
    } catch (err) {
      console.error('[SIGCHK] Error validating signature:', err);
      valid = false;
    }
  }
  
  // Log signature check result
  console.log('[SIGCHK]', { 
    fullUrl, 
    valid, 
    hasSignature: !!signature,
    appMode: process.env.APP_MODE || 'TEST'
  });
  
  req.twilioValid = valid;
  
  // Handle invalid signatures based on APP_MODE
  const appMode = (process.env.APP_MODE || 'TEST').toUpperCase();
  
  if (!valid) {
    if (appMode === 'PROD') {
      // In PROD mode, respond with valid TwiML apology
      console.warn('[SIGCHK] PROD mode: Invalid signature, returning TwiML apology');
      const vr = new twilio.twiml.VoiceResponse();
      vr.say('Sorry, there was a problem. Please try again.');
      return res.type('text/xml').send(vr.toString());
    } else {
      // In TEST mode, log warning and continue
      console.warn('[SIGCHK] TEST mode: Invalid signature, continuing anyway for', fullUrl);
    }
  }
  
  next();
}
