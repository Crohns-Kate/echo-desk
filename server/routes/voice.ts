import { Express, Request, Response } from "express";
import twilio from "twilio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import {
  getAvailability,
  createAppointmentForPatient,
  getNextUpcomingAppointment,
  cancelAppointment,
  rescheduleAppointment,
  findPatientByPhoneRobust
} from "../services/cliniko";
import { saySafe, VOICE_NAME } from "../utils/voice-constants";
import { abs } from "../utils/url";
import { labelForSpeech, AUST_TZ } from "../time";
import { storage } from "../storage";
import { sendAppointmentConfirmation } from "../services/sms";
import { emitCallStarted, emitCallUpdated, emitAlertCreated } from "../services/websocket";
import { classifyIntent } from "../services/intent";
import { env } from "../utils/env";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Australia/Brisbane");

export function registerVoice(app: Express) {
  // ───────────────────────────────────────────────
  // Recording status callback (Twilio posts here)
  // Stores RecordingSid / status / url against the call row.
  app.post("/api/voice/recording-status", async (req: Request, res: Response) => {
    try {
      const callSid = (req.body.CallSid as string) || "";
      const recordingSid = (req.body.RecordingSid as string) || "";
      const status = (req.body.RecordingStatus as string) || ""; // in-progress | completed | failed
      let recordingUrl = (req.body.RecordingUrl as string) || "";

      console.log("[RECORDING_STATUS]", { callSid, recordingSid, status, recordingUrl });

      // Validate callSid exists before updating
      if (!callSid) {
        console.warn("[RECORDING_STATUS] No callSid provided, cannot update");
        return res.sendStatus(204);
      }

      // Append .mp3 to recordingUrl for direct streaming
      if (recordingUrl && !recordingUrl.endsWith('.mp3')) {
        recordingUrl = recordingUrl + '.mp3';
      }

      // Update call record
      const updated = await storage.updateCall(callSid, {
        recordingSid,
        recordingStatus: status,
        recordingUrl,
      });

      if (!updated) {
        console.warn("[RECORDING_STATUS] Call not found:", callSid);
      } else {
        console.log("[RECORDING_STATUS] Updated call:", callSid, "with recording:", recordingSid);
        // Emit WebSocket update if needed
        emitCallUpdated(updated);
      }

      return res.sendStatus(204);
    } catch (e) {
      console.error("[RECORDING_STATUS][ERROR]", e);
      return res.sendStatus(204);
    }
  });

  // ───────────────────────────────────────────────
  // Entry point for each call
  app.post("/api/voice/incoming", async (req: Request, res: Response) => {
    const callSid =
      (req.body?.CallSid as string) ||
      (req.query?.callSid as string) ||
      "";
    const from = (req.body?.From as string) || "";
    const to = (req.body?.To as string) || "";

    // Log call start and load conversation memory
    try {
      const tenant = await storage.getTenant("default");
      if (tenant) {
        let conversation = await storage.createConversation(tenant.id, undefined, true);
        const call = await storage.logCall({
          tenantId: tenant.id,
          conversationId: conversation.id,
          callSid,
          fromNumber: from,
          toNumber: to,
          intent: "incoming",
          summary: "Call initiated",
        });
        emitCallStarted(call);
      }
    } catch (e) {
      console.error("[VOICE][LOG ERROR]", e);
    }

    const vr = new twilio.twiml.VoiceResponse();

    // Start recording if enabled
    const { env } = await import("../utils/env");
    if (env.CALL_RECORDING_ENABLED && callSid) {
      try {
        const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
        await client.calls(callSid).recordings.create({
          recordingStatusCallback: abs("/api/voice/recording-status"),
          recordingStatusCallbackMethod: "POST",
        });
        console.log("[VOICE][RECORDING] Started recording for call:", callSid);
      } catch (recErr) {
        console.error("[VOICE][RECORDING] Failed to start recording:", recErr);
      }
    }

    const handleUrl = abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`);
    const timeoutUrl = abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`);

    const g = vr.gather({
      input: ["speech"],
      // NOTE: language removed - Polly voices have built-in language and reject language parameter
      timeout: 5,
      speechTimeout: "auto",
      actionOnEmptyResult: true,
      action: handleUrl,
      method: "POST",
    });

    // Check if returning patient and personalize greeting
    let greetingMessage = "Hello. How can I help you today?";
    try {
      const phoneMapEntry = await storage.getPhoneMap(from);
      if (phoneMapEntry?.fullName) {
        greetingMessage = `Hello ${phoneMapEntry.fullName}. How can I help you today?`;
      }
    } catch (err) {
      console.error("[VOICE] Error checking phone_map for greeting:", err);
    }

    saySafe(g, greetingMessage);
    g.pause({ length: 1 });
    vr.redirect({ method: "POST" }, timeoutUrl);

    return res.type("text/xml").send(vr.toString());
  });

  // ───────────────────────────────────────────────
  // State machine
  app.post("/api/voice/handle", async (req: Request, res: Response) => {
    const vr = new twilio.twiml.VoiceResponse();

    try {
      const callSid = (req.query.callSid as string) || (req.body?.CallSid as string) || "";
      const route = (req.query.route as string) || "start";
      const speechRaw = ((req.body?.SpeechResult as string) || "").trim().toLowerCase();
      const digits = (req.body?.Digits as string) || "";
      const from = (req.body?.From as string) || "";

      console.log("[VOICE][HANDLE IN]", { route, callSid, speechRaw, digits, from });

      // Timeout fallback
      if (route === "timeout") {
        const g = vr.gather({
          input: ["speech"],
          // NOTE: language removed - Polly voices have built-in language
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        // ✅ Safe say
        saySafe(g, "Sorry, I didn't catch that. Please say book, reschedule, or cancel.");
        g.pause({ length: 1 });
        // If timeout again, end call gracefully
        saySafe(vr, "I'm sorry, I'm having trouble understanding you. Please call back when you're ready. Goodbye.");
        return res.type("text/xml").send(vr.toString());
      }

      // 1) START → detect intent and route accordingly
      if (route === "start") {
        // Check if this is a returning patient
        let isReturningPatient = false;
        let patientName: string | undefined;
        let patientId: string | undefined;

        try {
          const phoneMapEntry = await storage.getPhoneMap(from);
          if (phoneMapEntry?.patientId) {
            isReturningPatient = true;
            patientName = phoneMapEntry.fullName || undefined;
            patientId = phoneMapEntry.patientId || undefined;
            console.log("[VOICE] Returning patient detected:", { phone: from, name: patientName, patientId: phoneMapEntry.patientId });
          } else {
            console.log("[VOICE] New patient (not in phone_map):", from);
          }
        } catch (err) {
          console.error("[VOICE] Error checking phone_map:", err);
        }

        // Detect intent from speech
        const intentResult = await classifyIntent(speechRaw);
        console.log("[VOICE] Detected intent:", intentResult);

        const intent = intentResult.action;

        // Route based on intent
        if (intent === "reschedule") {
          if (!isReturningPatient) {
            saySafe(vr, "I don't see an existing appointment for your number. Would you like to book a new appointment instead?");
            vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=check-been-before&callSid=${encodeURIComponent(callSid)}`));
            return res.type("text/xml").send(vr.toString());
          }
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=reschedule-start&callSid=${encodeURIComponent(callSid)}&patientId=${encodeURIComponent(patientId!)}`));
          return res.type("text/xml").send(vr.toString());
        }

        if (intent === "cancel") {
          if (!isReturningPatient) {
            saySafe(vr, "I don't see an existing appointment for your number. Is there anything else I can help you with?");
            vr.hangup();
            return res.type("text/xml").send(vr.toString());
          }
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=cancel-start&callSid=${encodeURIComponent(callSid)}&patientId=${encodeURIComponent(patientId!)}`));
          return res.type("text/xml").send(vr.toString());
        }

        if (intent === "book" || intent === "unknown") {
          // For booking intent, ask if they've been to the office before
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=check-been-before&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        // Escalation for operator requests or complex questions
        if (intent === "operator") {
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=escalate&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        // Default fallback
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=check-been-before&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        saySafe(g, "I can help you book, reschedule, or cancel an appointment. What would you like to do?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 2) CHECK-BEEN-BEFORE → Ask if they've been to the office before
      if (route === "check-been-before") {
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=process-been-before&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        saySafe(g, "Have you been to our office before?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 3) PROCESS-BEEN-BEFORE → Determine if new or returning, ask for name if needed
      if (route === "process-been-before") {
        const isNewPatient = speechRaw.includes("no") || speechRaw.includes("never") || speechRaw.includes("first");
        const isReturning = speechRaw.includes("yes") || speechRaw.includes("returning") || speechRaw.includes("been");

        // Store patient type in conversation context
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            await storage.updateConversation(call.conversationId, {
              context: { isNewPatient, isReturning }
            });
          }
        } catch (err) {
          console.error("[PROCESS-BEEN-BEFORE] Error storing context:", err);
        }

        if (isNewPatient) {
          // New patient flow - collect name
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-name-new&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, "Great! May I have your full name please?");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else if (isReturning) {
          // Returning patient - confirm identity first
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=confirm-identity&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // Unclear response - ask again
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=process-been-before&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, "Sorry, I didn't catch that. Have you visited our office before? Please say yes or no.");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 4) CONFIRM-IDENTITY → Ask returning patient to confirm their identity
      if (route === "confirm-identity") {
        let recognizedName: string | undefined;

        try {
          const phoneMapEntry = await storage.getPhoneMap(from);
          recognizedName = phoneMapEntry?.fullName || undefined;
        } catch (err) {
          console.error("[CONFIRM-IDENTITY] Error checking phone_map:", err);
        }

        if (recognizedName) {
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=process-confirm-identity&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, `Is this ${recognizedName} I'm speaking to?`);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // No recognized name - ask for name
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-name-returning&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, "May I have your full name please?");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 4a) PROCESS-CONFIRM-IDENTITY → Handle identity confirmation response
      if (route === "process-confirm-identity") {
        const confirmed = speechRaw.includes("yes") || speechRaw.includes("correct") || speechRaw.includes("right");
        const denied = speechRaw.includes("no") || speechRaw.includes("not") || speechRaw.includes("wrong");

        if (confirmed) {
          // Identity confirmed - proceed to week selection
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=1`));
          return res.type("text/xml").send(vr.toString());
        } else if (denied) {
          // Identity not confirmed - ask for correct name
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-name-returning&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, "I apologize. May I have your full name please?");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // Unclear response - ask again
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=process-confirm-identity&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, "Sorry, I didn't catch that. Please say yes or no.");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 4b) ASK-NAME-RETURNING → Collect name for returning patient with wrong identity
      if (route === "ask-name-returning") {
        const name = speechRaw || "";

        // Store name in conversation context and mark as returning
        if (name && name.length > 0) {
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, fullName: name, isReturning: true }
              });
            }
            console.log("[ASK-NAME-RETURNING] Stored name:", name);
          } catch (err) {
            console.error("[ASK-NAME-RETURNING] Failed to store name:", err);
          }
        }

        // Proceed to week selection
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=1`));
        return res.type("text/xml").send(vr.toString());
      }

      // 5) ASK-NAME-NEW → Collect name for new patient
      if (route === "ask-name-new") {
        const name = speechRaw || "";

        // Store name in conversation context
        if (name && name.length > 0) {
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, fullName: name, isNewPatient: true }
              });
            }
            console.log("[ASK-NAME-NEW] Stored name:", name);
          } catch (err) {
            console.error("[ASK-NAME-NEW] Failed to store name:", err);
          }
        }

        // Ask for reason for visit
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=ask-reason&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        saySafe(g, "Thank you. What's the main reason for your visit today?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 5) ASK-REASON → Collect reason and move to week selection
      if (route === "ask-reason") {
        const reason = speechRaw || "";

        // Store reason in conversation context
        if (reason && reason.length > 0) {
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, reason }
              });
            }
            console.log("[ASK-REASON] Stored reason:", reason);
          } catch (err) {
            console.error("[ASK-REASON] Failed to store reason:", err);
          }
        }

        // Move to week selection with thinking filler
        saySafe(vr, "Perfect. Let me check our availability for you.");
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=0`));
        return res.type("text/xml").send(vr.toString());
      }

      // 6) ASK-WEEK → Which week do they want?
      if (route === "ask-week") {
        const isReturningPatient = (req.query.returning as string) === '1';
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=process-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}`),
          method: "POST",
        });
        saySafe(g, "Which week works best for you? This week, next week, or another week?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 7) PROCESS-WEEK → Determine the week and ask for time preference
      if (route === "process-week") {
        const isReturningPatient = (req.query.returning as string) === '1';
        let weekOffset = 0; // 0 = this week, 1 = next week
        let specificWeek = "";

        if (speechRaw.includes("this week") || speechRaw.includes("this") || speechRaw.includes("soon") || speechRaw.includes("asap")) {
          weekOffset = 0;
          specificWeek = "this week";
        } else if (speechRaw.includes("next week") || speechRaw.includes("next")) {
          weekOffset = 1;
          specificWeek = "next week";
        } else if (speechRaw.includes("another") || speechRaw.includes("later") || speechRaw.includes("different")) {
          // For "another week", default to 2 weeks out
          weekOffset = 2;
          specificWeek = "in two weeks";
        } else {
          // Default to next week if unclear
          weekOffset = 1;
          specificWeek = "next week";
        }

        // Store week preference
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const existingContext = (conversation?.context as any) || {};
            await storage.updateConversation(call.conversationId, {
              context: { ...existingContext, weekOffset, specificWeek }
            });
          }
        } catch (err) {
          console.error("[PROCESS-WEEK] Error storing week:", err);
        }

        // Ask for time preference
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=get-availability&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&weekOffset=${weekOffset}`),
          method: "POST",
        });
        saySafe(g, "And do you prefer morning, midday, or afternoon?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // ESCALATE → Handle complex questions
      if (route === "escalate") {
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=capture-escalation&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        saySafe(g, "I'd like to make sure you get the right information. Could you briefly describe what you need help with?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // CAPTURE-ESCALATION → Save the question and create alert
      if (route === "capture-escalation") {
        const question = speechRaw || "";

        try {
          const tenant = await storage.getTenant("default");
          if (tenant) {
            const alert = await storage.createAlert({
              tenantId: tenant.id,
              reason: "escalation",
              payload: { question, callSid, from },
            });
            emitAlertCreated(alert);
          }
        } catch (err) {
          console.error("[CAPTURE-ESCALATION] Failed to create alert:", err);
        }

        saySafe(vr, "Thank you. I've noted your question and Dr. Michael will get back to you. Is there anything else I can help with today?");
        vr.hangup();
        return res.type("text/xml").send(vr.toString());
      }

      // RESCHEDULE-START → Start reschedule flow
      if (route === "reschedule-start") {
        const patientId = (req.query.patientId as string) || "";

        // Add thinking filler
        saySafe(vr, "Just a moment while I bring up your appointment.");

        // Look up their next appointment
        try {
          const appointment = await getNextUpcomingAppointment(patientId);
          if (!appointment) {
            saySafe(vr, "I don't see any upcoming appointments for you. Would you like to book a new one?");
            vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=check-been-before&callSid=${encodeURIComponent(callSid)}`));
            return res.type("text/xml").send(vr.toString());
          }

          // Confirm their current appointment
          const currentTime = labelForSpeech(appointment.starts_at, AUST_TZ);
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=reschedule-confirm&callSid=${encodeURIComponent(callSid)}&apptId=${encodeURIComponent(appointment.id)}&patientId=${encodeURIComponent(patientId)}`),
            method: "POST",
          });
          saySafe(g, `I see you have an appointment on ${currentTime}. Would you like to reschedule this appointment?`);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } catch (err) {
          console.error("[RESCHEDULE-START] Error:", err);
          saySafe(vr, "Sorry, I'm having trouble accessing your appointment. Please call back or try again later.");
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        }
      }

      // RESCHEDULE-CONFIRM → Confirm they want to reschedule
      if (route === "reschedule-confirm") {
        const apptId = (req.query.apptId as string) || "";
        const patientId = (req.query.patientId as string) || "";

        if (speechRaw.includes("yes") || speechRaw.includes("sure") || speechRaw.includes("yeah")) {
          // Store appointment ID in context for later
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              await storage.updateConversation(call.conversationId, {
                context: { apptId, patientId, isReschedule: true }
              });
            }
          } catch (err) {
            console.error("[RESCHEDULE-CONFIRM] Error storing context:", err);
          }

          // Move to week selection
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=1`));
          return res.type("text/xml").send(vr.toString());
        } else {
          saySafe(vr, "Okay, no problem. Is there anything else I can help you with?");
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        }
      }

      // CANCEL-START → Start cancel flow
      if (route === "cancel-start") {
        const patientId = (req.query.patientId as string) || "";

        // Add thinking filler
        saySafe(vr, "Just a moment while I bring up your appointment.");

        try {
          const appointment = await getNextUpcomingAppointment(patientId);
          if (!appointment) {
            saySafe(vr, "I don't see any upcoming appointments to cancel.");
            vr.hangup();
            return res.type("text/xml").send(vr.toString());
          }

          // Confirm cancellation
          const currentTime = labelForSpeech(appointment.starts_at, AUST_TZ);
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=cancel-confirm&callSid=${encodeURIComponent(callSid)}&apptId=${encodeURIComponent(appointment.id)}&patientId=${encodeURIComponent(patientId)}`),
            method: "POST",
          });
          saySafe(g, `I see you have an appointment on ${currentTime}. Are you sure you want to cancel this appointment?`);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } catch (err) {
          console.error("[CANCEL-START] Error:", err);
          saySafe(vr, "Sorry, I'm having trouble accessing your appointment. Please call back or try again later.");
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        }
      }

      // CANCEL-CONFIRM → Confirm cancellation and offer rebook
      if (route === "cancel-confirm") {
        const apptId = (req.query.apptId as string) || "";
        const patientId = (req.query.patientId as string) || "";

        if (speechRaw.includes("yes") || speechRaw.includes("sure") || speechRaw.includes("cancel")) {
          try {
            await cancelAppointment(apptId);

            // Update call log
            try {
              const updated = await storage.updateCall(callSid, {
                intent: "cancellation",
                summary: `Appointment cancelled: ${apptId}`,
              });
              if (updated) emitCallUpdated(updated);
            } catch (logErr) {
              console.error("[LOG ERROR]", logErr);
            }

            // Offer to rebook
            const g = vr.gather({
              input: ["speech"],
              timeout: 5,
              speechTimeout: "auto",
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=cancel-rebook&callSid=${encodeURIComponent(callSid)}&patientId=${encodeURIComponent(patientId)}`),
              method: "POST",
            });
            saySafe(g, "Your appointment has been cancelled. Would you like to book a new appointment?");
            g.pause({ length: 1 });
            vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
            return res.type("text/xml").send(vr.toString());
          } catch (err) {
            console.error("[CANCEL-CONFIRM] Error cancelling:", err);
            saySafe(vr, "Sorry, I couldn't cancel your appointment. Please call back or try again later.");
            vr.hangup();
            return res.type("text/xml").send(vr.toString());
          }
        } else {
          saySafe(vr, "Okay, I've kept your appointment as is. See you then!");
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        }
      }

      // CANCEL-REBOOK → Handle rebooking after cancellation
      if (route === "cancel-rebook") {
        if (speechRaw.includes("yes") || speechRaw.includes("sure") || speechRaw.includes("book")) {
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=1`));
          return res.type("text/xml").send(vr.toString());
        } else {
          saySafe(vr, "Okay, have a great day!");
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 2) BOOK-DAY → confirm intent then either ask for name or skip to day selection (LEGACY - keeping for compatibility)
      if (route === "book-day") {
        if (!(speechRaw.includes("yes") || speechRaw.includes("book") || speechRaw.includes("appointment"))) {
          saySafe(vr, "Okay, goodbye.");
          return res.type("text/xml").send(vr.toString());
        }

        // Check if returning patient
        const isReturningPatient = (req.query.returning as string) === '1';

        // If returning patient, skip name collection and go straight to day selection
        if (isReturningPatient) {
          const g = vr.gather({
            input: ["speech"],
            // NOTE: language removed - Polly voices have built-in language
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-day&callSid=${encodeURIComponent(callSid)}&returning=1`),
            method: "POST",
          });
          saySafe(g, "Great. Which day would you prefer?");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        // New patient - ask for name
        const g = vr.gather({
          input: ["speech"],
          // NOTE: language removed - Polly voices have built-in language
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=ask-name&callSid=${encodeURIComponent(callSid)}&returning=0`),
          method: "POST",
        });
        saySafe(g, "Great. May I have your full name please?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 3) ASK-NAME → capture name and skip to day selection (skip email - unreliable via voice)
      if (route === "ask-name") {
        const name = speechRaw || "";
        const isReturningPatient = (req.query.returning as string) === '1';

        // Store name in conversation context
        if (name && name.length > 0) {
          try {
            const conversation = await storage.getCallByCallSid(callSid);
            if (conversation?.conversationId) {
              await storage.updateConversation(conversation.conversationId, {
                context: { fullName: name, isNewPatient: !isReturningPatient }
              });
            }
            console.log("[ASK-NAME] Stored name:", name);
          } catch (err) {
            console.error("[ASK-NAME] Failed to store name:", err);
          }
        }

        const g = vr.gather({
          input: ["speech"],
          // NOTE: language removed - Polly voices have built-in language
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=ask-day&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}`),
          method: "POST",
        });
        // Skip email and go straight to day
        saySafe(g, "Thank you. Which day would you prefer for your appointment?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // GET-AVAILABILITY → Fetch slots based on week offset and time preference
      if (route === "get-availability") {
        const isReturningPatient = (req.query.returning as string) === '1';
        const weekOffsetParam = parseInt((req.query.weekOffset as string) || "1", 10);

        // Get time preference from speech
        let timePart: 'morning' | 'afternoon' | undefined;
        if (speechRaw.includes("morning") || speechRaw.includes("early")) {
          timePart = 'morning';
        } else if (speechRaw.includes("afternoon") || speechRaw.includes("midday") || speechRaw.includes("late")) {
          timePart = 'afternoon';
        }

        // Determine if new patient from conversation context
        let isNewPatient = !isReturningPatient;
        let weekOffset = weekOffsetParam;

        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            if (context?.isNewPatient !== undefined) {
              isNewPatient = context.isNewPatient;
            }
            if (context?.weekOffset !== undefined) {
              weekOffset = context.weekOffset;
            }
          }
        } catch (err) {
          console.error("[GET-AVAILABILITY] Error checking conversation context:", err);
        }

        // Use appropriate appointment type
        const appointmentTypeId = isNewPatient
          ? env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID
          : env.CLINIKO_APPT_TYPE_ID;

        // Calculate date range based on week offset
        const tzNow = dayjs().tz();
        const weekStart = tzNow.add(weekOffset, 'week').startOf('week');
        const weekEnd = weekStart.endOf('week');
        const fromDate = weekStart.format("YYYY-MM-DD");
        const toDate = weekEnd.format("YYYY-MM-DD");

        console.log("[GET-AVAILABILITY]", { fromDate, toDate, isNewPatient, appointmentTypeId, timePart, weekOffset });

        // Add thinking filler
        saySafe(vr, "Thanks for waiting, I'm loading the schedule.");

        let slots: Array<{ startISO: string; endISO?: string; label?: string }> = [];
        try {
          const result = await getAvailability({
            fromISO: fromDate,
            toISO: toDate,
            appointmentTypeId,
            part: timePart
          });
          slots = result.slots || [];
        } catch (e: any) {
          console.error("[GET-AVAILABILITY][getAvailability ERROR]", e);
          try {
            const tenant = await storage.getTenant("default");
            if (tenant) {
              const alert = await storage.createAlert({
                tenantId: tenant.id,
                reason: "cliniko_error",
                payload: { error: e.message, endpoint: "getAvailability", callSid, from },
              });
              emitAlertCreated(alert);
            }
          } catch (alertErr) {
            console.error("[ALERT ERROR]", alertErr);
          }
          saySafe(vr, "Sorry, I couldn't load available times. Please try again later.");
          return res.type("text/xml").send(vr.toString());
        }

        const available = slots.slice(0, 2);
        if (available.length === 0) {
          try {
            const tenant = await storage.getTenant("default");
            if (tenant) {
              const alert = await storage.createAlert({
                tenantId: tenant.id,
                reason: "no_availability",
                payload: { fromDate, toDate, timePart, callSid, from },
              });
              emitAlertCreated(alert);
            }
          } catch (alertErr) {
            console.error("[ALERT ERROR]", alertErr);
          }

          // Offer to try different time or week
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}`),
            method: "POST",
          });
          saySafe(g, "Sorry, there are no times available for that selection. Would you like to try a different week or time?");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        const s1 = available[0].startISO;
        const s2 = available[1]?.startISO;
        const opt1 = labelForSpeech(s1, AUST_TZ);
        const opt2 = s2 ? labelForSpeech(s2, AUST_TZ) : "";

        const nextUrl = abs(
          `/api/voice/handle?route=book-choose&callSid=${encodeURIComponent(callSid)}&s1=${encodeURIComponent(s1)}${
            s2 ? `&s2=${encodeURIComponent(s2)}` : ""
          }&returning=${isReturningPatient ? '1' : '0'}&apptTypeId=${encodeURIComponent(appointmentTypeId)}`
        );
        const timeoutUrl = abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`);

        const g = vr.gather({
          input: ["speech", "dtmf"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: nextUrl,
          method: "POST",
        });

        saySafe(
          g,
          s2
            ? `I have two options. Option one, ${opt1}. Or option two, ${opt2}. Press 1 or 2, or say your choice.`
            : `I have one option available: ${opt1}. Press 1 or say yes to book it.`
        );
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, timeoutUrl);

        return res.type("text/xml").send(vr.toString());
      }

      // 4) ASK-DAY / BOOK-PART → LEGACY route for backward compatibility
      if (route === "ask-day" || route === "book-part") {
        // Redirect to new flow
        const isReturningPatient = (req.query.returning as string) === '1';
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 5) BOOK-CHOOSE → pick slot & book with captured identity and correct appointment type
      if (route === "book-choose") {
        const s1 = (req.query.s1 as string) || "";
        const s2 = (req.query.s2 as string) || "";
        const choiceIdx = (digits === "2" || speechRaw.includes("two")) && s2 ? 1 : 0;
        const chosen = choiceIdx === 1 ? s2 : s1;
        const isReturningPatient = (req.query.returning as string) === '1';
        const appointmentTypeId = (req.query.apptTypeId as string) || env.CLINIKO_APPT_TYPE_ID;

        if (!chosen) {
          saySafe(vr, "Sorry, that option is no longer available. Let's start again.");
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=start`));
          return res.type("text/xml").send(vr.toString());
        }

        // Retrieve captured identity from conversation context OR phone_map
        let fullName: string | undefined;
        let email: string | undefined;
        let patientId: string | undefined;
        let isReschedule = false;
        let apptId: string | undefined;

        try {
          // First try phone_map as fallback for returning patients
          if (isReturningPatient) {
            const phoneMapEntry = await storage.getPhoneMap(from);
            if (phoneMapEntry) {
              fullName = phoneMapEntry.fullName || undefined;
              email = phoneMapEntry.email || undefined;
              patientId = phoneMapEntry.patientId || undefined;
              console.log("[BOOK-CHOOSE] Retrieved from phone_map (fallback):", { fullName, email, patientId });
            }
          }

          // Then check conversation context - this takes PRIORITY over phone_map
          // because it's what the user provided during this call
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;

            // IMPORTANT: Conversation context overrides phone_map for name and email
            // because it's more recent and accurate
            if (context?.fullName) {
              fullName = context.fullName;
              console.log("[BOOK-CHOOSE] Using name from conversation context:", fullName);
            }
            if (context?.email) {
              email = context.email;
              console.log("[BOOK-CHOOSE] Using email from conversation context:", email);
            }

            // Check if this is a reschedule operation
            if (context?.isReschedule) {
              isReschedule = true;
              apptId = context.apptId;
              patientId = context.patientId || patientId;
            }
            console.log("[BOOK-CHOOSE] Final identity:", { fullName, email, isReschedule, apptId });
          }
        } catch (err) {
          console.error("[BOOK-CHOOSE] Failed to retrieve identity:", err);
        }

        try {
          const { env } = await import("../utils/env");

          let appointment: any;

          if (isReschedule && apptId) {
            // RESCHEDULE existing appointment
            console.log("[BOOK-CHOOSE] Rescheduling appointment:", apptId, "to", chosen);
            appointment = await rescheduleAppointment(apptId, chosen, patientId, env.CLINIKO_PRACTITIONER_ID, appointmentTypeId);

            try {
              const updated = await storage.updateCall(callSid, {
                intent: "reschedule",
                summary: `Appointment rescheduled to ${chosen}`,
              });
              if (updated) emitCallUpdated(updated);
            } catch (logErr) {
              console.error("[LOG ERROR]", logErr);
            }

            const spokenTime = labelForSpeech(chosen, AUST_TZ);
            try {
              const tenant = await storage.getTenant("default");
              if (tenant) {
                await sendAppointmentConfirmation({
                  to: from,
                  appointmentDate: spokenTime,
                  clinicName: tenant.clinicName,
                });
              }
            } catch (smsErr) {
              console.warn("[SMS] Failed to send confirmation:", smsErr);
            }

            saySafe(vr, `Perfect. Your appointment has been rescheduled to ${spokenTime}. See you then!`);
            return res.type("text/xml").send(vr.toString());
          } else {
            // CREATE NEW appointment
            const appointmentNotes = isReturningPatient
              ? `Follow-up appointment booked via voice call at ${new Date().toISOString()}`
              : `New patient appointment booked via voice call at ${new Date().toISOString()}`;

            appointment = await createAppointmentForPatient(from, {
              startsAt: chosen,
              practitionerId: env.CLINIKO_PRACTITIONER_ID,
              appointmentTypeId: appointmentTypeId,
              notes: appointmentNotes,
              fullName,
              email,
            });

            // Get the patientId from the created appointment
            if (appointment && appointment.patient_id) {
              patientId = appointment.patient_id;
            }
          }

          // Store identity in phone_map for future use (including patientId)
          if (fullName || email || patientId) {
            try {
              await storage.upsertPhoneMap({
                phone: from,
                fullName,
                email,
                patientId,
              });
              console.log("[BOOK-CHOOSE] Stored identity in phone_map:", { phone: from, fullName, email, patientId });
            } catch (mapErr) {
              console.error("[BOOK-CHOOSE] Failed to store phone_map:", mapErr);
            }
          }

          try {
            const updated = await storage.updateCall(callSid, {
              intent: "booking",
              summary: `Appointment booked for ${chosen}`,
            });
            if (updated) emitCallUpdated(updated);
          } catch (logErr) {
            console.error("[LOG ERROR]", logErr);
          }

          const spokenTime = labelForSpeech(chosen, AUST_TZ);
          try {
            const tenant = await storage.getTenant("default");
            if (tenant) {
              await sendAppointmentConfirmation({
                to: from,
                appointmentDate: spokenTime,
                clinicName: tenant.clinicName,
              });
            }
          } catch (smsErr) {
            console.warn("[SMS] Failed to send confirmation:", smsErr);
          }

          saySafe(vr, `All set. Your appointment is confirmed for ${spokenTime}. Goodbye.`);
          return res.type("text/xml").send(vr.toString());
        } catch (e: any) {
          console.error("[BOOK-CHOOSE][createAppointmentForPatient ERROR]", e);
          try {
            const tenant = await storage.getTenant("default");
            if (tenant) {
              const alert = await storage.createAlert({
                tenantId: tenant.id,
                reason: "booking_failed",
                payload: { error: e.message, chosen, callSid, from },
              });
              emitAlertCreated(alert);
            }
          } catch (alertErr) {
            console.error("[ALERT ERROR]", alertErr);
          }
          saySafe(vr, "Sorry, I couldn't complete the booking. Please try again later.");
          return res.type("text/xml").send(vr.toString());
        }
      }

      // Fallback
      saySafe(vr, "Sorry, I didn't understand that. Let's start again.");
      vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=start`));
      return res.type("text/xml").send(vr.toString());
    } catch (err: any) {
      console.error("[VOICE][ERROR]", err?.stack || err);
      const fallback = new twilio.twiml.VoiceResponse();
      saySafe(fallback, "Sorry, an error occurred. Please try again later.");
      return res.type("text/xml").send(fallback.toString());
    }
  });
}
