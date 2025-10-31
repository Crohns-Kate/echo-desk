import { Request, Response, Express } from 'express';
import twilio from 'twilio';
import { validateTwilioSignature } from '../middlewares/twilioAuth';
import { env } from '../utils/env';
import { storage } from '../storage';
import { say, saySSML, gather } from '../utils/say';
import { safeSpoken } from '../utils/tts-guard';
import { abs } from '../utils/url';
import { detectIntent } from '../services/intent';
import { 
  getAvailability, 
  createAppointmentForPatient,
  getPatientAppointments,
  cancelAppointment,
  rescheduleAppointment
} from '../services/cliniko';
import { 
  sendAppointmentConfirmation,
  sendAppointmentRescheduled,
  sendAppointmentCancelled
} from '../services/sms';
import { emitCallStarted, emitCallUpdated, emitAlertCreated } from '../services/websocket';

function twiml(res: Response, builder: (vr: twilio.twiml.VoiceResponse) => void) {
  const vr = new twilio.twiml.VoiceResponse();
  builder(vr);
  const xml = vr.toString();
  console.log('[VOICE][TwiML OUT]', xml);
  res.type('text/xml').send(xml);
}

// Helper to update conversation context with user and assistant turns
async function updateConversationTurns(
  conversationId: number | undefined,
  userUtterance: string,
  assistantResponse: string,
  intent?: string,
  confidence?: number
) {
  if (!conversationId) return;
  
  const conversation = await storage.getConversation(conversationId);
  if (!conversation) return;
  
  const existingContext = conversation.context as any;
  const turns = existingContext?.turns || [];
  
  const updatedContext = {
    turns: [
      ...turns,
      { role: 'user' as const, content: userUtterance },
      { role: 'assistant' as const, content: assistantResponse },
    ],
    previousIntent: intent || existingContext?.previousIntent,
    previousConfidence: confidence || existingContext?.previousConfidence,
  };
  
  await storage.updateConversation(conversationId, {
    context: updatedContext as any,
  });
}

