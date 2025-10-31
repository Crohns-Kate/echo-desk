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
import { 
  speakTimeAU, 
  speakDayAU, 
  dateOnlyAU, 
  isMorningAU,
  tomorrowAU,
  todayAU,
  formatAppointmentTimeAU
} from '../utils/tz';

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

      // Booking flow - day (parse user's day choice)
      if (route === 'book-day' || route === 'reschedule-day') {
        const speech = (req.body.SpeechResult || '').toLowerCase();
        const aptId = req.query.aptId as string | undefined;
        const aptIdParam = aptId ? `&aptId=${aptId}` : '';
        
        // Get conversation from call log
        const call = await storage.getCallByCallSid(callSid);
        const conversation = call?.conversationId ? await storage.getConversation(call.conversationId) : null;
        
        // Parse day from speech (simple handling - can be enhanced with NLP)
        let localDate = tomorrowAU(); // default to tomorrow
        
        if (speech.includes('today')) {
          localDate = todayAU();
        } else if (speech.includes('tomorrow')) {
          localDate = tomorrowAU();
        } else if (speech.includes('monday') || speech.includes('tuesday') || 
                   speech.includes('wednesday') || speech.includes('thursday') || 
                   speech.includes('friday')) {
          // For weekday names, find the next occurrence
          const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const targetDay = days.findIndex(d => speech.includes(d));
          if (targetDay !== -1) {
            const now = new Date();
            const currentDay = now.getDay();
            let daysToAdd = targetDay - currentDay;
            if (daysToAdd <= 0) daysToAdd += 7; // next week if already passed
            const targetDate = new Date(now);
            targetDate.setDate(targetDate.getDate() + daysToAdd);
            localDate = dateOnlyAU(targetDate.toISOString());
          }
        }
        
        // Store the chosen date in conversation context
        if (conversation) {
          const existingContext = conversation.context as any || {};
          await storage.updateConversation(conversation.id, {
            context: {
              ...existingContext,
              bookingDate: localDate,
              isReschedule: route.startsWith('reschedule')
            }
          });
        }
        
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

      // Booking flow - part (fetch real slots and speak them)
      if (route === 'book-part' || route === 'reschedule-part') {
        const speech = (req.body.SpeechResult || '').toLowerCase();
        const aptId = req.query.aptId as string | undefined;
        const aptIdParam = aptId ? `&aptId=${aptId}` : '';
        
        // Get conversation to retrieve stored booking date
        const call = await storage.getCallByCallSid(callSid);
        const conversation = call?.conversationId ? await storage.getConversation(call.conversationId) : null;
        const context = conversation?.context as any || {};
        const bookingDate = context.bookingDate || tomorrowAU();
        
        // Determine if morning or afternoon
        const wantMorning = speech.includes('morning');
        
        // Fetch all slots for the chosen date
        const allSlots = await getAvailability({ dayIso: bookingDate });
        
        // Filter by morning/afternoon in AU timezone
        const filteredSlots = allSlots.filter(slot => 
          wantMorning ? isMorningAU(slot.startIso) : !isMorningAU(slot.startIso)
        );
        
        // Take first two slots
        const twoSlots = filteredSlots.slice(0, 2);
        
        // Store slots in conversation context
        if (conversation) {
          await storage.updateConversation(conversation.id, {
            context: {
              ...context,
              availableSlots: twoSlots,
              wantMorning
            }
          });
        }
        
        // Build response based on available slots
        if (twoSlots.length === 0) {
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=${route}&callSid=${encodeURIComponent(callSid)}${aptIdParam}`),
              method: 'POST'
            });
            say(g, `I could not find times in the ${wantMorning ? 'morning' : 'afternoon'}. Would you like the ${wantMorning ? 'afternoon' : 'morning'} instead`);
            pause(g, 1);
          });
        } else if (twoSlots.length === 1) {
          const time1 = speakTimeAU(twoSlots[0].startIso);
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
            say(g, `I have ${time1}. Would you like to take that time`);
            pause(g, 1);
          });
        } else {
          const time1 = speakTimeAU(twoSlots[0].startIso);
          const time2 = speakTimeAU(twoSlots[1].startIso);
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
            say(g, `I have two options. Option one ${time1} or option two ${time2}`);
            pause(g, 1);
          });
        }
      }

      // Booking flow - choose (parse choice and book)
      if (route === 'book-choose' || route === 'reschedule-choose') {
        const speech = (req.body.SpeechResult || '').toLowerCase();
        const aptId = req.query.aptId as string | undefined;
        
        // Get conversation to retrieve stored slots
        const call = await storage.getCallByCallSid(callSid);
        const conversation = call?.conversationId ? await storage.getConversation(call.conversationId) : null;
        const context = conversation?.context as any || {};
        const availableSlots = context.availableSlots || [];
        
        // Parse user's choice
        let chosen = null;
        if (/one|1|first/i.test(speech) && availableSlots.length >= 1) {
          chosen = availableSlots[0];
        } else if (/two|2|second/i.test(speech) && availableSlots.length >= 2) {
          chosen = availableSlots[1];
        } else if (/yes|yeah|sure|ok/i.test(speech) && availableSlots.length === 1) {
          // If only one option was offered and user says "yes"
          chosen = availableSlots[0];
        }
        
        // If no valid choice, ask again
        if (!chosen) {
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=${route}&callSid=${encodeURIComponent(callSid)}${aptId ? `&aptId=${aptId}` : ''}`),
              method: 'POST'
            });
            say(g, 'Sorry I did not catch that. Say option one or option two');
            pause(g, 1);
          });
        }
        
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
            summary: `${route.startsWith('reschedule') ? 'Rescheduled' : 'Booked'} appointment for ${formatAppointmentTimeAU(chosen.startIso)}`
          });
          
          if (updatedCall) {
            emitCallUpdated(updatedCall);
          }
        }
        
        // Send SMS confirmation with AU timezone formatting
        const aptDate = formatAppointmentTimeAU(chosen.startIso);
        
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
