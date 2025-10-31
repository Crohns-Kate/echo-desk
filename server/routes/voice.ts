import { Request, Response, Express } from 'express';
import twilio from 'twilio';
import { validateTwilioSignature } from '../middlewares/twilioAuth';
import { env } from '../utils/env';
import { storage } from '../storage';
import { say, saySSML, gather } from '../utils/say';
import { safeSpoken } from '../utils/tts-guard';
import { abs } from '../utils/url';
import { detectIntent } from '../services/intent';
import { getAvailability, createAppointmentForPatient } from '../services/cliniko';

function twiml(res: Response, builder: (vr: twilio.twiml.VoiceResponse) => void) {
  const vr = new twilio.twiml.VoiceResponse();
  builder(vr);
  const xml = vr.toString();
  console.log('[VOICE][TwiML OUT]', xml);
  res.type('text/xml').send(xml);
}

export function registerVoice(app: Express) {
  // Incoming call - greet and gather
  app.post('/api/voice/incoming', validateTwilioSignature, async (req: Request, res: Response) => {
    try {
      const params = (req as any).twilioParams;
      const callSid = params.CallSid;
      const from = params.From;
      const to = params.To;
      const tenant = await storage.getTenant('default');

      if (!tenant) {
        throw new Error('No tenant configured');
      }

      twiml(res, (vr) => {
        // Optional recording
        if (env.CALL_RECORDING_ENABLED) {
          vr.record({ 
            recordingStatusCallback: abs('/api/voice/recording'), 
            recordingStatusCallbackMethod: 'POST', 
            trim: 'do-not-trim' 
          } as any);
        }

        // Gather initial response
        const actionUrl = abs(`/api/voice/handle?route=start`);
        const g = gather(vr, actionUrl);

        // Greeting
        saySSML(g, `<speak>${tenant.greeting} <break time="300ms"/> How can I help you today?</speak>`);
        g.pause({ length: 1 });

        vr.redirect({ method: 'POST' }, abs(`/api/voice/handle?route=timeout`));
      });

      // Log call
      await storage.logCall({ 
        tenantId: tenant.id, 
        callSid, 
        fromNumber: from, 
        toNumber: to 
      });
    } catch (e) {
      console.error('incoming error', e);
      twiml(res, (vr) => { say(vr, 'Sorry, there was a problem. Goodbye'); });
    }
  });

  // Recording callback
  app.post('/api/voice/recording', async (req: Request, res: Response) => {
    console.log('[RECORDING]', req.body);
    res.status(204).end();
  });

  // Handle conversation flow
  app.post('/api/voice/handle', validateTwilioSignature, async (req: Request, res: Response) => {
    const p = (req as any).twilioParams;
    const route = (req.query.route as string) || 'start';
    const speech = (p.SpeechResult || '').trim();
    const from = p.From;
    const callSid = p.CallSid;
    const tenant = await storage.getTenant('default');

    if (!tenant) {
      return twiml(res, (vr) => { say(vr, 'Service unavailable. Goodbye'); });
    }

    const saySafe = (node: any, text: string) => {
      const t = safeSpoken(text);
      if (t) say(node, t);
    };

    try {
      // Timeout - reprompt
      if (route === 'timeout') {
        return twiml(res, (vr) => {
          const g = gather(vr, abs('/api/voice/handle?route=start'));
          saySafe(g, 'Sorry, I did not catch that. How can I help?');
          g.pause({ length: 1 });
        });
      }

      // Start - detect intent
      if (route === 'start') {
        const det = await detectIntent(speech || '');
        
        // Identity capture gate
        const id = await storage.getPhoneMap(from);
        const hasName = !!id?.fullName;
        const hasEmail = !!id?.email;
        
        if (env.IDENTITY_CAPTURE && (det.intent === 'book' || det.intent === 'reschedule') && (!hasName || !hasEmail)) {
          return twiml(res, (vr) => {
            vr.redirect({ method: 'POST' }, abs('/api/voice/wizard?step=1'));
          });
        }

        // Route by intent
        switch (det.intent) {
          case 'book':
            return twiml(res, (vr) => {
              const g = gather(vr, abs('/api/voice/handle?route=book-day'));
              saySafe(g, 'Which day suits you?');
            });
          
          case 'reschedule':
            return twiml(res, (vr) => {
              const g = gather(vr, abs('/api/voice/handle?route=reschedule-day'));
              saySafe(g, 'Okay, which day would you like instead?');
            });
          
          case 'cancel':
            return twiml(res, (vr) => {
              const g = gather(vr, abs('/api/voice/handle?route=offer-reschedule'));
              saySafe(g, 'Okay, would you like to reschedule instead of cancelling?');
            });
          
          case 'human':
            await storage.createAlert({ 
              tenantId: tenant.id, 
              reason: 'human_request', 
              payload: { from, callSid } 
            });
            return twiml(res, (vr) => { 
              saySafe(vr, 'No problem. A receptionist will call you back shortly. Goodbye'); 
            });
          
          case 'hours':
            return twiml(res, (vr) => { 
              saySafe(vr, 'We are open weekdays nine to five. Goodbye'); 
            });
          
          default:
            return twiml(res, (vr) => {
              const g = gather(vr, abs('/api/voice/handle?route=start'));
              saySafe(g, 'Sorry, could you say that another way?');
            });
        }
      }

      // Booking flow - day
      if (route === 'book-day' || route === 'reschedule-day') {
        return twiml(res, (vr) => {
          const g = gather(vr, abs(`/api/voice/handle?route=${route.replace('day','part')}`));
          saySafe(g, 'Morning or afternoon?');
        });
      }

      // Booking flow - part
      if (route === 'book-part' || route === 'reschedule-part') {
        const slots = await getAvailability();
        return twiml(res, (vr) => {
          const g = gather(vr, abs(`/api/voice/handle?route=${route.replace('part','choose')}`));
          saySafe(g, 'I have two options. Option one or option two?');
        });
      }

      // Booking flow - choose
      if (route === 'book-choose' || route === 'reschedule-choose') {
        const slots = await getAvailability();
        const chosen = slots[0];
        const apt = await createAppointmentForPatient(from, {
          practitionerId: chosen.practitionerId,
          appointmentTypeId: chosen.appointmentTypeId,
          startsAt: chosen.startIso,
          notes: route.startsWith('reschedule') ? 'Rescheduled via EchoDesk' : 'Booked via EchoDesk'
        });
        return twiml(res, (vr) => {
          say(vr, 'All set. We will send a confirmation by message. Goodbye');
        });
      }

      // Cancel - offer reschedule
      if (route === 'offer-reschedule') {
        const yes = /\b(yes|yeah|ok|sure|please)\b/i.test(speech);
        if (yes) {
          return twiml(res, (vr) => {
            const g = gather(vr, abs('/api/voice/handle?route=reschedule-day'));
            say(vr, 'Great. Which day works for you?');
          });
        } else {
          return twiml(res, (vr) => {
            say(vr, 'Understood. Your appointment is cancelled. Goodbye');
          });
        }
      }

      // Fallback
      return twiml(res, (vr) => {
        say(vr, 'Sorry, something went wrong. Goodbye');
      });

    } catch (e) {
      console.error('handle error', e);
      return twiml(res, (vr) => { say(vr, 'Sorry, there was a problem. Goodbye'); });
    }
  });

  // Identity wizard
  app.post('/api/voice/wizard', validateTwilioSignature, async (req: Request, res: Response) => {
    const p = (req as any).twilioParams;
    const step = parseInt((req.query.step as string) || '1');
    const speech = (p.SpeechResult || '').trim();
    const from = p.From;
    const tenant = await storage.getTenant('default');

    if (!tenant) {
      return twiml(res, (vr) => { say(vr, 'Service unavailable. Goodbye'); });
    }

    const saySafe = (node: any, text: string) => {
      const t = safeSpoken(text);
      if (t) say(node, t);
    };

    try {
      // Step 1: Ask for name
      if (step === 1) {
        return twiml(res, (vr) => {
          const g = gather(vr, abs('/api/voice/wizard?step=2'));
          saySafe(g, 'Before we continue, may I have your full name please?');
        });
      }

      // Step 2: Save name, ask for email
      if (step === 2) {
        const fullName = speech;
        const phoneData = await storage.getPhoneMap(from) || { phone: from };
        await storage.upsertPhoneMap({ ...phoneData, fullName });

        return twiml(res, (vr) => {
          const g = gather(vr, abs('/api/voice/wizard?step=3'));
          saySafe(g, 'Thank you. And your email address?');
        });
      }

      // Step 3: Save email, redirect to original intent
      if (step === 3) {
        const email = speech.toLowerCase().replace(/\s+at\s+/, '@').replace(/\s+dot\s+/, '.');
        const phoneData = await storage.getPhoneMap(from);
        if (phoneData) {
          await storage.upsertPhoneMap({ ...phoneData, email });
        }

        return twiml(res, (vr) => {
          say(vr, 'Perfect. Now, how can I help you?');
          vr.redirect({ method: 'POST' }, abs('/api/voice/handle?route=start'));
        });
      }

      // Fallback
      return twiml(res, (vr) => {
        say(vr, 'Sorry, something went wrong. Goodbye');
      });
    } catch (e) {
      console.error('wizard error', e);
      return twiml(res, (vr) => { say(vr, 'Sorry, there was a problem. Goodbye'); });
    }
  });
}