// Helper to sanitize text for Polly TTS (eliminates Twilio 13520 errors)
function sanitizeForPolly(text: string | undefined) {
  return String(text || '')
    .replace(/[^\x20-\x7E]/g, ' ')  // ASCII only
    .replace(/[.,!?;:]/g, '')       // remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// Multi-level fallback for voice synthesis
function sayWithFallback(node: any, rawText: string) {
  const text = sanitizeForPolly(rawText);
  try {
    // Primary: Polly.Olivia-Neural (works reliably in AU region)
    node.say({ voice: 'Polly.Olivia-Neural' as any }, text);
  } catch (e1: any) {
    console.warn('[VOICE] Polly.Olivia-Neural failed:', e1?.message || e1);
    try {
      // Fallback 1: Polly.Nicole (standard quality)
      node.say({ voice: 'Polly.Nicole' as any }, text);
    } catch (e2: any) {
      console.warn('[VOICE] Polly.Nicole failed:', e2?.message || e2);
      // Fallback 2: Alice (Twilio default)
      node.say({ voice: 'alice' as any }, text);
    }
  }
}

export function registerVoice(app: Express) {
  // Incoming call - greet and gather (NO <Start/> - causes errors)
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

      const vr = new twilio.twiml.VoiceResponse();
      const handleUrl = abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`);
      const timeoutUrl = abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`);

      const greeting = `${tenant.greeting} how can I help you today`;

      // Gather for speech
      const g = vr.gather({
        input: ['speech'],
        timeout: 5,
        speechTimeout: 'auto',   // must be string
        actionOnEmptyResult: true,
        bargeIn: true,
        action: handleUrl,
        method: 'POST'
      });

      // Use Polly.Olivia-Neural with multi-level fallback
      sayWithFallback(g, greeting);
      g.pause({ length: 1 });

      // Safety net if no input
      vr.redirect({ method: 'POST' }, timeoutUrl);

      const xml = vr.toString();
      console.log('[VOICE][TwiML OUT]', xml);
      res.type('text/xml').send(xml);

      // Create conversation for context tracking
      const conversation = await storage.createConversation(tenant.id, undefined, true);
      
      // Log call with conversation ID
      const call = await storage.logCall({ 
        tenantId: tenant.id,
        conversationId: conversation.id,
        callSid, 
        fromNumber: from, 
        toNumber: to 
      });
      
      // Emit WebSocket event for new call
      emitCallStarted(call);
    } catch (err) {
      console.error('[VOICE][ERROR][incoming]', err);
      const vr = new twilio.twiml.VoiceResponse();
      vr.say({ voice: 'alice' as any }, 'sorry there was a problem goodbye');
      res.type('text/xml').send(vr.toString());
    }
  });

  // Recording callback - save recording URL
  app.post('/api/voice/recording', async (req: Request, res: Response) => {
    const { CallSid, RecordingUrl, RecordingDuration } = req.body;
    console.log('[RECORDING]', { CallSid, RecordingUrl, RecordingDuration });
    
    if (CallSid && RecordingUrl) {
      const updatedCall = await storage.updateCall(CallSid, { 
        recordingUrl: RecordingUrl,
        duration: parseInt(RecordingDuration || '0')
      });
      
      if (updatedCall) {
        emitCallUpdated(updatedCall);
      }
    }
    
    res.status(204).end();
  });

  // Transcription callback - save transcript
  app.post('/api/voice/transcription', async (req: Request, res: Response) => {
    const { CallSid, TranscriptionText } = req.body;
    console.log('[TRANSCRIPTION]', { CallSid, TranscriptionText });
    
    if (CallSid && TranscriptionText) {
      const updatedCall = await storage.updateCall(CallSid, { transcript: TranscriptionText });
      
      if (updatedCall) {
        emitCallUpdated(updatedCall);
      }
    }
    
    res.status(204).end();
  });

  // Handle conversation flow
  app.post('/api/voice/handle', validateTwilioSignature, async (req: Request, res: Response) => {
    const p = (req as any).twilioParams;
    const route = (req.query.route as string) || 'start';
    const speech = (p.SpeechResult || '').trim();
    const from = p.From;
    const callSid = p.CallSid || (req.query.callSid as string);
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
          const g = gather(vr, abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`));
          saySafe(g, 'Sorry, I did not catch that. How can I help?');
          g.pause({ length: 1 });
        });
      }

      // Start - detect intent
      if (route === 'start') {
        // Get call and conversation for context
        const call = callSid ? await storage.getCallByCallSid(callSid) : undefined;
        const conversation = call?.conversationId ? await storage.getConversation(call.conversationId) : undefined;
        
        // Build conversation context from JSONB
        const conversationContext = conversation?.context as any;
        const turns = conversationContext?.turns || [];
        
        // Detect intent with conversation context
        const det = await detectIntent(speech || '', {
          turns,
          previousIntent: conversationContext?.previousIntent,
          confidence: conversationContext?.previousConfidence,
        });
        
        // Update call log with detected intent
        if (callSid && det.intent !== 'unknown') {
          const updatedCall = await storage.updateCall(callSid, { 
            intent: det.intent,
            summary: `Caller requested: ${det.intent} (confidence: ${(det.confidence * 100).toFixed(0)}%)`
          });
          
          if (updatedCall) {
            emitCallUpdated(updatedCall);
          }
        }
        
        // Identity capture gate
        const id = await storage.getPhoneMap(from);
        const hasName = !!id?.fullName;
        const hasEmail = !!id?.email;
        
        if (env.IDENTITY_CAPTURE && (det.intent === 'book' || det.intent === 'reschedule') && (!hasName || !hasEmail)) {
          const assistantMsg = 'Redirecting to identity capture wizard';
          await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
          
          return twiml(res, (vr) => {
            vr.redirect({ method: 'POST' }, abs(`/api/voice/wizard?step=1&callSid=${encodeURIComponent(callSid)}&intent=${det.intent}`));
          });
        }

        // Route by intent
        switch (det.intent) {
          case 'book':
            {
              const assistantMsg = 'Which day suits you?';
              await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
              
              return twiml(res, (vr) => {
                const g = gather(vr, abs(`/api/voice/handle?route=book-day&callSid=${encodeURIComponent(callSid)}`));
                saySafe(g, assistantMsg);
              });
            }
          
          case 'reschedule':
            {
              const appointments = await getPatientAppointments(from);
              if (appointments.length === 0) {
                const assistantMsg = 'I could not find any upcoming appointments. Would you like to book a new one? Call back when ready. Goodbye';
                await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
                
                return twiml(res, (vr) => {
                  saySafe(vr, assistantMsg);
                });
              }
              
              const assistantMsg = 'Looking up your appointments';
              await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
              
              return twiml(res, (vr) => {
                vr.redirect({ method: 'POST' }, abs(`/api/voice/handle?route=reschedule-lookup&callSid=${encodeURIComponent(callSid)}`));
              });
            }
          
          case 'cancel':
            {
              const appointments = await getPatientAppointments(from);
              if (appointments.length === 0) {
                const assistantMsg = 'I could not find any upcoming appointments. Goodbye';
                await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
                
                return twiml(res, (vr) => {
                  saySafe(vr, assistantMsg);
                });
              }
              
              const assistantMsg = 'Looking up your appointments for cancellation';
              await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
              
              return twiml(res, (vr) => {
                vr.redirect({ method: 'POST' }, abs(`/api/voice/handle?route=cancel-lookup&callSid=${encodeURIComponent(callSid)}`));
              });
            }
          
          case 'human':
            {
              const assistantMsg = 'No problem. A receptionist will call you back shortly. Goodbye';
              await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
              
              const alert = await storage.createAlert({ 
                tenantId: tenant.id, 
                reason: 'human_request', 
                payload: { from, callSid } 
              });
              
              // Emit WebSocket event for new alert
              emitAlertCreated(alert);
            
              if (callSid) {
                const updatedCall = await storage.updateCall(callSid, { 
                  summary: 'Caller requested to speak with receptionist'
                });
                
                if (updatedCall) {
                  emitCallUpdated(updatedCall);
                }
              }
              
              return twiml(res, (vr) => { 
                saySafe(vr, assistantMsg); 
              });
            }
          
          case 'hours':
            {
              const assistantMsg = 'We are open weekdays nine to five. Goodbye';
              await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
              
              if (callSid) {
                const updatedCall = await storage.updateCall(callSid, { 
                  summary: 'Caller inquired about clinic hours'
                });
                
                if (updatedCall) {
                  emitCallUpdated(updatedCall);
                }
              }
              
              return twiml(res, (vr) => { 
                saySafe(vr, assistantMsg); 
              });
            }
          
          default:
            {
              const assistantMsg = 'Sorry, could you say that another way?';
              await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
              
              return twiml(res, (vr) => {
                const g = gather(vr, abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`));
                saySafe(g, assistantMsg);
              });
            }
        }
      }

      // Booking flow - day
      if (route === 'book-day' || route === 'reschedule-day') {
        const aptId = req.query.aptId as string | undefined;
        const aptIdParam = aptId ? `&aptId=${aptId}` : '';
        return twiml(res, (vr) => {
          const g = gather(vr, abs(`/api/voice/handle?route=${route.replace('day','part')}&callSid=${encodeURIComponent(callSid)}${aptIdParam}`));
          saySafe(g, 'Morning or afternoon?');
        });
      }

      // Booking flow - part
      if (route === 'book-part' || route === 'reschedule-part') {
        const aptId = req.query.aptId as string | undefined;
        const aptIdParam = aptId ? `&aptId=${aptId}` : '';
        const slots = await getAvailability();
        return twiml(res, (vr) => {
          const g = gather(vr, abs(`/api/voice/handle?route=${route.replace('part','choose')}&callSid=${encodeURIComponent(callSid)}${aptIdParam}`));
          saySafe(g, 'I have two options. Option one or option two?');
        });
      }

      // Booking flow - choose
      if (route === 'book-choose' || route === 'reschedule-choose') {
        const slots = await getAvailability();
        const chosen = slots[0];
        const aptId = req.query.aptId as string | undefined;
        
        // Get caller identity
        const phoneData = await storage.getPhoneMap(from);
        
        let apt;
        if (route === 'reschedule-choose' && aptId) {
          apt = await rescheduleAppointment(aptId, chosen.startIso);
        } else {
          apt = await createAppointmentForPatient(from, {
            practitionerId: chosen.practitionerId,
            appointmentTypeId: chosen.appointmentTypeId,
            startsAt: chosen.startIso,
            notes: route.startsWith('reschedule') ? 'Rescheduled via EchoDesk' : 'Booked via EchoDesk',
            fullName: phoneData?.fullName || undefined,
            email: phoneData?.email || undefined
          });
        }
        
        // Update call log with appointment details
        if (callSid) {
          const updatedCall = await storage.updateCall(callSid, {
            summary: `${route.startsWith('reschedule') ? 'Rescheduled' : 'Booked'} appointment for ${new Date(chosen.startIso).toLocaleDateString('en-AU')}`
          });
          
          if (updatedCall) {
            emitCallUpdated(updatedCall);
          }
        }
        
        // Send SMS confirmation
        const aptDate = new Date(chosen.startIso).toLocaleDateString('en-AU', { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        });
        
        if (route === 'reschedule-choose') {
          await sendAppointmentRescheduled({
            to: from,
            appointmentDate: aptDate,
            clinicName: tenant.clinicName
          });
        } else {
          await sendAppointmentConfirmation({
            to: from,
            appointmentDate: aptDate,
            clinicName: tenant.clinicName
          });
        }
        
        return twiml(res, (vr) => {
          say(vr, 'All set. We will send a confirmation by message. Goodbye');
        });
      }

      // Lookup appointment for rescheduling
      if (route === 'reschedule-lookup') {
        const appointments = await getPatientAppointments(from);
        const apt = appointments[0];
        
        if (!apt) {
          return twiml(res, (vr) => {
            saySafe(vr, 'No appointments found. Goodbye');
          });
        }
        
        const aptDate = new Date(apt.starts_at).toLocaleDateString('en-AU', { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric' 
        });
        
        return twiml(res, (vr) => {
          const g = gather(vr, abs(`/api/voice/handle?route=reschedule-confirm&callSid=${encodeURIComponent(callSid)}&aptId=${apt.id}`));
          saySafe(g, `I found your appointment on ${aptDate}. Would you like to reschedule it?`);
        });
      }
      
      // Confirm reschedule
      if (route === 'reschedule-confirm') {
        const yes = /\b(yes|yeah|ok|sure|please)\b/i.test(speech);
        const aptId = req.query.aptId as string;
        
        if (yes) {
          return twiml(res, (vr) => {
            const g = gather(vr, abs(`/api/voice/handle?route=reschedule-day&callSid=${encodeURIComponent(callSid)}&aptId=${aptId}`));
            saySafe(g, 'Great. Which day works for you?');
          });
        } else {
          return twiml(res, (vr) => {
            saySafe(vr, 'Okay, your appointment remains unchanged. Goodbye');
          });
        }
      }
      
      // Lookup appointment for cancellation
      if (route === 'cancel-lookup') {
        const appointments = await getPatientAppointments(from);
        const apt = appointments[0];
        
        if (!apt) {
          return twiml(res, (vr) => {
            saySafe(vr, 'No appointments found. Goodbye');
          });
        }
        
        const aptDate = new Date(apt.starts_at).toLocaleDateString('en-AU', { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric' 
        });
        
        return twiml(res, (vr) => {
          const g = gather(vr, abs(`/api/voice/handle?route=cancel-confirm&callSid=${encodeURIComponent(callSid)}&aptId=${apt.id}`));
          saySafe(g, `I found your appointment on ${aptDate}. Would you like to cancel it or reschedule instead?`);
        });
      }
      
      // Confirm cancellation
      if (route === 'cancel-confirm') {
        const aptId = req.query.aptId as string;
        const cancel = /\b(cancel|yes)\b/i.test(speech);
        const reschedule = /\b(reschedule|change)\b/i.test(speech);
        
        if (cancel) {
          await cancelAppointment(aptId);
          
          if (callSid) {
            const updatedCall = await storage.updateCall(callSid, { 
              summary: 'Appointment cancelled successfully'
            });
            
            if (updatedCall) {
              emitCallUpdated(updatedCall);
            }
          }
          
          // Send SMS cancellation notice
          await sendAppointmentCancelled({
            to: from,
            clinicName: tenant.clinicName
          });
          
          return twiml(res, (vr) => {
            saySafe(vr, 'Your appointment has been cancelled. Goodbye');
          });
        } else if (reschedule) {
          return twiml(res, (vr) => {
            const g = gather(vr, abs(`/api/voice/handle?route=reschedule-day&callSid=${encodeURIComponent(callSid)}&aptId=${aptId}`));
            saySafe(g, 'Great. Which day works for you?');
          });
        } else {
          return twiml(res, (vr) => {
            const g = gather(vr, abs(`/api/voice/handle?route=cancel-confirm&callSid=${encodeURIComponent(callSid)}&aptId=${aptId}`));
            saySafe(g, 'Please say cancel or reschedule');
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
    const callSid = (req.query.callSid as string) || p.CallSid;
    const intent = (req.query.intent as string) || 'book';
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
          const g = gather(vr, abs(`/api/voice/wizard?step=2&callSid=${encodeURIComponent(callSid)}&intent=${intent}`));
          saySafe(g, 'Before we continue, may I have your full name please?');
        });
      }

      // Step 2: Save name, ask for email
      if (step === 2) {
        const fullName = speech;
        const phoneData = await storage.getPhoneMap(from);
        await storage.upsertPhoneMap({ 
          phone: from, 
          fullName,
          email: phoneData?.email,
          patientId: phoneData?.patientId
        });

        return twiml(res, (vr) => {
          const g = gather(vr, abs(`/api/voice/wizard?step=3&callSid=${encodeURIComponent(callSid)}&intent=${intent}`));
          saySafe(g, 'Thank you. And your email address?');
        });
      }

      // Step 3: Save email, redirect to original intent
      if (step === 3) {
        const email = speech.toLowerCase().replace(/\s+at\s+/, '@').replace(/\s+dot\s+/, '.');
        const phoneData = await storage.getPhoneMap(from);
        
        if (phoneData) {
          await storage.upsertPhoneMap({ 
            ...phoneData,
            email 
          });
        } else {
          await storage.upsertPhoneMap({
            phone: from,
            email
          });
        }

        // Update call summary
        if (callSid) {
          const updatedCall = await storage.updateCall(callSid, {
            summary: `Identity captured for ${email}`
          });
          
          if (updatedCall) {
            emitCallUpdated(updatedCall);
          }
        }

        return twiml(res, (vr) => {
          say(vr, 'Perfect. Now, how can I help you?');
          vr.redirect({ method: 'POST' }, abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`));
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
