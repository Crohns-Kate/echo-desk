import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import { env } from '../utils/env';

export function validateTwilioSignature(req: Request, res: Response, next: NextFunction) {
  const sig = req.headers['x-twilio-signature'] as string;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${proto}://${host}${req.originalUrl}`;
  const params = req.body || {};
  
  // In development, skip validation if no signature present
  const valid = sig ? twilio.validateRequest(env.TWILIO_AUTH_TOKEN, sig, url, params) : (env.NODE_ENV === 'development');
  
  if (!valid) {
    console.warn('[Twilio] Invalid signature for', url);
  }
  
  (req as any).twilioParams = params;
  next();
}
