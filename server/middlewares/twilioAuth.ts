import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';

export function validateTwilioSignature(req: Request, res: Response, next: NextFunction) {
  try {
    const token = process.env.TWILIO_AUTH_TOKEN;
    const signature = req.headers["x-twilio-signature"] as string;
    const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    
    // Get body - either raw buffer or parsed params
    let params: Record<string, any> = {};
    if (req.body instanceof Buffer) {
      // Parse raw body into params for signature validation
      const rawBody = req.body.toString("utf8");
      const urlParams = new URLSearchParams(rawBody);
      urlParams.forEach((value, key) => {
        params[key] = value;
      });
    } else {
      params = req.body || {};
    }

    if (process.env.APP_MODE === "TEST") {
      console.log("[SIGCHK][TEST MODE] skipped validation", { fullUrl });
      return next();
    }

    const valid = twilio.validateRequest(token || "", signature || "", fullUrl, params);
    console.log("[SIGCHK]", { fullUrl, valid });

    if (!valid) {
      const vr = new twilio.twiml.VoiceResponse();
      vr.say({ voice: "alice", language: "en-AU" }, "Sorry, we could not verify this call. Please try again later.");
      return res.type("text/xml").send(vr.toString());
    }

    next();
  } catch (err) {
    console.error("[SIGCHK][ERROR]", err);
    const vr = new twilio.twiml.VoiceResponse();
    vr.say({ voice: "alice", language: "en-AU" }, "Sorry, there was a problem verifying your call.");
    return res.type("text/xml").send(vr.toString());
  }
}
