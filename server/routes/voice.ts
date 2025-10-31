import { Request, Response, Express } from 'express';
import twilio from 'twilio';
import { validateTwilioSignature } from '../middlewares/twilioAuth';
import { env } from '../utils/env';
import { storage } from '../storage';
import { abs } from '../utils/url';
import { say, pause } from '../utils/voice-constants';
import { detectIntent } from '../services/intent';
import { 
  getAvailability, 
  createAppointmentForPatient,
  getPatientAppointments,
  cancelAppointment,
  rescheduleAppointment,
  sanitizeEmail
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

export function registerVoice(app: Express) {
  // Incoming call - greet and gather (NO <Start/> - eliminates Twilio 13520)
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

      // Gather for speech with Australian English
      const g = vr.gather({
        input: ['speech'],
        language: 'en-AU',
        timeout: 5,
        speechTimeout: 'auto',
        actionOnEmptyResult: true,
        action: handleUrl,
        method: 'POST'
      });

      // bargeIn goes on Say, not Gather
      say(g, "Hello and welcome to your clinic how can I help you today");
      pause(g, 1);

      // Safety net if no input
      vr.redirect({ method: 'POST' }, timeoutUrl);

      const xml = vr.toString();
      console.log('[VOICE][INCOMING TwiML]', xml);
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
    } catch (err: any) {
      console.error('[VOICE][INCOMING ERROR]', err?.stack || err);
      const fail = new twilio.twiml.VoiceResponse();
      say(fail, 'Sorry there was a problem Please try again later Goodbye');
      const xml = fail.toString();
      console.log('[VOICE][INCOMING OUT][FAIL]', xml);
      res.type('text/xml').send(xml);
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
    try {
      const vr = new twilio.twiml.VoiceResponse();
      const p = (req as any).twilioParams;
      const route = (req.query.route as string) || 'start';
      const speech = (p.SpeechResult || '').trim();
      const from = p.From;
      const callSid = p.CallSid || (req.query.callSid as string);
      const confidence = p.Confidence;
      
      console.log('[VOICE][HANDLE IN]', { route, callSid, speech, confidence });
      
      const tenant = await storage.getTenant('default');

      if (!tenant) {
        say(vr, 'Service unavailable goodbye');
        const xml = vr.toString();
        console.log('[VOICE][HANDLE OUT no-tenant]', xml);
        return res.type('text/xml').send(xml);
      }

      // Route: timeout -> polite reprompt
      if (route === 'timeout') {
        const g = vr.gather({
          input: ['speech'],
          language: 'en-AU',
          timeout: 5,
          speechTimeout: 'auto',
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`),
          method: 'POST'
        });
        say(g, 'Sorry I did not catch that please say what you need like book an appointment or reschedule');
        pause(g, 1);
        
        const xml = vr.toString();
        console.log('[VOICE][HANDLE OUT timeout]', xml);
        return res.type('text/xml').send(xml);
      }

      // Empty speech -> redirect to timeout
      if (!speech) {
        vr.redirect({ method: 'POST' }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        const xml = vr.toString();
        console.log('[VOICE][HANDLE OUT no-speech]', xml);
        return res.type('text/xml').send(xml);
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
              const assistantMsg = 'Which day suits you';
              await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
              
              return twiml(res, (vr) => {
                const g = vr.gather({
                  input: ['speech'],
                  language: 'en-AU',
                  timeout: 5,
                  speechTimeout: 'auto',
                  actionOnEmptyResult: true,
                  action: abs(`/api/voice/handle?route=book-day&callSid=${encodeURIComponent(callSid)}`),
                  method: 'POST'
                });
                say(g, assistantMsg);
                pause(g, 1);
              });
            }
          
          case 'reschedule':
            {
              const appointments = await getPatientAppointments(from);
              if (appointments.length === 0) {
                const assistantMsg = 'I could not find any upcoming appointments Would you like to book a new one Call back when ready Goodbye';
                await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
                
                return twiml(res, (vr) => {
                  say(vr, assistantMsg);
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
                const assistantMsg = 'I could not find any upcoming appointments Goodbye';
                await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
                
                return twiml(res, (vr) => {
                  say(vr, assistantMsg);
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
                say(vr, assistantMsg); 
              });
            }
          
          case 'hours':
            {
              const assistantMsg = 'We are open weekdays nine to five Goodbye';
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
                say(vr, assistantMsg); 
              });
            }
          
          default:
            {
              const assistantMsg = 'Sorry could you say that another way';
              await updateConversationTurns(conversation?.id, speech || '', assistantMsg, det.intent, det.confidence);
              
              return twiml(res, (vr) => {
                const g = vr.gather({
                  input: ['speech'],
                  language: 'en-AU',
                  timeout: 5,
                  speechTimeout: 'auto',
                  actionOnEmptyResult: true,
                  action: abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`),
                  method: 'POST'
                });
                say(g, assistantMsg);
                pause(g, 1);
              });
            }
        }
      }

      // Booking flow - day
      if (route === 'book-day' || route === 'reschedule-day') {
        const aptId = req.query.aptId as string | undefined;
        const aptIdParam = aptId ? `&aptId=${aptId}` : '';
        return twiml(res, (vr) => {
          const g = vr.gather({
            input: ['speech'],
            language: 'en-AU',
            timeout: 5,
            speechTimeout: 'auto',
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=${route.replace('day','part')}&callSid=${encodeURIComponent(callSid)}${aptIdParam}`),
            method: 'POST'
          });
          say(g, 'Morning or afternoon');
          pause(g, 1);
        });
      }

      // Booking flow - part
      if (route === 'book-part' || route === 'reschedule-part') {
        const aptId = req.query.aptId as string | undefined;
        const aptIdParam = aptId ? `&aptId=${aptId}` : '';
        const slots = await getAvailability();
        return twiml(res, (vr) => {
          const g = vr.gather({
            input: ['speech'],
            language: 'en-AU',
            timeout: 5,
            speechTimeout: 'auto',
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=${route.replace('part','choose')}&callSid=${encodeURIComponent(callSid)}${aptIdParam}`),
            method: 'POST'
          });
          say(g, 'I have two options Option one or option two');
          pause(g, 1);
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
            businessId: chosen.businessId,
            duration: chosen.duration,
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
            say(vr, 'No appointments found Goodbye');
          });
        }
        
        const aptDate = new Date(apt.starts_at).toLocaleDateString('en-AU', { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric' 
        });
        
        return twiml(res, (vr) => {
          const g = vr.gather({
            input: ['speech'],
            language: 'en-AU',
            timeout: 5,
            speechTimeout: 'auto',
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=reschedule-confirm&callSid=${encodeURIComponent(callSid)}&aptId=${apt.id}`),
            method: 'POST'
          });
          say(g, `I found your appointment on ${aptDate} Would you like to reschedule it`);
          pause(g, 1);
        });
      }
      
      // Confirm reschedule
      if (route === 'reschedule-confirm') {
        const yes = /\b(yes|yeah|ok|sure|please)\b/i.test(speech);
        const aptId = req.query.aptId as string;
        
        if (yes) {
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=reschedule-day&callSid=${encodeURIComponent(callSid)}&aptId=${aptId}`),
              method: 'POST'
            });
            say(g, 'Great Which day works for you');
            pause(g, 1);
          });
        } else {
          return twiml(res, (vr) => {
            say(vr, 'Okay your appointment remains unchanged Goodbye');
          });
        }
      }
      
      // Lookup appointment for cancellation
      if (route === 'cancel-lookup') {
        const appointments = await getPatientAppointments(from);
        const apt = appointments[0];
        
        if (!apt) {
          return twiml(res, (vr) => {
            say(vr, 'No appointments found Goodbye');
          });
        }
        
        const aptDate = new Date(apt.starts_at).toLocaleDateString('en-AU', { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric' 
        });
        
        return twiml(res, (vr) => {
          const g = vr.gather({
            input: ['speech'],
            language: 'en-AU',
            timeout: 5,
            speechTimeout: 'auto',
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=cancel-confirm&callSid=${encodeURIComponent(callSid)}&aptId=${apt.id}`),
            method: 'POST'
          });
          say(g, `I found your appointment on ${aptDate} Would you like to cancel it or reschedule instead`);
          pause(g, 1);
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
            say(vr, 'Your appointment has been cancelled Goodbye');
          });
        } else if (reschedule) {
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=reschedule-day&callSid=${encodeURIComponent(callSid)}&aptId=${aptId}`),
              method: 'POST'
            });
            say(g, 'Great Which day works for you');
            pause(g, 1);
          });
        } else {
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=cancel-confirm&callSid=${encodeURIComponent(callSid)}&aptId=${aptId}`),
              method: 'POST'
            });
            say(g, 'Please say cancel or reschedule');
            pause(g, 1);
          });
        }
      }

      // Fallback
      return twiml(res, (vr) => {
        say(vr, 'Sorry, something went wrong. Goodbye');
      });

    } catch (err: any) {
      console.error('[VOICE][HANDLE ERROR]', err?.stack || err);
      const fail = new twilio.twiml.VoiceResponse();
      say(fail, 'Sorry there was a problem Please try again later Goodbye');
      const xml = fail.toString();
      console.log('[VOICE][HANDLE OUT][FAIL]', xml);
      return res.type('text/xml').send(xml);
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
      return twiml(res, (vr) => { say(vr, 'Service unavailable Goodbye'); });
    }

    try {
      // Step 1: Ask for name
      if (step === 1) {
        return twiml(res, (vr) => {
          const g = vr.gather({
            input: ['speech'],
            language: 'en-AU',
            timeout: 5,
            speechTimeout: 'auto',
            actionOnEmptyResult: true,
            action: abs(`/api/voice/wizard?step=2&callSid=${encodeURIComponent(callSid)}&intent=${intent}`),
            method: 'POST'
          });
          say(g, 'Before we continue may I have your full name please');
          pause(g, 1);
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
          const g = vr.gather({
            input: ['speech'],
            language: 'en-AU',
            timeout: 5,
            speechTimeout: 'auto',
            actionOnEmptyResult: true,
            action: abs(`/api/voice/wizard?step=3&callSid=${encodeURIComponent(callSid)}&intent=${intent}`),
            method: 'POST'
          });
          say(g, 'Thank you And your email address');
          pause(g, 1);
        });
      }

      // Step 3: Save email, redirect to original intent
      if (step === 3) {
        const emailRaw = speech.toLowerCase().replace(/\s+at\s+/, '@').replace(/\s+dot\s+/, '.');
        const email = sanitizeEmail(emailRaw);
        
        // Validate email
        if (!email) {
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/wizard?step=3&callSid=${encodeURIComponent(callSid)}&intent=${intent}`),
              method: 'POST'
            });
            say(g, 'I might have misheard the email Could you say it again letter by letter');
            pause(g, 1);
          });
        }
        
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
          say(vr, 'Perfect Now how can I help you');
          vr.redirect({ method: 'POST' }, abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`));
        });
      }

      // Fallback
      return twiml(res, (vr) => {
        say(vr, 'Sorry, something went wrong. Goodbye');
      });
    } catch (err: any) {
      console.error('[VOICE][WIZARD ERROR]', err?.stack || err);
      const fail = new twilio.twiml.VoiceResponse();
      say(fail, 'Sorry there was a problem Please try again later Goodbye');
      const xml = fail.toString();
      console.log('[VOICE][WIZARD OUT][FAIL]', xml);
      return res.type('text/xml').send(xml);
    }
  });

  // Test route for TwiML validation
  app.post('/api/voice/ping', (req: Request, res: Response) => {
    return twiml(res, (vr) => {
      say(vr, 'Voice system test successful');
    });
  });

  // Test echo route for interactive TwiML validation
  app.post('/api/voice/test-echo', (req: Request, res: Response) => {
    try {
      return twiml(res, (vr) => {
        const g = vr.gather({
          input: ['speech'],
          language: 'en-AU',
          timeout: 5,
          speechTimeout: 'auto',
          actionOnEmptyResult: true,
          action: abs('/api/voice/test-echo'),
          method: 'POST'
        });
        say(g, 'I am listening Say anything to test');
        pause(g, 1);
      });
    } catch (err: any) {
      console.error('[VOICE][TEST-ECHO ERROR]', err?.stack || err);
      const fail = new twilio.twiml.VoiceResponse();
      say(fail, 'Test echo error');
      const xml = fail.toString();
      console.log('[VOICE][TEST-ECHO OUT][FAIL]', xml);
      return res.type('text/xml').send(xml);
    }
  });
}
