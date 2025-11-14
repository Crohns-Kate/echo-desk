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
import { saySafe, saySafeSSML, EMOTIONS, VOICE_NAME } from "../utils/voice-constants";
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

/**
 * Helper function to extract first name from full name
 */
function extractFirstName(fullName: string): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || "";
}

/**
 * Helper function to parse day of week from speech
 */
function parseDayOfWeek(speechRaw: string): string | undefined {
  const speech = speechRaw.toLowerCase().trim();
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  for (const day of weekdays) {
    if (speech.includes(day)) {
      return day;
    }
  }

  return undefined;
}

/**
 * Helper function to interpret slot choice from user input
 * Returns: "option1", "option2", "reject", "alt_day", or "unknown"
 * Also returns requestedDayOfWeek if alt_day is detected
 */
function interpretSlotChoice(speechRaw: string, digits: string): {
  choice: "option1" | "option2" | "reject" | "alt_day" | "unknown";
  requestedDayOfWeek?: string;
} {
  const speech = speechRaw.toLowerCase().trim();

  console.log("[interpretSlotChoice] Raw speech:", speechRaw, "Digits:", digits);

  // Check DTMF first (most reliable)
  if (digits === "1") {
    return { choice: "option1" };
  }
  if (digits === "2") {
    return { choice: "option2" };
  }

  // Check for explicit option 1 selection - EXPANDED PATTERNS
  if (
    speech === "one" ||
    speech === "1" ||
    speech === "first" ||
    speech.includes("option one") ||
    speech.includes("option 1") ||
    speech.includes("number one") ||
    speech.includes("number 1") ||
    speech.includes("the first") ||
    speech.includes("first one") ||
    speech.includes("first time") ||
    speech.includes("first option") ||
    speech.includes("the earlier") ||
    speech.includes("earlier one") ||
    speech.includes("earlier time") ||
    speech.match(/\b(i'?ll|i will|i'd like|give me|take|book) (the )?first\b/) ||
    speech.match(/\b(i'?ll|i will|i'd like|give me|take|book) (the )?one\b/) ||
    speech.match(/\btake (the )?first\b/) ||
    speech.match(/\bgive me (the )?first\b/)
  ) {
    return { choice: "option1" };
  }

  // Check for explicit option 2 selection - EXPANDED PATTERNS
  if (
    speech === "two" ||
    speech === "2" ||
    speech === "second" ||
    speech.includes("option two") ||
    speech.includes("option 2") ||
    speech.includes("number two") ||
    speech.includes("number 2") ||
    speech.includes("the second") ||
    speech.includes("second one") ||
    speech.includes("second time") ||
    speech.includes("second option") ||
    speech.includes("the later") ||
    speech.includes("later one") ||
    speech.includes("later time") ||
    speech.match(/\b(i'?ll|i will|i'd like|give me|take|book) (the )?second\b/) ||
    speech.match(/\b(i'?ll|i will|i'd like|give me|take|book) (the )?two\b/) ||
    speech.match(/\btake (the )?second\b/) ||
    speech.match(/\bgive me (the )?second\b/)
  ) {
    return { choice: "option2" };
  }

  // Check for rejections
  if (
    speech.includes("no") ||
    speech.includes("neither") ||
    speech.includes("none") ||
    speech.includes("those don't work") ||
    speech.includes("doesn't work") ||
    speech.includes("don't work") ||
    speech.includes("can't do") ||
    speech.includes("won't work") ||
    speech.includes("not good") ||
    speech.includes("different") ||
    speech.includes("another time") ||
    speech.includes("another day")
  ) {
    return { choice: "reject" };
  }

  // Check for alternative day requests (weekday names)
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  for (const day of weekdays) {
    if (speech.includes(day)) {
      return { choice: "alt_day", requestedDayOfWeek: day };
    }
  }

  // Unknown input
  return { choice: "unknown" };
}

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
  // Transcription status callback (Twilio posts here)
  // Stores transcription text against the call row.
  app.post("/api/voice/transcription-status", async (req: Request, res: Response) => {
    try {
      const callSid = (req.body.CallSid as string) || "";
      const recordingSid = (req.body.RecordingSid as string) || "";
      const transcriptionSid = (req.body.TranscriptionSid as string) || "";
      const transcriptionText = (req.body.TranscriptionText as string) || "";
      const transcriptionStatus = (req.body.TranscriptionStatus as string) || "";

      console.log("[TRANSCRIPTION_STATUS]", {
        callSid,
        recordingSid,
        transcriptionSid,
        status: transcriptionStatus,
        textLength: transcriptionText.length
      });

      // Validate callSid exists before updating
      if (!callSid) {
        console.warn("[TRANSCRIPTION_STATUS] No callSid provided, cannot update");
        return res.sendStatus(204);
      }

      // Only update if transcription was successful
      if (transcriptionStatus === "completed" && transcriptionText) {
        const updated = await storage.updateCall(callSid, {
          transcript: transcriptionText,
        });

        if (!updated) {
          console.warn("[TRANSCRIPTION_STATUS] Call not found:", callSid);
        } else {
          console.log("[TRANSCRIPTION_STATUS] Updated call:", callSid, "with transcription (", transcriptionText.length, "chars)");
          // Emit WebSocket update to refresh dashboard
          emitCallUpdated(updated);
        }
      } else if (transcriptionStatus === "failed") {
        console.warn("[TRANSCRIPTION_STATUS] Transcription failed for call:", callSid);
      }

      return res.sendStatus(204);
    } catch (e) {
      console.error("[TRANSCRIPTION_STATUS][ERROR]", e);
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
          // Enable transcription
          transcribe: true,
          transcribeCallback: abs("/api/voice/transcription-status"),
        });
        console.log("[VOICE][RECORDING] Started recording with transcription for call:", callSid);
      } catch (recErr) {
        console.error("[VOICE][RECORDING] Failed to start recording:", recErr);
      }
    }

    // Check if we have a known patient for this number
    let knownPatientName: string | undefined;
    try {
      const phoneMapEntry = await storage.getPhoneMap(from);
      if (phoneMapEntry?.fullName) {
        knownPatientName = phoneMapEntry.fullName;
        console.log("[VOICE] Known patient detected:", knownPatientName);
      }
    } catch (err) {
      console.error("[VOICE] Error checking phone_map for greeting:", err);
    }

    // Get clinic name for greeting
    let clinicName = "the clinic";
    try {
      const tenant = await storage.getTenant("default");
      if (tenant?.clinicName) {
        clinicName = tenant.clinicName;
      }
    } catch (err) {
      console.error("[VOICE] Error getting clinic name:", err);
    }

    if (knownPatientName) {
      // Known patient - confirm identity
      const handleUrl = abs(`/api/voice/handle?route=confirm-caller-identity&callSid=${encodeURIComponent(callSid)}&knownName=${encodeURIComponent(knownPatientName)}`);
      const timeoutUrl = abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`);

      const g = vr.gather({
        input: ["speech"],
        timeout: 5,
        speechTimeout: "auto",
        actionOnEmptyResult: true,
        action: handleUrl,
        method: "POST",
      });

      saySafeSSML(g, `Hi, thanks for calling ${clinicName}. ${EMOTIONS.shortPause()} Am I speaking with ${knownPatientName}?`);
      g.pause({ length: 1 });
      vr.redirect({ method: "POST" }, timeoutUrl);
    } else {
      // Unknown number - generic greeting
      const handleUrl = abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`);
      const timeoutUrl = abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`);

      const g = vr.gather({
        input: ["speech"],
        timeout: 5,
        speechTimeout: "auto",
        actionOnEmptyResult: true,
        action: handleUrl,
        method: "POST",
      });

      saySafeSSML(g, `Hi, thanks for calling ${clinicName}. ${EMOTIONS.shortPause()} How can I help you today?`);
      g.pause({ length: 1 });
      vr.redirect({ method: "POST" }, timeoutUrl);
    }

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
        saySafeSSML(g, `${EMOTIONS.shortBreath()}Sorry, I didn't catch that. ${EMOTIONS.shortPause()} Please say book, reschedule, or cancel.`);
        g.pause({ length: 1 });
        // If timeout again, end call gracefully
        saySafeSSML(vr, `${EMOTIONS.disappointed("I'm sorry", "medium")}, ${EMOTIONS.breath()}I'm having trouble understanding you. ${EMOTIONS.mediumPause()} Please call back when you're ready. Goodbye.`);
        return res.type("text/xml").send(vr.toString());
      }

      // CONFIRM-CALLER-IDENTITY → Handle identity confirmation for known phone numbers
      if (route === "confirm-caller-identity") {
        const knownName = (req.query.knownName as string) || "";
        const confirmed = speechRaw.includes("yes") || speechRaw.includes("correct") || speechRaw.includes("right") || speechRaw.includes("that's me");
        const denied = speechRaw.includes("no") || speechRaw.includes("not") || speechRaw.includes("wrong");

        if (confirmed) {
          // Identity confirmed - store name and first name in context
          const firstName = extractFirstName(knownName);
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              await storage.updateConversation(call.conversationId, {
                context: { fullName: knownName, firstName, identityConfirmed: true }
              });
            }
            console.log("[CONFIRM-CALLER-IDENTITY] Identity confirmed:", knownName, "First name:", firstName);
          } catch (err) {
            console.error("[CONFIRM-CALLER-IDENTITY] Error storing context:", err);
          }

          // Proceed to intent detection
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafeSSML(g, `${EMOTIONS.excited("Great", "low")}, ${firstName}. ${EMOTIONS.shortPause()} How can I help you today?`);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else if (denied) {
          // Identity not confirmed - ask for correct name
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=capture-caller-name&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, "No problem. Who am I speaking with today?");
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
            action: abs(`/api/voice/handle?route=confirm-caller-identity&callSid=${encodeURIComponent(callSid)}&knownName=${encodeURIComponent(knownName)}`),
            method: "POST",
          });
          saySafe(g, "Sorry, I didn't catch that. Am I speaking with " + knownName + "? Please say yes or no.");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // CAPTURE-CALLER-NAME → Capture name when identity wasn't confirmed
      if (route === "capture-caller-name") {
        const name = speechRaw || "";
        const firstName = extractFirstName(name);

        // Store name and first name in context
        if (name && name.length > 0) {
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              await storage.updateConversation(call.conversationId, {
                context: { fullName: name, firstName, identityConfirmed: false }
              });
            }
            console.log("[CAPTURE-CALLER-NAME] Stored name:", name, "First name:", firstName);
          } catch (err) {
            console.error("[CAPTURE-CALLER-NAME] Failed to store name:", err);
          }
        }

        // Proceed to intent detection
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        saySafe(g, firstName ? `Thanks, ${firstName}. How can I help you today?` : "Thank you. How can I help you today?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
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
          saySafeSSML(g, `${EMOTIONS.excited("Great", "low")}! ${EMOTIONS.shortBreath()} May I have your full name please?`);
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
        const firstName = extractFirstName(name);

        // Store name and firstName in conversation context
        if (name && name.length > 0) {
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, fullName: name, firstName, isNewPatient: true }
              });
            }
            console.log("[ASK-NAME-NEW] Stored name:", name, "First name:", firstName);
          } catch (err) {
            console.error("[ASK-NAME-NEW] Failed to store name:", err);
          }
        }

        // Move to email collection
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=ask-email-new&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        saySafeSSML(g, firstName ? `Thanks, ${firstName}. ${EMOTIONS.shortPause()} What's the best email address to send your appointment confirmation to?` : `Thank you. ${EMOTIONS.shortPause()} What's the best email address to send your appointment confirmation to?`);
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 5a) ASK-EMAIL-NEW → Collect email for new patient
      if (route === "ask-email-new") {
        const emailRaw = speechRaw || "";

        // Get firstName from context
        let firstName = "";
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            firstName = context?.firstName || "";
          }
        } catch (err) {
          console.error("[ASK-EMAIL-NEW] Error getting firstName:", err);
        }

        // Voice-captured emails are often unreliable, so we'll store it but note it may need verification
        // Store email in conversation context
        if (emailRaw && emailRaw.length > 0) {
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, email: emailRaw }
              });
            }
            console.log("[ASK-EMAIL-NEW] Stored email (from voice):", emailRaw);
          } catch (err) {
            console.error("[ASK-EMAIL-NEW] Failed to store email:", err);
          }
        }

        // Move to phone confirmation
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=confirm-phone-new&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 5b) CONFIRM-PHONE-NEW → Confirm phone number for new patient
      if (route === "confirm-phone-new") {
        // Get the last 3 digits of the calling number
        const lastThreeDigits = from.slice(-3);

        // Get firstName from context
        let firstName = "";
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            firstName = context?.firstName || "";
          }
        } catch (err) {
          console.error("[CONFIRM-PHONE-NEW] Error getting firstName:", err);
        }

        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=process-phone-confirm&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        const prompt = firstName
          ? `${firstName}, is the number you're calling from, ending in ${lastThreeDigits}, the best number to reach you on?`
          : `Is the number you're calling from, ending in ${lastThreeDigits}, the best number to reach you on?`;
        saySafe(g, prompt);
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 5c) PROCESS-PHONE-CONFIRM → Handle phone confirmation response
      if (route === "process-phone-confirm") {
        const confirmed = speechRaw.includes("yes") || speechRaw.includes("correct") || speechRaw.includes("right") || speechRaw.includes("that's right");
        const denied = speechRaw.includes("no") || speechRaw.includes("not") || speechRaw.includes("different");

        if (confirmed) {
          // Phone confirmed - store it in context
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, phoneConfirmed: true, confirmedPhone: from }
              });
            }
            console.log("[PROCESS-PHONE-CONFIRM] Phone confirmed:", from);
          } catch (err) {
            console.error("[PROCESS-PHONE-CONFIRM] Error storing phone confirmation:", err);
          }

          // Move to reason for visit
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-reason&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else if (denied) {
          // Phone not confirmed - ask for different number
          // Note: Voice systems can't reliably capture phone numbers, so we'll note it and ask them to provide it another way
          saySafe(vr, "No problem. We'll make a note that you need to provide a different contact number, and our reception team will call you after your appointment is booked to confirm your details. Let's continue with your booking.");

          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, phoneConfirmed: false, needsDifferentPhone: true }
              });
            }
          } catch (err) {
            console.error("[PROCESS-PHONE-CONFIRM] Error storing phone denial:", err);
          }

          // Move to reason for visit
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-reason&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // Unclear - ask again
          const lastThreeDigits = from.slice(-3);
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=process-phone-confirm&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, `Sorry, I didn't catch that. Is the number ending in ${lastThreeDigits} the best number to reach you? Please say yes or no.`);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 5) ASK-REASON → Collect reason and move to week selection
      if (route === "ask-reason") {
        const reason = speechRaw || "";

        // Get firstName from context
        let firstName = "";
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            firstName = context?.firstName || "";
          }
        } catch (err) {
          console.error("[ASK-REASON] Error getting firstName:", err);
        }

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

        // Move to week selection with empathetic filler using first name
        const empathyLine = firstName
          ? `${EMOTIONS.empathetic(`I'm sorry to hear that, ${firstName}`, "high")}. ${EMOTIONS.shortBreath()} Let me see what we have available to get you in quickly.`
          : `${EMOTIONS.empathetic("I'm sorry to hear that", "high")}. ${EMOTIONS.shortBreath()} Let me see what we have available to get you in quickly.`;
        saySafeSSML(vr, empathyLine);
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=0`));
        return res.type("text/xml").send(vr.toString());
      }

      // 6) ASK-WEEK → Which week do they want?
      if (route === "ask-week") {
        const isReturningPatient = (req.query.returning as string) === '1';

        // Get firstName from context
        let firstName = "";
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            firstName = context?.firstName || "";
          }
        } catch (err) {
          console.error("[ASK-WEEK] Error getting firstName:", err);
        }

        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=process-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}`),
          method: "POST",
        });
        const prompt = firstName
          ? `${firstName}, which week works best for you? This week, next week, or another week?`
          : "Which week works best for you? This week, next week, or another week?";
        saySafe(g, prompt);
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 7) PROCESS-WEEK → Determine the week and check if day was mentioned
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

        // Check if they mentioned a specific day in their response
        const mentionedDay = parseDayOfWeek(speechRaw);

        // Store week preference (and day if mentioned)
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const existingContext = (conversation?.context as any) || {};
            const updates: any = { ...existingContext, weekOffset, specificWeek };
            if (mentionedDay) {
              updates.preferredDayOfWeek = mentionedDay;
            }
            await storage.updateConversation(call.conversationId, {
              context: updates
            });
          }
        } catch (err) {
          console.error("[PROCESS-WEEK] Error storing week:", err);
        }

        // If they mentioned a day, skip to time-of-day question
        // Otherwise, ask which day of the week they prefer
        if (mentionedDay) {
          console.log("[PROCESS-WEEK] Day mentioned:", mentionedDay, "- proceeding to time selection");
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-time-of-day&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&weekOffset=${weekOffset}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // Ask for day of week
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-day-of-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&weekOffset=${weekOffset}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 7a) ASK-DAY-OF-WEEK → Which day of the week do they prefer?
      if (route === "ask-day-of-week") {
        const isReturningPatient = (req.query.returning as string) === '1';
        const weekOffset = parseInt((req.query.weekOffset as string) || "1", 10);

        // Get firstName from context
        let firstName = "";
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            firstName = context?.firstName || "";
          }
        } catch (err) {
          console.error("[ASK-DAY-OF-WEEK] Error getting firstName:", err);
        }

        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=process-day-of-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&weekOffset=${weekOffset}`),
          method: "POST",
        });
        const prompt = firstName
          ? `${firstName}, is there a particular day of that week that works best for you? For example, Monday, Wednesday, or Friday?`
          : "Is there a particular day of that week that works best for you? For example, Monday, Wednesday, or Friday?";
        saySafe(g, prompt);
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 7b) PROCESS-DAY-OF-WEEK → Parse the day and move to time selection
      if (route === "process-day-of-week") {
        const isReturningPatient = (req.query.returning as string) === '1';
        const weekOffset = parseInt((req.query.weekOffset as string) || "1", 10);

        // Try to parse day of week from response
        const preferredDay = parseDayOfWeek(speechRaw);

        if (preferredDay) {
          // Store the preferred day
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, preferredDayOfWeek: preferredDay }
              });
            }
            console.log("[PROCESS-DAY-OF-WEEK] Stored day:", preferredDay);
          } catch (err) {
            console.error("[PROCESS-DAY-OF-WEEK] Error storing day:", err);
          }

          // Move to time-of-day selection
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-time-of-day&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&weekOffset=${weekOffset}`));
          return res.type("text/xml").send(vr.toString());
        } else if (speechRaw.includes("any") || speechRaw.includes("no preference") || speechRaw.includes("doesn't matter")) {
          // No preference - proceed without specific day
          console.log("[PROCESS-DAY-OF-WEEK] No day preference expressed");
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-time-of-day&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&weekOffset=${weekOffset}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // Unclear - ask again
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=process-day-of-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&weekOffset=${weekOffset}`),
            method: "POST",
          });
          saySafe(g, "Sorry, I didn't catch that. Which day works best? For example, Monday, Wednesday, or Friday?");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 7c) ASK-TIME-OF-DAY → Ask for time preference (morning/afternoon)
      if (route === "ask-time-of-day") {
        const isReturningPatient = (req.query.returning as string) === '1';
        const weekOffset = parseInt((req.query.weekOffset as string) || "1", 10);

        // Get firstName from context
        let firstName = "";
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            firstName = context?.firstName || "";
          }
        } catch (err) {
          console.error("[ASK-TIME-OF-DAY] Error getting firstName:", err);
        }

        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=get-availability&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&weekOffset=${weekOffset}`),
          method: "POST",
        });
        const prompt = firstName
          ? `${firstName}, do you prefer morning, midday, or afternoon?`
          : "Do you prefer morning, midday, or afternoon?";
        saySafe(g, prompt);
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
        saySafeSSML(vr, `${EMOTIONS.shortBreath()}Just a moment ${EMOTIONS.shortPause()} while I bring up your appointment.`);

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
          saySafeSSML(vr, `${EMOTIONS.sigh()}${EMOTIONS.disappointed("I apologize", "medium")}, ${EMOTIONS.breath()}I'm having trouble accessing your appointment. ${EMOTIONS.mediumPause()} Please call back or try again later.`);
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
          saySafeSSML(vr, `Okay, no problem. ${EMOTIONS.mediumPause()} Is there anything else I can help you with?`);
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        }
      }

      // CANCEL-START → Start cancel flow
      if (route === "cancel-start") {
        const patientId = (req.query.patientId as string) || "";

        // Add thinking filler
        saySafeSSML(vr, `${EMOTIONS.shortBreath()}Just a moment ${EMOTIONS.shortPause()} while I bring up your appointment.`);

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
          saySafeSSML(vr, `${EMOTIONS.sigh()}${EMOTIONS.disappointed("I apologize", "medium")}, ${EMOTIONS.breath()}I'm having trouble accessing your appointment. ${EMOTIONS.mediumPause()} Please call back or try again later.`);
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
            saySafeSSML(g, `${EMOTIONS.breath()}No problem, I understand. ${EMOTIONS.shortPause()} Your appointment has been cancelled. ${EMOTIONS.mediumPause()} Would you like to book a new one so you don't fall behind on your care?`);
            g.pause({ length: 1 });
            vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
            return res.type("text/xml").send(vr.toString());
          } catch (err) {
            console.error("[CANCEL-CONFIRM] Error cancelling:", err);
            saySafeSSML(vr, `${EMOTIONS.sigh()}${EMOTIONS.disappointed("I'm sorry", "medium")}, ${EMOTIONS.breath()}I couldn't cancel your appointment. ${EMOTIONS.mediumPause()} Please call back or try our office directly.`);
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
          saySafeSSML(vr, `${EMOTIONS.excited("Alright", "low")}, have a great day!`);
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 2) BOOK-DAY → confirm intent then either ask for name or skip to day selection (LEGACY - keeping for compatibility)
      if (route === "book-day") {
        if (!(speechRaw.includes("yes") || speechRaw.includes("book") || speechRaw.includes("appointment"))) {
          saySafeSSML(vr, `Okay. ${EMOTIONS.shortPause()} Take care, goodbye.`);
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

        // Determine if new patient and preferred day from conversation context
        let isNewPatient = !isReturningPatient;
        let weekOffset = weekOffsetParam;
        let preferredDayOfWeek: string | undefined;

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
            if (context?.preferredDayOfWeek) {
              preferredDayOfWeek = context.preferredDayOfWeek;
            }
          }
        } catch (err) {
          console.error("[GET-AVAILABILITY] Error checking conversation context:", err);
        }

        // Use appropriate appointment type
        const appointmentTypeId = isNewPatient
          ? env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID
          : env.CLINIKO_APPT_TYPE_ID;

        // Calculate date range based on week offset and preferred day
        const tzNow = dayjs().tz();
        let fromDate: string;
        let toDate: string;

        if (preferredDayOfWeek) {
          // If they specified a day, find that specific day in the target week
          const weekdayMap: { [key: string]: number } = {
            "sunday": 0,
            "monday": 1,
            "tuesday": 2,
            "wednesday": 3,
            "thursday": 4,
            "friday": 5,
            "saturday": 6
          };

          const targetDayNumber = weekdayMap[preferredDayOfWeek.toLowerCase()];

          if (targetDayNumber === undefined) {
            console.error("[GET-AVAILABILITY] Invalid day:", preferredDayOfWeek);
            // Fallback to whole week
            const weekStart = tzNow.add(weekOffset, 'week').startOf('week');
            const weekEnd = weekStart.endOf('week');
            fromDate = weekStart.format("YYYY-MM-DD");
            toDate = weekEnd.format("YYYY-MM-DD");
          } else {
            const weekStart = tzNow.add(weekOffset, 'week').startOf('week');
            let targetDate = weekStart.day(targetDayNumber);

            // CRITICAL FIX: Ensure target date is not in the past
            // If the calculated date is before today, it means we need to look at next week's occurrence
            if (targetDate.isBefore(tzNow, 'day')) {
              console.log("[GET-AVAILABILITY] Target date", targetDate.format("YYYY-MM-DD"), "is in the past, moving to next week");
              targetDate = targetDate.add(1, 'week');
            }

            fromDate = targetDate.format("YYYY-MM-DD");
            toDate = fromDate; // Same day
            console.log("[GET-AVAILABILITY] Targeting specific day:", preferredDayOfWeek, "on", fromDate);
          }
        } else {
          // No preferred day - search the whole week
          const weekStart = tzNow.add(weekOffset, 'week').startOf('week');
          const weekEnd = weekStart.endOf('week');
          fromDate = weekStart.format("YYYY-MM-DD");
          toDate = weekEnd.format("YYYY-MM-DD");
        }

        console.log("[GET-AVAILABILITY]", { fromDate, toDate, isNewPatient, appointmentTypeId, timePart, weekOffset, preferredDayOfWeek });

        // Add thinking filler
        saySafeSSML(vr, `Thanks for waiting. ${EMOTIONS.shortBreath()}${EMOTIONS.shortPause()} Let me just pull up the schedule.`);

        let slots: Array<{ startISO: string; endISO?: string; label?: string }> = [];
        try {
          console.log("[GET-AVAILABILITY] ========================================");
          console.log("[GET-AVAILABILITY] Calling getAvailability with:");
          console.log("[GET-AVAILABILITY]   fromDate:", fromDate);
          console.log("[GET-AVAILABILITY]   toDate:", toDate);
          console.log("[GET-AVAILABILITY]   appointmentTypeId:", appointmentTypeId);
          console.log("[GET-AVAILABILITY]   timePart:", timePart);
          console.log("[GET-AVAILABILITY]   isNewPatient:", isNewPatient);
          console.log("[GET-AVAILABILITY]   weekOffset:", weekOffset);
          console.log("[GET-AVAILABILITY]   preferredDayOfWeek:", preferredDayOfWeek);
          console.log("[GET-AVAILABILITY] ========================================");

          const result = await getAvailability({
            fromISO: fromDate,
            toISO: toDate,
            appointmentTypeId,
            part: timePart
          });
          slots = result.slots || [];
          console.log(`[GET-AVAILABILITY] SUCCESS: Received ${slots.length} slots from getAvailability`);
          if (slots.length > 0) {
            console.log("[GET-AVAILABILITY] First slot:", slots[0]);
          }
        } catch (e: any) {
          console.error("[GET-AVAILABILITY][getAvailability ERROR]", e);
          console.error("[GET-AVAILABILITY] Error details:", {
            message: e.message,
            stack: e.stack,
            fromDate,
            toDate,
            appointmentTypeId,
            timePart,
            isNewPatient
          });
          try {
            const tenant = await storage.getTenant("default");
            if (tenant) {
              const alert = await storage.createAlert({
                tenantId: tenant.id,
                reason: "cliniko_error",
                payload: {
                  error: e.message,
                  stack: e.stack,
                  endpoint: "getAvailability",
                  callSid,
                  from,
                  parameters: { fromDate, toDate, appointmentTypeId, timePart, isNewPatient }
                },
              });
              emitAlertCreated(alert);
            }
          } catch (alertErr) {
            console.error("[ALERT ERROR]", alertErr);
          }
          // Get clinic phone number for fallback
          let clinicPhone = "";
          try {
            const tenant = await storage.getTenant("default");
            if (tenant?.clinicName) {
              // If we have a clinic phone, we could get it here
              // For now, we'll ask them to call back
            }
          } catch (err) {
            console.error("[GET-AVAILABILITY] Error getting clinic info:", err);
          }

          saySafeSSML(vr, `${EMOTIONS.sigh()}${EMOTIONS.disappointed("I apologize", "high")}, ${EMOTIONS.breath()}I'm having trouble accessing the schedule right now. ${EMOTIONS.mediumPause()} Please try calling back in a few minutes and we'll help you book your appointment. ${EMOTIONS.shortPause()} Thank you for calling.`);
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        }

        const available = slots.slice(0, 2);
        if (available.length === 0) {
          console.log("[GET-AVAILABILITY] No slots found - creating alert");
          try {
            const tenant = await storage.getTenant("default");
            if (tenant) {
              const alert = await storage.createAlert({
                tenantId: tenant.id,
                reason: "no_availability",
                payload: { fromDate, toDate, timePart, preferredDayOfWeek, callSid, from },
              });
              emitAlertCreated(alert);
            }
          } catch (alertErr) {
            console.error("[ALERT ERROR]", alertErr);
          }

          // Build a specific message about what wasn't available
          let noAvailMessage = `${EMOTIONS.sigh()}${EMOTIONS.disappointed("I apologize", "medium")}, `;
          if (preferredDayOfWeek && timePart) {
            noAvailMessage += `there are no ${timePart} appointments available on ${preferredDayOfWeek}.`;
          } else if (preferredDayOfWeek) {
            noAvailMessage += `there are no appointments available on ${preferredDayOfWeek}.`;
          } else if (timePart) {
            noAvailMessage += `there are no ${timePart} appointments available for that week.`;
          } else {
            noAvailMessage += "there are no appointments available for that selection.";
          }
          noAvailMessage += ` ${EMOTIONS.mediumPause()} Would you like to try a different day or time?`;

          // Offer to try different time or week
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}`),
            method: "POST",
          });
          saySafeSSML(g, noAvailMessage);
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

        // Build prompt mentioning the day if it was specified
        let prompt: string;
        if (preferredDayOfWeek && s2) {
          prompt = `${EMOTIONS.excited("Great news", "low")}! ${EMOTIONS.shortPause()} I have two options for ${preferredDayOfWeek}. ${EMOTIONS.shortPause()} Option one, ${opt1}. ${EMOTIONS.shortPause()} Or option two, ${opt2}. ${EMOTIONS.mediumPause()} Press 1 or 2, or say your choice.`;
        } else if (preferredDayOfWeek && !s2) {
          prompt = `${EMOTIONS.excited("Perfect", "low")}! ${EMOTIONS.shortPause()} I have one option available on ${preferredDayOfWeek}: ${EMOTIONS.shortPause()} ${opt1}. ${EMOTIONS.mediumPause()} Press 1 or say yes to book it.`;
        } else if (s2) {
          prompt = `${EMOTIONS.excited("Great", "low")}! ${EMOTIONS.shortPause()} I have two options. ${EMOTIONS.shortPause()} Option one, ${opt1}. ${EMOTIONS.shortPause()} Or option two, ${opt2}. ${EMOTIONS.mediumPause()} Press 1 or 2, or say your choice.`;
        } else {
          prompt = `${EMOTIONS.excited("Perfect", "low")}! ${EMOTIONS.shortPause()} I have one option available: ${EMOTIONS.shortPause()} ${opt1}. ${EMOTIONS.mediumPause()} Press 1 or say yes to book it.`;
        }

        saySafeSSML(g, prompt);
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
        const isReturningPatient = (req.query.returning as string) === '1';
        const appointmentTypeId = (req.query.apptTypeId as string) || env.CLINIKO_APPT_TYPE_ID;
        const retryCount = parseInt((req.query.retry as string) || "0", 10);

        // Use helper function to interpret the choice
        const interpretation = interpretSlotChoice(speechRaw, digits);
        console.log("[BOOK-CHOOSE] Interpretation:", interpretation);

        // Get firstName for personalized responses
        let firstName = "";
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            firstName = context?.firstName || "";
          }
        } catch (err) {
          console.error("[BOOK-CHOOSE] Error getting firstName:", err);
        }

        // Handle rejection - ask for alternative
        if (interpretation.choice === "reject") {
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}`),
            method: "POST",
          });
          const prompt = firstName
            ? `No problem, ${firstName}. Which day and time works better for you?`
            : "That's okay. Which day and time works better for you?";
          saySafe(g, prompt);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        // Handle alternative day request
        if (interpretation.choice === "alt_day" && interpretation.requestedDayOfWeek) {
          const requestedDay = interpretation.requestedDayOfWeek;
          console.log("[BOOK-CHOOSE] User requested alternative day:", requestedDay);

          // Store the requested day in context and redirect to time preference
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, requestedDayOfWeek: requestedDay }
              });
            }
          } catch (err) {
            console.error("[BOOK-CHOOSE] Error storing requested day:", err);
          }

          // Ask for time preference for the new day
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=get-availability-specific-day&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&day=${encodeURIComponent(requestedDay)}`),
            method: "POST",
          });
          saySafe(g, `No worries, let me check ${requestedDay}. Do you prefer morning or afternoon?`);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        // Handle unknown input - reprompt once
        if (interpretation.choice === "unknown") {
          if (retryCount < 1) {
            // First retry - reprompt
            const opt1 = labelForSpeech(s1, AUST_TZ);
            const opt2 = s2 ? labelForSpeech(s2, AUST_TZ) : "";
            const nextUrl = abs(
              `/api/voice/handle?route=book-choose&callSid=${encodeURIComponent(callSid)}&s1=${encodeURIComponent(s1)}${
                s2 ? `&s2=${encodeURIComponent(s2)}` : ""
              }&returning=${isReturningPatient ? '1' : '0'}&apptTypeId=${encodeURIComponent(appointmentTypeId)}&retry=1`
            );
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
              `Sorry, I didn't quite catch that. If you'd like one of those times, you can say 'option one' or 'option two'. Or you can tell me another day and time that works better for you.`
            );
            g.pause({ length: 1 });
            vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
            return res.type("text/xml").send(vr.toString());
          } else {
            // Second failure - offer to transfer or end call
            saySafe(vr, "I'm sorry, I'm having trouble understanding. Please call our front desk at your convenience to book your appointment. Goodbye.");
            vr.hangup();
            return res.type("text/xml").send(vr.toString());
          }
        }

        // Valid choice - determine which option was selected
        const choiceIdx = interpretation.choice === "option2" && s2 ? 1 : 0;
        const chosen = choiceIdx === 1 ? s2 : s1;

        if (!chosen) {
          saySafeSSML(vr, `${EMOTIONS.disappointed("I'm sorry", "low")}, ${EMOTIONS.shortBreath()}that option is no longer available. ${EMOTIONS.mediumPause()} Let's start again.`);
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=start`));
          return res.type("text/xml").send(vr.toString());
        }

        // Retrieve captured identity and reason from conversation context OR phone_map
        let fullName: string | undefined;
        let email: string | undefined;
        let patientId: string | undefined;
        let isReschedule = false;
        let apptId: string | undefined;
        let reasonForVisit: string | undefined;
        let phoneConfirmed = false;
        let needsDifferentPhone = false;

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

            // Extract reason for visit from context
            if (context?.reason) {
              reasonForVisit = context.reason;
              console.log("[BOOK-CHOOSE] Retrieved reason for visit:", reasonForVisit);
            }

            // Extract phone confirmation status
            if (context?.phoneConfirmed !== undefined) {
              phoneConfirmed = context.phoneConfirmed;
            }
            if (context?.needsDifferentPhone) {
              needsDifferentPhone = context.needsDifferentPhone;
            }

            // Check if this is a reschedule operation
            if (context?.isReschedule) {
              isReschedule = true;
              apptId = context.apptId;
              patientId = context.patientId || patientId;
            }
            console.log("[BOOK-CHOOSE] Final identity:", { fullName, email, isReschedule, apptId, reasonForVisit, phoneConfirmed, needsDifferentPhone });
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

            const lastFourDigits = from.slice(-3);
            saySafeSSML(vr, `${EMOTIONS.excited("Perfect", "medium")}! ${EMOTIONS.shortPause()} You're all booked for ${spokenTime} with Dr. Michael. ${EMOTIONS.shortPause()} We'll send a confirmation to your mobile ending in ${lastFourDigits}. ${EMOTIONS.mediumPause()} Is there anything else I can help you with today?`);
            vr.hangup();
            return res.type("text/xml").send(vr.toString());
          } else {
            // CREATE NEW appointment
            // Include reason for visit in notes if available
            let appointmentNotes = isReturningPatient
              ? `Follow-up appointment booked via voice call at ${new Date().toISOString()}`
              : `New patient appointment booked via voice call at ${new Date().toISOString()}`;

            if (reasonForVisit) {
              appointmentNotes += `\n\nReason for visit: ${reasonForVisit}`;
            }

            // Add contact info notes
            if (needsDifferentPhone) {
              appointmentNotes += `\n\n⚠️ Patient indicated they need a different contact number. Please follow up to confirm contact details.`;
            } else if (phoneConfirmed) {
              appointmentNotes += `\n\n✓ Patient confirmed phone number: ${from}`;
            }

            if (email) {
              appointmentNotes += `\n\nEmail provided (via voice - may need verification): ${email}`;
            }

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

          const lastFourDigits = from.slice(-3);
          saySafeSSML(vr, `${EMOTIONS.excited("Wonderful", "medium")}! ${EMOTIONS.shortPause()} You're all set for ${spokenTime} with Dr. Michael. ${EMOTIONS.shortPause()} We'll send a confirmation to your mobile ending in ${lastFourDigits}. ${EMOTIONS.mediumPause()} Is there anything else I can help you with today?`);
          vr.hangup();
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
          saySafeSSML(vr, `${EMOTIONS.sigh()}${EMOTIONS.disappointed("I'm very sorry", "high")}, ${EMOTIONS.breath()}I couldn't complete the booking. ${EMOTIONS.mediumPause()} Please try again later or call our office directly.`);
          return res.type("text/xml").send(vr.toString());
        }
      }

      // GET-AVAILABILITY-SPECIFIC-DAY → Handle requests for specific day of week
      if (route === "get-availability-specific-day") {
        const isReturningPatient = (req.query.returning as string) === '1';
        const requestedDay = ((req.query.day as string) || "").toLowerCase();

        // Get time preference from speech
        let timePart: 'morning' | 'afternoon' | undefined;
        if (speechRaw.includes("morning") || speechRaw.includes("early")) {
          timePart = 'morning';
        } else if (speechRaw.includes("afternoon") || speechRaw.includes("midday") || speechRaw.includes("late")) {
          timePart = 'afternoon';
        }

        // Determine if new patient from conversation context
        let isNewPatient = !isReturningPatient;

        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            if (context?.isNewPatient !== undefined) {
              isNewPatient = context.isNewPatient;
            }
          }
        } catch (err) {
          console.error("[GET-AVAILABILITY-SPECIFIC-DAY] Error checking conversation context:", err);
        }

        // Use appropriate appointment type
        const appointmentTypeId = isNewPatient
          ? env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID
          : env.CLINIKO_APPT_TYPE_ID;

        // Calculate the date for the requested day of week
        const weekdayMap: { [key: string]: number } = {
          "sunday": 0,
          "monday": 1,
          "tuesday": 2,
          "wednesday": 3,
          "thursday": 4,
          "friday": 5,
          "saturday": 6
        };

        const targetDayNumber = weekdayMap[requestedDay];
        if (targetDayNumber === undefined) {
          saySafe(vr, "Sorry, I didn't catch which day you wanted. Let me ask again.");
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}`));
          return res.type("text/xml").send(vr.toString());
        }

        const tzNow = dayjs().tz();
        const currentDayNumber = tzNow.day();

        // Calculate days ahead to the requested day
        // If the day is in the past this week, go to next week
        let daysAhead = targetDayNumber - currentDayNumber;
        if (daysAhead <= 0) {
          daysAhead += 7;
        }

        const targetDate = tzNow.add(daysAhead, 'day');
        const fromDate = targetDate.format("YYYY-MM-DD");
        const toDate = fromDate;

        console.log("[GET-AVAILABILITY-SPECIFIC-DAY]", { requestedDay, fromDate, toDate, isNewPatient, appointmentTypeId, timePart });

        // Add thinking filler
        saySafe(vr, `Let me check ${requestedDay} for you.`);

        let slots: Array<{ startISO: string; endISO?: string; label?: string }> = [];
        try {
          const result = await getAvailability({
            fromISO: fromDate,
            toISO: toDate,
            appointmentTypeId,
            part: timePart
          });
          slots = result.slots || [];
          console.log(`[GET-AVAILABILITY-SPECIFIC-DAY] Received ${slots.length} slots from getAvailability`);
        } catch (e: any) {
          console.error("[GET-AVAILABILITY-SPECIFIC-DAY][getAvailability ERROR]", e);
          try {
            const tenant = await storage.getTenant("default");
            if (tenant) {
              const alert = await storage.createAlert({
                tenantId: tenant.id,
                reason: "cliniko_error",
                payload: {
                  error: e.message,
                  stack: e.stack,
                  endpoint: "getAvailability",
                  callSid,
                  from,
                  parameters: { fromDate, toDate, appointmentTypeId, timePart, isNewPatient }
                },
              });
              emitAlertCreated(alert);
            }
          } catch (alertErr) {
            console.error("[ALERT ERROR]", alertErr);
          }
          saySafeSSML(vr, `${EMOTIONS.sigh()}${EMOTIONS.disappointed("I apologize", "high")}, ${EMOTIONS.breath()}I'm having trouble accessing the schedule right now. ${EMOTIONS.mediumPause()} Please try calling back in a few minutes and we'll help you book your appointment. ${EMOTIONS.shortPause()} Thank you for calling.`);
          vr.hangup();
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
                payload: { fromDate, toDate, timePart, requestedDay, callSid, from },
              });
              emitAlertCreated(alert);
            }
          } catch (alertErr) {
            console.error("[ALERT ERROR]", alertErr);
          }

          // Offer to try different time or day
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}`),
            method: "POST",
          });
          saySafe(g, `Sorry, there are no times available on ${requestedDay} for that time. Would you like to try a different day?`);
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
            ? `I have two options for ${requestedDay}. Option one, ${opt1}. Or option two, ${opt2}. Press 1 or 2, or say your choice.`
            : `I have one option available on ${requestedDay}: ${opt1}. Press 1 or say yes to book it.`
        );
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, timeoutUrl);

        return res.type("text/xml").send(vr.toString());
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
