import { Request, Response, Express } from 'express';
import twilio from 'twilio';
import { validateTwilioSignature } from '../middlewares/twilioAuth';
import { env } from '../utils/env';
import { storage } from '../storage';
import { abs } from '../utils/url';
import { say, pause, saySafe, BUSINESS_TZ } from '../utils/voice-constants';
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
import {
  nextWeekdayFromUtterance,
  isSameLocalDay,
  partOfDayFilter,
  filterSlotsByPartOfDay,
  AUST_TZ,
  localDayWindow,
  speakableTime,
  businessDayRange,
  isMorningLocal,
  labelForSpeech
} from '../time';
import dayjs from 'dayjs';

function twiml(res: Response, builder: (vr: twilio.twiml.VoiceResponse) => void) {
  const vr = new twilio.twiml.VoiceResponse();
  builder(vr);
  const xml = vr.toString();
  console.log('[VOICE][TwiML OUT]', xml);
  res.type('text/xml').send(xml);
}

// Helper to parse option index from user utterance or DTMF
function parseOptionIndex(utterance: string, digits: string | undefined, numOffered: number): number | null {
  // DTMF has priority (more explicit)
  if (digits === '1') return 0;
  if (digits === '2' && numOffered >= 2) return 1;
  
  // Speech fallback
  if (/\b(one|1|first)\b/i.test(utterance)) return 0;
  if (/\b(two|2|second)\b/i.test(utterance)) return 1;
  if (/\b(yes|yeah|sure|ok|okay)\b/i.test(utterance) && numOffered === 1) return 0;
  return null;
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
      const callSid = params?.CallSid || req.body?.CallSid || `test-${Date.now()}`;
      const from = params?.From || req.body?.From;
      const to = params?.To || req.body?.To;
      
      console.log('[VOICE][INCOMING]', { callSid, from, to, hasParams: !!params, bodyKeys: Object.keys(req.body || {}) });
      
      const tenant = await storage.getTenant('default');

      if (!tenant) {
        throw new Error('No tenant configured');
      }

      const vr = new twilio.twiml.VoiceResponse();
      const handleUrl = abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`);
      const timeoutUrl = abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`);

      // Log action URL for diagnostics
      console.log('[ACTION URL]', handleUrl);

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

      // Start call recording asynchronously via REST API (non-blocking)
      if (env.CALL_RECORDING_ENABLED) {
        setImmediate(async () => {
          try {
            const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
            const recordingCallbackUrl = abs('/api/voice/recording');
            
            await twilioClient.calls(callSid).recordings.create({
              recordingStatusCallback: recordingCallbackUrl,
              recordingStatusCallbackMethod: 'POST',
              recordingChannels: 'dual',
            });
            
            console.log('[RECORDING] Started via REST API for CallSid:', callSid);
          } catch (err) {
            console.error('[RECORDING] Failed to start recording:', err);
          }
        });
      }

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
      saySafe(fail, 'Sorry there was a problem Please try again later Goodbye');
      const xml = fail.toString();
      console.log('[VOICE][INCOMING OUT][FAIL]', xml);
      res.type('text/xml').send(xml);
    }
  });

  // Recording callback - save recording URL and SID
  app.post('/api/voice/recording', async (req: Request, res: Response) => {
    const { CallSid, RecordingSid, RecordingUrl, RecordingDuration } = req.body;
    console.log('[RECORDING]', { CallSid, RecordingSid, RecordingUrl, RecordingDuration });
    
    if (CallSid && RecordingUrl) {
      const updatedCall = await storage.updateCall(CallSid, { 
        recordingSid: RecordingSid,
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
      // Diagnostic logging at the very top
      console.log('[VOICE][HANDLE HIT]', { 
        route: req.query.route, 
        callSid: req.query.callSid || req.body?.CallSid 
      });

      const vr = new twilio.twiml.VoiceResponse();
      const p = (req as any).twilioParams || {};
      const route = (req.query.route as string) || 'start';
      const speech = (p.SpeechResult || req.body?.SpeechResult || '').trim();
      const from = p.From || req.body?.From;
      const callSid = p.CallSid || req.body?.CallSid || (req.query.callSid as string);
      const confidence = p.Confidence || req.body?.Confidence;
      
      console.log('[VOICE][HANDLE IN]', { 
        route, 
        callSid, 
        speech, 
        confidence,
        hasParams: !!((req as any).twilioParams),
        bodyKeys: Object.keys(req.body || {}),
        queryKeys: Object.keys(req.query || {})
      });
      
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
        
        // Use new time utility to parse weekday/today/tomorrow
        const when = nextWeekdayFromUtterance(speech);
        if (!when) {
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
            say(g, 'Which day suits you? For example Monday or Tuesday');
            pause(g, 1);
          });
        }
        
        // Store the exact ISO date for accurate filtering later
        const requestedDayISO = when.toISOString();
        
        // Store the chosen date in conversation context
        if (conversation) {
          const existingContext = conversation.context as any || {};
          await storage.updateConversation(conversation.id, {
            context: {
              ...existingContext,
              requestedDayISO,
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

      // Booking flow - part (fetch real slots and speak them with natural formatting)
      if (route === 'book-part' || route === 'reschedule-part') {
        const speech = (req.body.SpeechResult || '').toLowerCase();
        const aptId = req.query.aptId as string | undefined;
        const aptIdParam = aptId ? `&aptId=${aptId}` : '';
        
        // Get conversation to retrieve stored booking date
        const call = await storage.getCallByCallSid(callSid);
        const conversation = call?.conversationId ? await storage.getConversation(call.conversationId) : null;
        const context = conversation?.context as any || {};
        const requestedDayISO = context.requestedDayISO;
        
        if (!requestedDayISO) {
          // Redirect back to day selection if no date stored
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=${route.replace('part','day')}&callSid=${encodeURIComponent(callSid)}${aptIdParam}`),
              method: 'POST'
            });
            say(g, 'Which day would you like');
            pause(g, 1);
          });
        }
        
        // If user says "no" to fallback offer, go back to day selection
        if (/\b(no|nope|nah)\b/i.test(speech) && context.offeredFallback) {
          if (conversation) {
            await storage.updateConversation(conversation.id, {
              context: { ...context, offeredFallback: false }
            });
          }
          
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=${route.replace('part','day')}&callSid=${encodeURIComponent(callSid)}${aptIdParam}`),
              method: 'POST'
            });
            say(g, 'No problem. Which other day would work for you');
            pause(g, 1);
          });
        }
        
        // Determine part of day preference
        const part = partOfDayFilter(speech);
        let wantMorning = part === 'morning';
        
        // If user says "yes" to fallback offer, flip to the opposite time
        if (/\b(yes|yeah|sure|ok|okay)\b/i.test(speech) && context.offeredFallback) {
          wantMorning = !context.wantMorning;
        }
        
        // Store preference
        if (conversation && !context.offeredFallback) {
          await storage.updateConversation(conversation.id, {
            context: { ...context, wantMorning }
          });
        }
        
        // Calculate exact day window in Australia/Brisbane timezone
        const { fromDate, toDate } = localDayWindow(requestedDayISO, AUST_TZ);
        
        console.log(`[AVAIL] Fetching ${wantMorning ? 'morning' : 'afternoon'} slots for ${requestedDayISO} (from=${fromDate} to=${toDate})`);
        
        // Fetch slots for exact day with part-of-day filtering in Cliniko service
        const filteredSlots = await getAvailability({
          fromDate,
          toDate,
          part: wantMorning ? 'morning' : 'afternoon',
          timezone: AUST_TZ
        });
        
        console.log(`[AVAIL] Found ${filteredSlots.length} ${wantMorning ? 'morning' : 'afternoon'} slots on ${requestedDayISO}`);
        
        // Take first two slots
        const twoSlots = filteredSlots.slice(0, 2);
        
        // Store slots in conversation context
        if (conversation) {
          await storage.updateConversation(conversation.id, {
            context: {
              ...context,
              availableSlots: twoSlots,
              wantMorning,
              offeredFallback: false
            }
          });
        }
        
        // Build response with natural time formatting
        if (twoSlots.length === 0) {
          // Check opposite time
          const oppositePart = wantMorning ? 'afternoon' : 'morning';
          
          console.log(`[AVAIL] No ${wantMorning ? 'morning' : 'afternoon'} slots. Checking ${oppositePart}...`);
          
          const oppositeSlots = await getAvailability({
            fromDate,
            toDate,
            part: oppositePart,
            timezone: AUST_TZ
          });
          
          console.log(`[AVAIL] Found ${oppositeSlots.length} ${oppositePart} slots as fallback`);
          
          if (oppositeSlots.length > 0) {
            if (conversation) {
              await storage.updateConversation(conversation.id, {
                context: { ...context, offeredFallback: true }
              });
            }
            
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
              say(g, `I could not find times in the ${wantMorning ? 'morning' : 'afternoon'}. Would you like the ${oppositePart} instead`);
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
                action: abs(`/api/voice/handle?route=${route.replace('part','day')}&callSid=${encodeURIComponent(callSid)}${aptIdParam}`),
                method: 'POST'
              });
              say(g, 'Sorry no times available on that day. Which other day would work for you');
              pause(g, 1);
            });
          }
        } else if (twoSlots.length === 1) {
          const slot1 = twoSlots[0];
          if (!slot1) return; // Safety check
          
          // Store offered slot ISOs for exact booking
          if (conversation) {
            await storage.updateConversation(conversation.id, {
              context: { ...context, offeredSlotISOs: [slot1.startIso] }
            });
          }
          
          // Use labelForSpeech for clean natural pronunciation
          const time1Label = labelForSpeech(slot1.startIso, AUST_TZ);
          
          console.log(`[OFFER] 1 option: ${slot1.startIso} → "${time1Label}"`);
          
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech', 'dtmf'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=${route.replace('part','choose')}&callSid=${encodeURIComponent(callSid)}${aptIdParam}`),
              method: 'POST'
            });
            saySafe(g, `I have one option available. ${time1Label}. Press 1 or say your choice.`);
            pause(g, 1);
          });
        } else {
          const slot1 = twoSlots[0];
          const slot2 = twoSlots[1];
          if (!slot1 || !slot2) return; // Safety check
          
          // Store offered slot ISOs for exact booking
          if (conversation) {
            await storage.updateConversation(conversation.id, {
              context: { ...context, offeredSlotISOs: [slot1.startIso, slot2.startIso] }
            });
          }
          
          // Use labelForSpeech for clean natural pronunciation
          const time1Label = labelForSpeech(slot1.startIso, AUST_TZ);
          const time2Label = labelForSpeech(slot2.startIso, AUST_TZ);
          
          console.log(`[OFFER] 2 options: 1="${time1Label}" (${slot1.startIso}), 2="${time2Label}" (${slot2.startIso})`);
          
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech', 'dtmf'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=${route.replace('part','choose')}&callSid=${encodeURIComponent(callSid)}${aptIdParam}`),
              method: 'POST'
            });
            saySafe(g, `I have two options. Option one, ${time1Label}. Or option two, ${time2Label}. Press 1 or 2, or say your choice.`);
            pause(g, 1);
          });
        }
      }

      // Booking flow - choose (robust option parsing with confirmation)
      if (route === 'book-choose' || route === 'reschedule-choose') {
        const speech = (req.body.SpeechResult || '').toLowerCase();
        const digits = req.body.Digits as string | undefined;
        const aptId = req.query.aptId as string | undefined;
        
        console.log(`[CHOOSE] speech="${speech}" digits=${digits || 'none'}`);
        
        // Get conversation to retrieve stored slot ISOs
        const call = await storage.getCallByCallSid(callSid);
        const conversation = call?.conversationId ? await storage.getConversation(call.conversationId) : null;
        const context = conversation?.context as any || {};
        const offeredSlotISOs = context.offeredSlotISOs || [];
        
        // Safety: if no offered slots, redirect back
        if (!offeredSlotISOs.length) {
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech', 'dtmf'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=${route.replace('choose','part')}&callSid=${encodeURIComponent(callSid)}${aptId ? `&aptId=${aptId}` : ''}`),
              method: 'POST'
            });
            say(g, 'Sorry I lost those options. Should I search again');
            pause(g, 1);
          });
        }
        
        // Check if chosenSlotISO was already set (from confirm-yesno redirect)
        let chosenSlotISO = context.chosenSlotISO;
        
        if (!chosenSlotISO) {
          // Parse user's choice - prefer DTMF, then explicit speech "option one/two"
          const idx = parseOptionIndex(speech, digits, offeredSlotISOs.length);
          
          if (idx === null) {
            // Didn't get clear "option one/two" → confirm first option
            const slotISO = offeredSlotISOs[0];
            
            if (conversation) {
              await storage.updateConversation(conversation.id, {
                context: { ...context, pendingSlotISO: slotISO }
              });
            }
            
            const timeLabel = labelForSpeech(slotISO, AUST_TZ);
            
            return twiml(res, (vr) => {
              const g = vr.gather({
                input: ['speech', 'dtmf'],
                numDigits: 1,
                language: 'en-AU',
                timeout: 5,
                speechTimeout: 'auto',
                actionOnEmptyResult: true,
                action: abs(`/api/voice/handle?route=${route.replace('choose','confirm-yesno')}&callSid=${encodeURIComponent(callSid)}${aptId ? `&aptId=${aptId}` : ''}`),
                method: 'POST'
              });
              saySafe(g, `Just to confirm, did you want ${timeLabel}? Press 1 for yes, 2 for no. Or say yes or no.`);
              pause(g, 1);
            });
          }
          
          // Got clear option selection → set chosenSlotISO
          chosenSlotISO = offeredSlotISOs[idx] || offeredSlotISOs[0];
          
          if (conversation) {
            await storage.updateConversation(conversation.id, {
              context: { ...context, chosenSlotISO }
            });
          }
        }
        
        // Re-validate slot availability (prevent race conditions)
        // Use businessDayRange to get exact same business day window
        const { fromLocalISO, toLocalISO } = businessDayRange(chosenSlotISO, AUST_TZ);
        
        console.log(`[REVALIDATE] Checking if slot ${chosenSlotISO} is still available (business day: ${fromLocalISO})`);
        
        // Re-fetch availability for the specific business day
        let freshSlots;
        try {
          freshSlots = await getAvailability({
            fromDate: fromLocalISO,
            toDate: toLocalISO,
          });
          console.log(`[REVALIDATE] Found ${freshSlots.length} fresh slots for business day ${fromLocalISO}`);
        } catch (err) {
          console.error(`[REVALIDATE] Failed to fetch availability:`, err);
          // If re-validation fails, try fetching all availability as fallback
          try {
            console.log(`[REVALIDATE] Trying to fetch all availability as fallback`);
            freshSlots = await getAvailability();
            console.log(`[REVALIDATE] Fallback: Found ${freshSlots.length} total slots`);
          } catch (fallbackErr) {
            console.error(`[REVALIDATE] Fallback also failed:`, fallbackErr);
            // Complete failure - inform caller
            return twiml(res, (vr) => {
              saySafe(vr, 'Sorry, there was a technical problem checking availability. Please try calling back in a few minutes. Goodbye.');
            });
          }
        }
        
        // Check if chosen slot is still available
        const slotData = freshSlots.find(s => s.startIso === chosenSlotISO);
        
        if (!slotData) {
          console.log(`[REVALIDATE] Slot ${chosenSlotISO} is GONE - offering nearest alternatives on same business day`);
          
          // Find nearest alternatives by time distance on same day
          const sorted = freshSlots
            .map(s => ({ ...s, timeDiff: Math.abs(dayjs(s.startIso).valueOf() - dayjs(chosenSlotISO).valueOf()) }))
            .sort((a, b) => a.timeDiff - b.timeDiff);
          
          // Slot is taken - offer next available slots
          if (sorted.length >= 2) {
            // Offer nearest 2 slots
            const alt1 = sorted[0];
            const alt2 = sorted[1];
            
            const time1Label = labelForSpeech(alt1.startIso, AUST_TZ);
            const time2Label = labelForSpeech(alt2.startIso, AUST_TZ);
            
            // Update context with new offered slots
            if (conversation) {
              await storage.updateConversation(conversation.id, {
                context: { ...context, offeredSlotISOs: [alt1.startIso, alt2.startIso], chosenSlotISO: undefined, pendingSlotISO: undefined }
              });
            }
            
            console.log(`[REVALIDATE] Offering 2 nearest alternatives: ${time1Label}, ${time2Label}`);
            
            return twiml(res, (vr) => {
              const g = vr.gather({
                input: ['speech', 'dtmf'],
                language: 'en-AU',
                timeout: 5,
                speechTimeout: 'auto',
                actionOnEmptyResult: true,
                action: abs(`/api/voice/handle?route=${route}&callSid=${encodeURIComponent(callSid)}${aptId ? `&aptId=${aptId}` : ''}`),
                method: 'POST'
              });
              saySafe(g, `Sorry, that time was just taken. The nearest times are option one, ${time1Label}. Or option two, ${time2Label}. Press 1 or 2, or say your choice.`);
              pause(g, 1);
            });
          } else if (sorted.length === 1) {
            // Only 1 slot left - offer it
            const alt1 = sorted[0];
            const time1Label = labelForSpeech(alt1.startIso, AUST_TZ);
            
            if (conversation) {
              await storage.updateConversation(conversation.id, {
                context: { ...context, offeredSlotISOs: [alt1.startIso], chosenSlotISO: undefined, pendingSlotISO: undefined }
              });
            }
            
            console.log(`[REVALIDATE] Offering 1 alternative: ${time1Label}`);
            
            return twiml(res, (vr) => {
              const g = vr.gather({
                input: ['speech', 'dtmf'],
                language: 'en-AU',
                timeout: 5,
                speechTimeout: 'auto',
                actionOnEmptyResult: true,
                action: abs(`/api/voice/handle?route=${route}&callSid=${encodeURIComponent(callSid)}${aptId ? `&aptId=${aptId}` : ''}`),
                method: 'POST'
              });
              saySafe(g, `Sorry, that time was just taken. I only have ${time1Label} available. Press 1 to book it, or 2 to try another day.`);
              pause(g, 1);
            });
          } else {
            // No slots available - offer to take message
            console.log(`[REVALIDATE] No slots available on business day ${fromLocalISO}`);
            
            return twiml(res, (vr) => {
              const g = vr.gather({
                input: ['speech', 'dtmf'],
                language: 'en-AU',
                timeout: 5,
                speechTimeout: 'auto',
                actionOnEmptyResult: true,
                action: abs(`/api/voice/handle?route=book-part&callSid=${encodeURIComponent(callSid)}`),
                method: 'POST'
              });
              saySafe(g, 'Sorry, all times for that day are now taken. Would you like to try a different day? Press 1 for yes, or 2 to leave a message.');
              pause(g, 1);
            });
          }
        }
        
        console.log(`[REVALIDATE] Slot ${chosenSlotISO} is STILL AVAILABLE - proceeding with booking`);
        
        // Get caller identity
        const phoneData = await storage.getPhoneMap(from);
        
        let apt;
        if (route === 'reschedule-choose' && aptId) {
          console.log(`[BOOK] Rescheduling aptId=${aptId} → ${chosenSlotISO}`);
          
          // Reschedule using exact chosen slot ISO
          apt = await rescheduleAppointment(aptId, chosenSlotISO);
          
          console.log(`[BOOK] Rescheduled successfully: ${apt?.id}`);
          
          // Update appointment status in our database
          const existing = await storage.findUpcomingByPhone(from);
          if (existing && existing.clinikoAppointmentId === aptId) {
            await storage.updateAppointmentStatus(existing.id, 'rescheduled');
          }
          
          // Persist the rescheduled appointment
          if (apt?.id) {
            await storage.saveAppointment({
              phone: from,
              patientId: phoneData?.patientId || null,
              clinikoAppointmentId: apt.id,
              startsAt: new Date(chosenSlotISO),
              status: 'scheduled'
            });
          }
        } else {
          console.log(`[BOOK] Creating new appointment: ${chosenSlotISO} for ${from}`);
          
          // Book using exact chosen slot ISO and metadata from Cliniko
          apt = await createAppointmentForPatient(from, {
            practitionerId: slotData.practitionerId,
            appointmentTypeId: slotData.appointmentTypeId,
            startsAt: chosenSlotISO,
            businessId: slotData.businessId,
            duration: slotData.duration,
            notes: 'Booked via EchoDesk',
            fullName: phoneData?.fullName || undefined,
            email: phoneData?.email || undefined
          });
          
          console.log(`[BOOK] Booked successfully: ${apt?.id}`);
          
          // Persist the appointment in our database for reschedule lookup
          if (apt?.id) {
            await storage.saveAppointment({
              phone: from,
              patientId: phoneData?.patientId || null,
              clinikoAppointmentId: apt.id,
              startsAt: new Date(chosenSlotISO),
              status: 'scheduled'
            });
          }
        }
        
        // Update call log with appointment details
        if (callSid) {
          const updatedCall = await storage.updateCall(callSid, {
            summary: `${route.startsWith('reschedule') ? 'Rescheduled' : 'Booked'} appointment for ${formatAppointmentTimeAU(chosenSlotISO)}`
          });
          
          if (updatedCall) {
            emitCallUpdated(updatedCall);
          }
        }
        
        // Send SMS confirmation with AU timezone formatting
        const aptDate = formatAppointmentTimeAU(chosenSlotISO);
        
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
        
        // Speak confirmation with labelForSpeech for natural pronunciation
        const confirmTimeLabel = labelForSpeech(chosenSlotISO, AUST_TZ);
        
        return twiml(res, (vr) => {
          saySafe(vr, `All set. Your booking is confirmed for ${confirmTimeLabel}. We will send a confirmation by message. Goodbye`);
        });
      }
      
      // Booking flow - confirm yes/no (for ambiguous choices)
      if (route === 'book-confirm-yesno' || route === 'reschedule-confirm-yesno') {
        const speech = (req.body.SpeechResult || '').toLowerCase();
        const digits = req.body.Digits || '';
        const aptId = req.query.aptId as string | undefined;
        
        console.log(`[CONFIRM-YESNO] speech="${speech}" digits="${digits}"`);
        
        // Get conversation context
        const call = await storage.getCallByCallSid(callSid);
        const conversation = call?.conversationId ? await storage.getConversation(call.conversationId) : null;
        const context = conversation?.context as any || {};
        const pendingSlotISO = context.pendingSlotISO;
        const offeredSlotISOs = context.offeredSlotISOs || [];
        
        // DTMF priority: 1 = yes, 2 = no
        const confirmedYes = digits === '1' || /\b(yes|yeah|sure|ok|okay)\b/i.test(speech);
        const confirmedNo = digits === '2' || /\b(no|nope|nah)\b/i.test(speech);
        
        console.log(`[CONFIRM-YESNO] confirmedYes=${confirmedYes} confirmedNo=${confirmedNo}`);
        
        if (confirmedYes) {
          // User confirmed → set as chosen and redirect to book-choose
          if (conversation && pendingSlotISO) {
            await storage.updateConversation(conversation.id, {
              context: { ...context, chosenSlotISO: pendingSlotISO }
            });
          }
          
          // Redirect back to book-choose which will now find chosenSlotISO and book it
          return twiml(res, (vr) => {
            vr.redirect(abs(`/api/voice/handle?route=${route.replace('confirm-yesno','choose')}&callSid=${encodeURIComponent(callSid)}${aptId ? `&aptId=${aptId}` : ''}`));
          });
        } else if (confirmedNo) {
          // User said no → ask again for option one or two
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech', 'dtmf'],
              numDigits: 1,
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=${route.replace('confirm-yesno','choose')}&callSid=${encodeURIComponent(callSid)}${aptId ? `&aptId=${aptId}` : ''}`),
              method: 'POST'
            });
            say(g, 'Okay. Press 1 for option one, or press 2 for option two. You can also say your choice.');
            pause(g, 1);
          });
        }
        
        // Fallback: unclear response → re-ask
        console.log(`[CONFIRM-YESNO] Unclear response - re-prompting`);
        return twiml(res, (vr) => {
          const g = vr.gather({
            input: ['speech', 'dtmf'],
            numDigits: 1,
            language: 'en-AU',
            timeout: 5,
            speechTimeout: 'auto',
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=${route}&callSid=${encodeURIComponent(callSid)}${aptId ? `&aptId=${aptId}` : ''}`),
            method: 'POST'
          });
          say(g, 'Sorry, I didn\'t catch that. Press 1 for yes, 2 for no. Or say yes or no.');
          pause(g, 1);
        });
      }

      // Lookup appointment for rescheduling (use our database first)
      if (route === 'reschedule-lookup') {
        // First try to find appointment in our database
        const dbApt = await storage.findUpcomingByPhone(from);
        
        if (dbApt) {
          const aptDate = formatAppointmentTimeAU(dbApt.startsAt.toISOString());
          
          return twiml(res, (vr) => {
            const g = vr.gather({
              input: ['speech'],
              language: 'en-AU',
              timeout: 5,
              speechTimeout: 'auto',
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=reschedule-confirm&callSid=${encodeURIComponent(callSid)}&aptId=${dbApt.clinikoAppointmentId}`),
              method: 'POST'
            });
            say(g, `I found your appointment on ${aptDate}. Would you like to reschedule it`);
            pause(g, 1);
          });
        }
        
        // Fallback to Cliniko API if not in our database
        const clinikoApts = await getPatientAppointments(from);
        const apt = clinikoApts[0];
        
        if (!apt) {
          return twiml(res, (vr) => {
            say(vr, 'I could not find an upcoming booking under this number. Would you like to make a new appointment');
          });
        }
        
        const aptDate = formatAppointmentTimeAU(apt.starts_at);
        
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
          say(g, `I found your appointment on ${aptDate}. Would you like to reschedule it`);
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
      saySafe(fail, 'Sorry there was a problem Please try again later Goodbye');
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
      saySafe(fail, 'Sorry there was a problem Please try again later Goodbye');
      const xml = fail.toString();
      console.log('[VOICE][WIZARD OUT][FAIL]', xml);
      return res.type('text/xml').send(xml);
    }
  });

  // Test route for TwiML validation (support both GET and POST)
  const pingHandler = (req: Request, res: Response) => {
    return twiml(res, (vr) => {
      say(vr, 'Voice system test successful');
    });
  };
  app.get('/api/voice/ping', pingHandler);
  app.post('/api/voice/ping', pingHandler);

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
      saySafe(fail, 'Test echo error');
      const xml = fail.toString();
      console.log('[VOICE][TEST-ECHO OUT][FAIL]', xml);
      return res.type('text/xml').send(xml);
    }
  });
}
