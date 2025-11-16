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
 * Handles both normal names and spelled-out names (e.g., "M i c h a e l")
 */
function extractFirstName(fullName: string): string {
  if (!fullName) return "";

  const trimmed = fullName.trim();

  // Check if this looks like a spelled-out name (single letters separated by spaces)
  // Pattern: single char, space, single char, etc.
  const spelledOutPattern = /^([a-z]\s+)+[a-z]$/i;
  if (spelledOutPattern.test(trimmed)) {
    // Reconstruct the name by removing spaces between single letters
    const reconstructed = trimmed.replace(/\s+/g, '');
    console.log("[extractFirstName] Detected spelled-out name, reconstructed:", reconstructed);
    return reconstructed;
  }

  // Normal name parsing: split on whitespace and take first part
  const parts = trimmed.split(/\s+/);
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

      console.log("[RECORDING_STATUS] 📥 Callback received from Twilio");
      console.log("[RECORDING_STATUS]   - Call SID:", callSid);
      console.log("[RECORDING_STATUS]   - Recording SID:", recordingSid);
      console.log("[RECORDING_STATUS]   - Status:", status);
      console.log("[RECORDING_STATUS]   - URL:", recordingUrl);
      console.log("[RECORDING_STATUS]   - Full payload:", JSON.stringify(req.body, null, 2));

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

        // Trigger transcription if recording is completed
        const { env } = await import("../utils/env");
        if (status === 'completed' && env.TRANSCRIPTION_ENABLED && recordingUrl && env.ASSEMBLYAI_API_KEY) {
          console.log("[RECORDING_STATUS] 🎤 Triggering transcription for recording:", recordingSid);

          // Import transcription service
          const { transcribeRecordingAsync } = await import("../services/transcription");

          // Start transcription asynchronously
          transcribeRecordingAsync(
            callSid,
            recordingUrl,
            env.TWILIO_ACCOUNT_SID,
            env.TWILIO_AUTH_TOKEN,
            async (transcript) => {
              // Update call with transcript
              console.log("[RECORDING_STATUS] 📝 Updating call with transcript:", callSid);
              const updatedWithTranscript = await storage.updateCall(callSid, {
                transcript: transcript
              });
              if (updatedWithTranscript) {
                // Emit WebSocket update with transcript
                emitCallUpdated(updatedWithTranscript);
                console.log("[RECORDING_STATUS] ✅ Call updated with transcript");
              }
            }
          );
        } else if (status === 'completed') {
          if (!env.TRANSCRIPTION_ENABLED) {
            console.log("[RECORDING_STATUS] ⏭️  Transcription disabled (TRANSCRIPTION_ENABLED=false)");
          } else if (!env.ASSEMBLYAI_API_KEY) {
            console.log("[RECORDING_STATUS] ⚠️  AssemblyAI API key not configured");
          }
        }
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

      console.log("[TRANSCRIPTION_STATUS] 📥 Callback received from Twilio");
      console.log("[TRANSCRIPTION_STATUS]   - Call SID:", callSid);
      console.log("[TRANSCRIPTION_STATUS]   - Recording SID:", recordingSid);
      console.log("[TRANSCRIPTION_STATUS]   - Transcription SID:", transcriptionSid);
      console.log("[TRANSCRIPTION_STATUS]   - Status:", transcriptionStatus);
      console.log("[TRANSCRIPTION_STATUS]   - Text length:", transcriptionText.length, "chars");
      console.log("[TRANSCRIPTION_STATUS]   - Full payload:", JSON.stringify(req.body, null, 2));

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

    // Start recording after a delay to ensure call is in-progress
    const { env } = await import("../utils/env");
    if (env.CALL_RECORDING_ENABLED && callSid) {
      console.log("[VOICE][RECORDING] 🎙️  Recording is ENABLED for call:", callSid);

      // Wait 2 seconds for call to be fully established before starting recording
      setTimeout(async () => {
        try {
          const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

          const recordingParams: any = {
            recordingStatusCallback: abs("/api/voice/recording-status"),
            recordingStatusCallbackMethod: "POST",
          };

          // Note: Twilio native transcription doesn't work with Recordings API
          // We use AssemblyAI for transcription in the recording-status webhook instead
          if (env.TRANSCRIPTION_ENABLED) {
            console.log("[VOICE][RECORDING] 📞 Recording with transcription enabled (via AssemblyAI)");
          }

          console.log("[VOICE][RECORDING] 🔄 Starting recording for call:", callSid);
          console.log("[VOICE][RECORDING] 📋 Recording parameters:", JSON.stringify(recordingParams, null, 2));
          const recording = await client.calls(callSid).recordings.create(recordingParams);
          console.log("[VOICE][RECORDING] 📋 Twilio response:", JSON.stringify({
            sid: recording.sid,
            status: recording.status,
            uri: recording.uri,
            // Check if Twilio returned any transcription info
            transcription: (recording as any).transcription
          }, null, 2));
          console.log("[VOICE][RECORDING] ✅ SUCCESS! Recording started");
          console.log("[VOICE][RECORDING]   - Recording SID:", recording.sid);
          console.log("[VOICE][RECORDING]   - Status:", recording.status);
        } catch (recErr: any) {
          console.error("[VOICE][RECORDING] ❌ FAILED to start recording");
          console.error("[VOICE][RECORDING]   - Call SID:", callSid);
          console.error("[VOICE][RECORDING]   - Error:", recErr.message);

          // Create alert for failed recording
          try {
            const tenant = await storage.getTenant("default");
            if (tenant) {
              await storage.createAlert({
                tenantId: tenant.id,
                reason: "recording_failed",
                payload: {
                  error: recErr.message,
                  stack: recErr.stack,
                  callSid,
                  timestamp: new Date().toISOString()
                },
                status: "open"
              });
            }
          } catch (alertErr) {
            console.error("[VOICE][RECORDING] ⚠️  Failed to create alert:", alertErr);
          }
        }
      }, 2000); // 2 second delay
    } else {
      if (!env.CALL_RECORDING_ENABLED) {
        console.log("[VOICE][RECORDING] ⏭️  Recording is DISABLED (CALL_RECORDING_ENABLED=false)");
      }
      if (!callSid) {
        console.log("[VOICE][RECORDING] ⚠️  No callSid provided, cannot start recording");
      }
    }

    // Check if we have a known patient for this number
    // First check Cliniko, then fall back to local phone_map
    let knownPatientName: string | undefined;

    // 1. Try Cliniko lookup first
    try {
      const clinikoPatient = await findPatientByPhoneRobust(from);
      if (clinikoPatient) {
        knownPatientName = `${clinikoPatient.first_name} ${clinikoPatient.last_name}`.trim();
        console.log("[VOICE] Known patient from Cliniko:", knownPatientName, "ID:", clinikoPatient.id);
      }
    } catch (err) {
      console.error("[VOICE] Error checking Cliniko for patient:", err);
    }

    // 2. If not found in Cliniko, check local phone_map as fallback
    if (!knownPatientName) {
      try {
        const phoneMapEntry = await storage.getPhoneMap(from);
        if (phoneMapEntry?.fullName) {
          knownPatientName = phoneMapEntry.fullName;
          console.log("[VOICE] Known patient from phone_map:", knownPatientName);
        }
      } catch (err) {
        console.error("[VOICE] Error checking phone_map for greeting:", err);
      }
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
      // Known patient - confirm identity using first name only
      const firstName = extractFirstName(knownPatientName);
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

      // Warm Australian greeting with first name only
      const greetings = [
        `Hi there, thanks for calling ${clinicName}. Am I speaking with ${firstName}?`,
        `G'day, you've called ${clinicName}. Is this ${firstName}?`,
        `Hi, thanks for calling ${clinicName}. Am I chatting with ${firstName}?`
      ];
      const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
      saySafeSSML(g, randomGreeting);
      g.pause({ length: 1 });
      vr.redirect({ method: "POST" }, timeoutUrl);
    } else {
      // Unknown number - warm generic greeting
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

      const greetings = [
        `Hi there, thanks for calling ${clinicName}. How can I help you today?`,
        `G'day, you've called ${clinicName}. What can I do for you?`,
        `Hi, thanks for calling ${clinicName}. What brings you in?`
      ];
      const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
      saySafeSSML(g, randomGreeting);
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

      // Timeout fallback with Australian charm and light humor
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
        // Light humor and warmth for audio issues
        const retryMessages = [
          "Sorry, I think we've got a dodgy line there. Can you say that again?",
          "You're breaking up a bit - can you repeat that for me?",
          "Ahh sorry, I didn't quite catch that. What was it you needed?"
        ];
        const randomRetry = retryMessages[Math.floor(Math.random() * retryMessages.length)];
        saySafeSSML(g, randomRetry);
        g.pause({ length: 1 });
        // If timeout again, end call gracefully with empathy
        const farewellMessages = [
          "I'm really sorry, I'm having trouble hearing you. Give us a call back when you can, and we'll sort you out. Take care!",
          "Ahh the line's not great today. No worries, just call us back when you get a chance. Bye for now!",
          "Sorry about this - must be the connection. Feel free to call back anytime. Goodbye!"
        ];
        const randomFarewell = farewellMessages[Math.floor(Math.random() * farewellMessages.length)];
        saySafeSSML(vr, randomFarewell);
        return res.type("text/xml").send(vr.toString());
      }

      // ANYTHING-ELSE → Handle response to "Is there anything else I can help you with?"
      if (route === "anything-else") {
        const sayingNo = speechRaw.includes("no") || speechRaw.includes("nope") || speechRaw.includes("nah") ||
                         speechRaw.includes("that's all") || speechRaw.includes("that's it") || speechRaw.includes("i'm good");

        const wantsToBook = speechRaw.includes("book") || speechRaw.includes("reschedule") || speechRaw.includes("cancel");

        if (sayingNo) {
          // They're done - warm, reassuring goodbye
          const goodbyeMessages = [
            "Beautiful! Have a lovely day, and we'll see you soon. Take care!",
            "Perfect! If anything changes, just give us a buzz. See you soon!",
            "All sorted then! We're looking forward to seeing you. Take care!",
            "Lovely! You're all set. See you at your appointment. Bye for now!"
          ];
          const randomGoodbye = goodbyeMessages[Math.floor(Math.random() * goodbyeMessages.length)];
          saySafe(vr, randomGoodbye);
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        } else if (wantsToBook) {
          // They want to manage appointments - send to start
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // They have a question or said "yes" - gather the question and create an alert
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=capture-question&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          const questionPrompts = [
            "Of course! What would you like to know?",
            "Sure thing! What's your question?",
            "No worries! How can I help?"
          ];
          const randomPrompt = questionPrompts[Math.floor(Math.random() * questionPrompts.length)];
          saySafe(g, randomPrompt);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // CAPTURE-QUESTION → Capture their question and create an alert for reception
      if (route === "capture-question") {
        const question = speechRaw || "";

        // Create an alert for the reception team
        try {
          const call = await storage.getCallByCallSid(callSid);
          const tenant = await storage.getTenant("default");

          if (tenant && call) {
            await storage.createAlert({
              tenantId: tenant.id,
              conversationId: call.conversationId || undefined,
              reason: "caller_question",
              payload: {
                question: question,
                fromNumber: from,
                callSid: callSid,
                timestamp: new Date().toISOString()
              },
              status: "open"
            });
            console.log("[CAPTURE-QUESTION] Created alert for question:", question);
          }
        } catch (err) {
          console.error("[CAPTURE-QUESTION] Failed to create alert:", err);
        }

        // Acknowledge and let them know the team will follow up
        saySafe(vr, "Thanks for that! I've noted your question and one of our team will get back to you with the details. Is there anything else I can help with?");

        // Give them a chance to ask another question or say no
        const g = vr.gather({
          input: ["speech"],
          timeout: 3,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=final-anything-else&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=final-goodbye&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // FINAL-ANYTHING-ELSE → Handle final response after capturing question
      if (route === "final-anything-else") {
        const sayingNo = speechRaw.includes("no") || speechRaw.includes("nope") || speechRaw.includes("nah") ||
                         speechRaw.includes("that's all") || speechRaw.includes("that's it") || speechRaw.includes("i'm good");

        if (sayingNo) {
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=final-goodbye&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // They have another question
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=capture-question&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // FINAL-GOODBYE → End call with warm goodbye
      if (route === "final-goodbye") {
        const goodbyeMessages = [
          "Perfect! We'll be in touch soon. Have a lovely day!",
          "Beautiful! Talk to you soon. Take care!",
          "Lovely! We'll get back to you shortly. Bye for now!"
        ];
        const randomGoodbye = goodbyeMessages[Math.floor(Math.random() * goodbyeMessages.length)];
        saySafe(vr, randomGoodbye);
        vr.hangup();
        return res.type("text/xml").send(vr.toString());
      }

      // CONFIRM-CALLER-IDENTITY → Handle identity confirmation for known phone numbers
      if (route === "confirm-caller-identity") {
        const knownName = (req.query.knownName as string) || "";
        const confirmed = speechRaw.includes("yes") || speechRaw.includes("correct") || speechRaw.includes("right") || speechRaw.includes("that's me") || speechRaw.includes("yep") || speechRaw.includes("yeah");
        const denied = speechRaw.includes("no") || speechRaw.includes("not") || speechRaw.includes("wrong") || speechRaw.includes("nah");

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

          // Ask if appointment is for them or someone else
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=check-appointment-for&callSid=${encodeURIComponent(callSid)}&knownName=${encodeURIComponent(knownName)}`),
            method: "POST",
          });
          // Ask if this appointment is for the caller or someone else - be very clear
          const appointmentForPrompts = [
            `Perfect! And is this appointment for you, or is it for someone else?`,
            `Great! Just to confirm - is the appointment for you, ${firstName}, or for another person?`,
            `Lovely! Who's the appointment for - yourself, or someone else?`
          ];
          const randomPrompt = appointmentForPrompts[Math.floor(Math.random() * appointmentForPrompts.length)];
          saySafe(g, randomPrompt);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else if (denied) {
          // Identity not confirmed - ask for correct name warmly
          const g = vr.gather({
            input: ["speech"],
            timeout: 10,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=capture-caller-name&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          const apologies = [
            "No worries at all. Who am I chatting with today?",
            "No problem at all. What's your name?",
            "All good. Who am I speaking with?"
          ];
          const randomApology = apologies[Math.floor(Math.random() * apologies.length)];
          saySafe(g, randomApology);
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

      // CHECK-APPOINTMENT-FOR → Check if appointment is for caller or someone else
      if (route === "check-appointment-for") {
        const knownName = (req.query.knownName as string) || "";
        const forSelf = speechRaw.includes("me") || speechRaw.includes("myself") || speechRaw.includes("yes") || speechRaw.includes("for me");
        const forOther = speechRaw.includes("someone else") || speechRaw.includes("other") || speechRaw.includes("else") || speechRaw.includes("no") ||
                         speechRaw.includes("another person") || speechRaw.includes("different person");

        console.log("[CHECK-APPOINTMENT-FOR] Speech:", speechRaw);
        console.log("[CHECK-APPOINTMENT-FOR] forSelf:", forSelf, "forOther:", forOther);

        if (forSelf) {
          // Appointment is for the caller - proceed to intent detection
          console.log("[CHECK-APPOINTMENT-FOR] Appointment is for caller, proceeding to start");
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else if (forOther) {
          // Appointment is for someone else - ask for their name
          console.log("[CHECK-APPOINTMENT-FOR] Appointment is for someone else, asking for name");
          const g = vr.gather({
            input: ["speech"],
            timeout: 10,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=capture-other-person-name&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, "No worries. What's the name of the person the appointment is for?");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // Unclear response - ask again
          console.log("[CHECK-APPOINTMENT-FOR] Unclear response, asking again");
          const firstName = extractFirstName(knownName);
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=check-appointment-for&callSid=${encodeURIComponent(callSid)}&knownName=${encodeURIComponent(knownName)}`),
            method: "POST",
          });
          saySafe(g, `Sorry, I didn't catch that. Is this appointment for you, ${firstName}, or for someone else?`);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // CAPTURE-OTHER-PERSON-NAME → Capture name when appointment is for someone else
      if (route === "capture-other-person-name") {
        const otherPersonName = speechRaw || "";
        const firstName = extractFirstName(otherPersonName);

        console.log("[CAPTURE-OTHER-PERSON-NAME] Received name:", otherPersonName);
        console.log("[CAPTURE-OTHER-PERSON-NAME] Extracted first name:", firstName);

        // Store the other person's name in context and mark as NEW PATIENT
        if (otherPersonName && otherPersonName.length > 0) {
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: {
                  ...existingContext,
                  fullName: otherPersonName,
                  firstName,
                  appointmentForOther: true,
                  isNewPatient: true,  // CRITICAL: Mark as new patient since we don't have their details
                  isReturning: false
                }
              });
            }
            console.log("[CAPTURE-OTHER-PERSON-NAME] Stored NEW PATIENT appointment for:", otherPersonName);
            console.log("[CAPTURE-OTHER-PERSON-NAME] ✅ Marked as NEW PATIENT (will use new patient appointment type)");
          } catch (err) {
            console.error("[CAPTURE-OTHER-PERSON-NAME] Error storing context:", err);
          }

          // Ask for email (optional for new patients booked by someone else)
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-other-person-email&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          const emailPrompts = [
            `Perfect! And do you have an email address for ${firstName}? You can spell it out, or just say 'no email' if you don't have it.`,
            `Great! What's ${firstName}'s email address? Or say 'skip' if you don't know it.`,
            `Lovely! Can you provide ${firstName}'s email? Just say 'none' if you don't have one.`
          ];
          const randomPrompt = emailPrompts[Math.floor(Math.random() * emailPrompts.length)];
          saySafeSSML(g, randomPrompt);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // No name captured - ask again
          console.log("[CAPTURE-OTHER-PERSON-NAME] No name captured, asking again");
          const g = vr.gather({
            input: ["speech"],
            timeout: 10,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=capture-other-person-name&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, "Sorry, I didn't catch that. Could you please spell out the full name for me?");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // ASK-OTHER-PERSON-EMAIL → Ask for email of person appointment is for
      if (route === "ask-other-person-email") {
        const emailRaw = speechRaw || "";
        const skipEmail = speechRaw.includes("no email") || speechRaw.includes("skip") ||
                          speechRaw.includes("none") || speechRaw.includes("don't have") ||
                          speechRaw.includes("don't know");

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
          console.error("[ASK-OTHER-PERSON-EMAIL] Error getting firstName:", err);
        }

        // Store email if provided (voice capture is unreliable, so we note it for verification)
        if (!skipEmail && emailRaw && emailRaw.length > 0) {
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, email: emailRaw }
              });
            }
            console.log("[ASK-OTHER-PERSON-EMAIL] Stored email (from voice, may need verification):", emailRaw);
          } catch (err) {
            console.error("[ASK-OTHER-PERSON-EMAIL] Failed to store email:", err);
          }
        } else {
          console.log("[ASK-OTHER-PERSON-EMAIL] No email provided or skipped");
        }

        // Ask for phone number confirmation
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=ask-other-person-phone&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        const phonePrompts = firstName ? [
          `Perfect! And what's the best phone number to reach ${firstName}?`,
          `Great! What phone number should we use for ${firstName}?`,
          `Lovely! Can you give me ${firstName}'s phone number?`
        ] : [
          "Perfect! And what's the best phone number to reach them?",
          "Great! What phone number should we use?"
        ];
        const randomPrompt = phonePrompts[Math.floor(Math.random() * phonePrompts.length)];
        saySafe(g, randomPrompt);
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // ASK-OTHER-PERSON-PHONE → Ask for phone number of person appointment is for
      if (route === "ask-other-person-phone") {
        const phoneRaw = speechRaw || "";

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
          console.error("[ASK-OTHER-PERSON-PHONE] Error getting firstName:", err);
        }

        // Store phone if provided
        if (phoneRaw && phoneRaw.length > 0) {
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, otherPersonPhone: phoneRaw }
              });
            }
            console.log("[ASK-OTHER-PERSON-PHONE] Stored phone (from voice):", phoneRaw);
          } catch (err) {
            console.error("[ASK-OTHER-PERSON-PHONE] Failed to store phone:", err);
          }
        }

        // Acknowledge and proceed to booking
        const acknowledgments = firstName ? [
          `Perfect! I'll book the appointment for ${firstName}.`,
          `Lovely! Booking this for ${firstName} now.`,
          `Great! Let's get ${firstName} booked in.`
        ] : [
          "Perfect! Let's book that appointment.",
          "Great! Let's get them booked in."
        ];
        const randomAck = acknowledgments[Math.floor(Math.random() * acknowledgments.length)];
        saySafe(vr, randomAck);
        vr.pause({ length: 0.5 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
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

        // Proceed to intent detection - just redirect without asking again
        // The start route will ask what they need
        const simpleGreetings = [
          `Thanks, ${firstName}!`,
          `Perfect, nice to meet you ${firstName}.`,
          `Great, thanks ${firstName}.`
        ];
        const randomGreeting = firstName
          ? simpleGreetings[Math.floor(Math.random() * simpleGreetings.length)]
          : "Thank you.";
        saySafe(vr, randomGreeting);
        vr.pause({ length: 0.5 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`));
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

        if (intent === "info") {
          // Asking about what happens in first visit
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=explain-new-patient-info&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        if (intent === "fees") {
          // Asking about cost/fees
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=explain-new-patient-fees&callSid=${encodeURIComponent(callSid)}`));
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
        // Check if we already know they're a returning patient (from phone recognition or previous booking)
        let alreadyIdentified = false;
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            // If they were confirmed as a returning patient earlier, skip this question
            if (context?.identityConfirmed || context?.isReturning) {
              alreadyIdentified = true;
            }
          }
        } catch (err) {
          console.error("[CHECK-BEEN-BEFORE] Error checking context:", err);
        }

        if (alreadyIdentified) {
          // Skip the question - we already know they're returning
          console.log("[CHECK-BEEN-BEFORE] Skipping - patient already identified as returning");
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=confirm-identity&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

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
          // New patient flow - collect name with warm, friendly prompt
          const g = vr.gather({
            input: ["speech"],
            timeout: 10,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-name-new&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          const namePrompts = [
            `Lovely! Because it's your first visit, I just need to get your name into the system properly. What's your full name?`,
            `Perfect! Since you're new, I'll need your full name for our records.`,
            `Great! I just need your full name for the booking.`
          ];
          const randomPrompt = namePrompts[Math.floor(Math.random() * namePrompts.length)];
          saySafeSSML(g, randomPrompt);
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

      // 3a) EXPLAIN-NEW-PATIENT-INFO → Explain what happens in a first visit
      if (route === "explain-new-patient-info") {
        const { getNewPatientInfoBlurb, splitBlurbIntoSaySegments } = await import("../utils/clinicInfo");

        const infoBlurb = getNewPatientInfoBlurb();
        const segments = splitBlurbIntoSaySegments(infoBlurb);

        // Warm intro
        saySafeSSML(vr, "Great question, good on you for asking — here's what you can expect on your first visit.");
        vr.pause({ length: 1 });

        // Say each segment
        for (const segment of segments) {
          saySafeSSML(vr, segment);
          vr.pause({ length: 1 });
        }

        // Offer to book
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=process-info-response&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        saySafeSSML(g, "If that sounds good, I can grab your details and find a time that suits you. Would you like to book your first visit now?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 3b) EXPLAIN-NEW-PATIENT-FEES → Explain fees and costs
      if (route === "explain-new-patient-fees") {
        const { getNewPatientFeesBlurb, splitBlurbIntoSaySegments } = await import("../utils/clinicInfo");

        const feesBlurb = getNewPatientFeesBlurb();
        const segments = splitBlurbIntoSaySegments(feesBlurb);

        // Warm intro
        saySafeSSML(vr, "No worries, I'll run you through the fees so there are no surprises.");
        vr.pause({ length: 1 });

        // Say each segment
        for (const segment of segments) {
          saySafeSSML(vr, segment);
          vr.pause({ length: 1 });
        }

        // Offer to book
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=process-info-response&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        saySafeSSML(g, "If that sounds good, I can grab your details and find a time that suits you. Would you like to book a visit?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 3c) PROCESS-INFO-RESPONSE → Handle response after explaining info/fees
      if (route === "process-info-response") {
        const wantsToBook = speechRaw.includes("yes") || speechRaw.includes("sure") || speechRaw.includes("okay") || speechRaw.includes("book");
        const doesntWantToBook = speechRaw.includes("no") || speechRaw.includes("not now");

        if (wantsToBook) {
          // Proceed to booking flow
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=check-been-before&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else if (doesntWantToBook) {
          // Thank them and hang up
          saySafeSSML(vr, "No worries! Feel free to give us a call anytime when you're ready. Have a great day!");
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        } else {
          // Unclear - ask again
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=process-info-response&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });
          saySafe(g, "Sorry, I didn't catch that. Would you like to book an appointment? Please say yes or no.");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 4) CONFIRM-IDENTITY → Ask returning patient to confirm their identity
      if (route === "confirm-identity") {
        let recognizedName: string | undefined;

        // First check if we already have their name from earlier identity confirmation
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            // If identity was already confirmed earlier, we have their name
            if (context?.identityConfirmed && context?.fullName) {
              recognizedName = context.fullName;
              console.log("[CONFIRM-IDENTITY] Using name from conversation context:", recognizedName);
            }
          }
        } catch (err) {
          console.error("[CONFIRM-IDENTITY] Error checking conversation context:", err);
        }

        // If not in context, check phone_map
        if (!recognizedName) {
          try {
            const phoneMapEntry = await storage.getPhoneMap(from);
            recognizedName = phoneMapEntry?.fullName || undefined;
          } catch (err) {
            console.error("[CONFIRM-IDENTITY] Error checking phone_map:", err);
          }
        }

        if (recognizedName) {
          // We already have their name - skip to booking
          console.log("[CONFIRM-IDENTITY] Name already confirmed, proceeding to booking for:", recognizedName);
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=1`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // No recognized name - ask for name
          const g = vr.gather({
            input: ["speech"],
            timeout: 10,
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

        // Move to email collection with SMS link option
        const g = vr.gather({
          input: ["speech"],
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=ask-email-new&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        // Warm prompts offering email spelling or SMS link option
        const emailPrompts = firstName ? [
          `Perfect ${firstName}! And for your file, what's the best email for you? If it's easier, I can text you a link and you can type it in - or you're welcome to spell it out now, whichever you prefer.`,
          `Lovely! What email should I use for your confirmation? You can spell it out, or I can text you a link to enter it if that's easier.`,
          `Great! I'll need an email address. Feel free to spell it slowly, or say 'text me' and I'll send you a link.`
        ] : [
          `And what's your email address? You can spell it out slowly, or I can text you a link to type it in - whichever works better.`
        ];
        const randomPrompt = emailPrompts[Math.floor(Math.random() * emailPrompts.length)];
        saySafeSSML(g, randomPrompt);
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
        // Add variety - sometimes use name with flavor, sometimes skip it
        const phonePrompts = [
          `Perfect, ${firstName}. Is the number you're calling from, ending in ${lastThreeDigits}, the best number to reach you?`,
          `Great. Is the number ending in ${lastThreeDigits} the best one to reach you on?`,
          `And just to confirm, is the number ending in ${lastThreeDigits} the best way to contact you?`
        ];
        const randomPhonePrompt = phonePrompts[Math.floor(Math.random() * phonePrompts.length)];
        const prompt = firstName
          ? randomPhonePrompt
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

        // If no reason yet, ASK the question first
        if (!reason || reason.length === 0) {
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-reason&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });

          // Warm, conversational prompts for reason
          const reasonPrompts = firstName ? [
            `Alright ${firstName}, what's brought you in today?`,
            `So ${firstName}, what can we help you with?`,
            `Okay ${firstName}, what's going on?`
          ] : [
            `And what brings you in today?`,
            `What can we help you with?`,
            `What's going on that you'd like us to look at?`
          ];
          const randomPrompt = reasonPrompts[Math.floor(Math.random() * reasonPrompts.length)];
          saySafe(g, randomPrompt);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        // Store reason in conversation context
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

        // Check if this is a new patient to decide whether to give proactive explanation
        let isNewPatient = false;
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            isNewPatient = context?.isNewPatient || false;
          }
        } catch (err) {
          console.error("[ASK-REASON] Error checking if new patient:", err);
        }

        if (isNewPatient) {
          // New patient - give proactive explanation before booking
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=explain-new-patient-visit-proactive&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else {
          // Returning patient - proceed to week selection with empathy
          const empathyLines = firstName ? [
            `${EMOTIONS.empathetic("Ahh sorry to hear that", "high")}, ${firstName}. That doesn't sound fun at all. Let me get you sorted - hang on a sec while I check what we've got.`,
            `${EMOTIONS.empathetic("Oh you poor thing", "high")}. We'll take care of you, ${firstName}. Let me see what's available to get you in soon.`,
            `${EMOTIONS.empathetic("That's not great", "high")}, ${firstName}. Don't worry, we'll look after you. Let me have a quick look at the schedule.`,
            `Ahh ${firstName}, that doesn't sound good at all. Let me find you something as soon as we can. Just bear with me a sec.`
          ] : [
            `${EMOTIONS.empathetic("Sorry to hear that", "high")}. That doesn't sound fun. Let me see what we have available to get you in quickly.`,
            `${EMOTIONS.empathetic("Ahh that's not great", "high")}. We'll take care of you. Hang on while I check the schedule.`
          ];
          const randomEmpathy = empathyLines[Math.floor(Math.random() * empathyLines.length)];
          saySafeSSML(vr, randomEmpathy);
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=1`));
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 5d) EXPLAIN-NEW-PATIENT-VISIT-PROACTIVE → Proactively explain first visit for new patients
      if (route === "explain-new-patient-visit-proactive") {
        const { getNewPatientInfoBlurb, splitBlurbIntoSaySegments } = await import("../utils/clinicInfo");

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
          console.error("[EXPLAIN-NEW-PATIENT-VISIT-PROACTIVE] Error getting firstName:", err);
        }

        const infoBlurb = getNewPatientInfoBlurb();
        const segments = splitBlurbIntoSaySegments(infoBlurb);

        // Warm intro - because it's their first visit
        const introLines = firstName ? [
          `${EMOTIONS.empathetic("Ahh sorry to hear that", "high")}, ${firstName}. That doesn't sound fun at all. Because it's your first visit, let me quickly tell you what to expect, so there are no surprises.`,
          `${EMOTIONS.empathetic("Oh you poor thing", "high")}. We'll take care of you, ${firstName}. Since you haven't been before, let me run you through what happens on your first visit.`,
          `${EMOTIONS.empathetic("That's not great", "high")}, ${firstName}. Before we book you in, let me just explain what to expect on your first visit.`
        ] : [
          `${EMOTIONS.empathetic("Sorry to hear that", "high")}. That doesn't sound fun. Because it's your first visit, let me quickly tell you what to expect.`,
          `${EMOTIONS.empathetic("Ahh that's not great", "high")}. Before we book you in, let me run you through what happens on your first visit.`
        ];
        const randomIntro = introLines[Math.floor(Math.random() * introLines.length)];
        saySafeSSML(vr, randomIntro);
        vr.pause({ length: 1 });

        // Say each segment of the info blurb
        for (const segment of segments) {
          saySafeSSML(vr, segment);
          vr.pause({ length: 1 });
        }

        // Transition to booking with empathy
        saySafeSSML(vr, "Alright, let me get you sorted - hang on a sec while I check what we've got.");
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
        // Warm Australian prompts for week selection - including "today" as an option
        const weekPrompts = firstName ? [
          `Alright ${firstName}, when would you like to come in? Today, this week, next week, or another time?`,
          `Okay ${firstName}, when works best for you? We might have something today, this week, next week, or later if you prefer.`,
          `So ${firstName}, when suits you? I can check today, this week, next week, or another time.`
        ] : [
          "When would you like to come in? Today, this week, next week, or another time?",
          "When works best for you? We might have spots today, this week, next week, or later."
        ];
        const randomPrompt = weekPrompts[Math.floor(Math.random() * weekPrompts.length)];
        saySafe(g, randomPrompt);
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 7) PROCESS-WEEK → Determine the week and check if day was mentioned
      if (route === "process-week") {
        const isReturningPatient = (req.query.returning as string) === '1';
        let weekOffset = 0; // 0 = this week, 1 = next week
        let specificWeek = "";

        // Check for "today" first (highest priority)
        if (speechRaw.includes("today") || speechRaw.includes("right now") || speechRaw.includes("immediately")) {
          weekOffset = 0;
          specificWeek = "today";
          // Store today as the specific day and skip day selection
          try {
            const call = await storage.getCallByCallSid(callSid);
            if (call?.conversationId) {
              const conversation = await storage.getConversation(call.conversationId);
              const existingContext = (conversation?.context as any) || {};
              const todayDayNumber = dayjs().tz().day(); // 0 = Sunday, 1 = Monday, etc.
              await storage.updateConversation(call.conversationId, {
                context: { ...existingContext, weekOffset: 0, specificWeek: "today", preferredDayOfWeek: todayDayNumber }
              });
            }
          } catch (err) {
            console.error("[PROCESS-WEEK] Error storing today preference:", err);
          }
          // Skip to time-of-day selection
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-time-of-day&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&weekOffset=0`));
          return res.type("text/xml").send(vr.toString());
        } else if (speechRaw.includes("this week") || speechRaw.includes("this") || speechRaw.includes("soon") || speechRaw.includes("asap")) {
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
        // Warm Australian prompts for day selection
        const dayPrompts = firstName ? [
          `Beautiful. And what day that week suits you best, ${firstName}? Monday, Wednesday, or something else?`,
          `Perfect. Which day works for you - Monday, Wednesday, Friday?`,
          `Lovely. And what day that week are you thinking?`
        ] : [
          "Beautiful. And what day that week works best for you? Monday, Wednesday, or another day?",
          "Perfect. Which day suits you? Monday, Wednesday, Friday, or another one?"
        ];
        const randomPrompt = dayPrompts[Math.floor(Math.random() * dayPrompts.length)];
        saySafe(g, randomPrompt);
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
        // Warm Australian time selection prompts
        const timePrompts = firstName ? [
          `Sweet. And do you prefer morning, midday, or afternoon, ${firstName}?`,
          `Perfect. What time of day works best - morning, midday, or afternoon?`,
          `Lovely. Are you thinking morning, midday, or afternoon?`,
          `Great. Morning, midday, or afternoon - which suits you better?`
        ] : [
          "And what time of day works best? Morning, midday, or afternoon?",
          "Do you prefer morning, midday, or afternoon?"
        ];
        const randomPrompt = timePrompts[Math.floor(Math.random() * timePrompts.length)];
        saySafe(g, randomPrompt);
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

        if (!patientId) {
          console.error("[RESCHEDULE-START] No patientId provided");
          saySafe(vr, "I'm having trouble finding your patient record. Would you like to book a new appointment instead?");
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=check-been-before&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        // Add thinking filler
        saySafeSSML(vr, `Just a moment ${EMOTIONS.shortPause()} while I bring up your appointment.`);

        // Look up their next appointment
        try {
          const appointment = await getNextUpcomingAppointment(patientId);
          if (!appointment) {
            console.log(`[RESCHEDULE-START] No upcoming appointments found for patient ${patientId}`);
            const g = vr.gather({
              input: ["speech"],
              timeout: 5,
              speechTimeout: "auto",
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=process-no-appointment&callSid=${encodeURIComponent(callSid)}&intent=reschedule`),
              method: "POST",
            });
            saySafe(g, "I don't see any upcoming appointments for you. Would you like to book a new one?");
            g.pause({ length: 1 });
            vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
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
          saySafeSSML(vr, `${EMOTIONS.disappointed("I apologize", "medium")}, I'm having trouble accessing your appointment. ${EMOTIONS.mediumPause()} Please call back or try again later.`);
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        }
      }

      // PROCESS-NO-APPOINTMENT → Handle response when no appointment is found
      if (route === "process-no-appointment") {
        const intent = (req.query.intent as string) || "";
        const wantsToBook = speechRaw.includes("yes") || speechRaw.includes("sure") || speechRaw.includes("yeah") || speechRaw.includes("book");
        const doesNotWant = speechRaw.includes("no") || speechRaw.includes("nah") || speechRaw.includes("not");

        if (wantsToBook) {
          // Redirect to booking flow
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=check-been-before&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        } else if (doesNotWant) {
          saySafe(vr, "No worries. Thanks for calling, have a great day!");
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        } else {
          // Unclear response - ask again
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=process-no-appointment&callSid=${encodeURIComponent(callSid)}&intent=${encodeURIComponent(intent)}`),
            method: "POST",
          });
          saySafe(g, "Sorry, I didn't catch that. Would you like to book a new appointment? Please say yes or no.");
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
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

        if (!patientId) {
          console.error("[CANCEL-START] No patientId provided");
          saySafe(vr, "I'm having trouble finding your patient record. Can I help you with anything else?");
          vr.hangup();
          return res.type("text/xml").send(vr.toString());
        }

        // Add thinking filler
        saySafeSSML(vr, `Just a moment ${EMOTIONS.shortPause()} while I bring up your appointment.`);

        try {
          const appointment = await getNextUpcomingAppointment(patientId);
          if (!appointment) {
            console.log(`[CANCEL-START] No upcoming appointments found for patient ${patientId}`);
            const g = vr.gather({
              input: ["speech"],
              timeout: 5,
              speechTimeout: "auto",
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=process-no-appointment&callSid=${encodeURIComponent(callSid)}&intent=cancel`),
              method: "POST",
            });
            saySafe(g, "I don't see any upcoming appointments to cancel. Would you like to book a new appointment instead?");
            g.pause({ length: 1 });
            vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
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
          saySafeSSML(vr, `${EMOTIONS.disappointed("I apologize", "medium")}, I'm having trouble accessing your appointment. ${EMOTIONS.mediumPause()} Please call back or try again later.`);
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
            saySafeSSML(g, `No problem, I understand. ${EMOTIONS.shortPause()} Your appointment has been cancelled. ${EMOTIONS.mediumPause()} Would you like to book a new one so you don't fall behind on your care?`);
            g.pause({ length: 1 });
            vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
            return res.type("text/xml").send(vr.toString());
          } catch (err) {
            console.error("[CANCEL-CONFIRM] Error cancelling:", err);
            saySafeSSML(vr, `${EMOTIONS.disappointed("I'm sorry", "medium")}, I couldn't cancel your appointment. ${EMOTIONS.mediumPause()} Please call back or try our office directly.`);
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
        let specificWeek: string | undefined;

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
            if (context?.preferredDayOfWeek !== undefined) {
              preferredDayOfWeek = context.preferredDayOfWeek;
            }
            if (context?.specificWeek) {
              specificWeek = context.specificWeek;
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

        // Special handling for "today" - use current date directly
        if (specificWeek === "today") {
          fromDate = tzNow.format("YYYY-MM-DD");
          toDate = fromDate;
          console.log("[GET-AVAILABILITY] Today requested, using:", fromDate);
        } else if (preferredDayOfWeek !== undefined && typeof preferredDayOfWeek === 'number') {
          // If they specified a day NUMBER (0-6), find that specific day in the target week
          const targetDayNumber = preferredDayOfWeek;

          // For weekOffset = 0 (this week), check if the requested day is today or in the future
          if (weekOffset === 0 && targetDayNumber === tzNow.day()) {
            // They want today specifically
            fromDate = tzNow.format("YYYY-MM-DD");
            toDate = fromDate;
            console.log("[GET-AVAILABILITY] Today (via day number) requested, using:", fromDate);
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
            console.log("[GET-AVAILABILITY] Targeting specific day number:", targetDayNumber, "on", fromDate);
          }
        } else if (preferredDayOfWeek && typeof preferredDayOfWeek === 'string') {
          // If they specified a day NAME (string), find that specific day in the target week
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
        saySafeSSML(vr, `Thanks for waiting... Let me just pull up the schedule.`);

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

          saySafeSSML(vr, `${EMOTIONS.disappointed("I apologize", "high")}, I'm having trouble accessing the schedule right now. ${EMOTIONS.mediumPause()} Please try calling back in a few minutes and we'll help you book your appointment. ${EMOTIONS.shortPause()} Thank you for calling.`);
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
          let noAvailMessage = `${EMOTIONS.disappointed("I apologize", "medium")}, `;
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

        // Get firstName for personalized slot offering
        let firstName = "";
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            firstName = context?.firstName || "";
          }
        } catch (err) {
          console.error("[GET-AVAILABILITY] Error getting firstName:", err);
        }

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

        // Build warm Australian prompts with firstName
        let prompt: string;
        if (preferredDayOfWeek && s2) {
          const prompts = firstName ? [
            `Alright ${firstName}, I've got two good options for you on ${preferredDayOfWeek}. Option one is ${opt1}, or option two is ${opt2}. Just say option one or option two, or press 1 or 2.`,
            `Great news ${firstName}! I've found two spots on ${preferredDayOfWeek}. Option one, ${opt1}. Or option two, ${opt2}. Which one suits you?`
          ] : [
            `Great! I have two options for ${preferredDayOfWeek}. Option one is ${opt1}, or option two is ${opt2}. Say option one or option two, or press 1 or 2.`
          ];
          prompt = prompts[Math.floor(Math.random() * prompts.length)];
        } else if (preferredDayOfWeek && !s2) {
          const prompts = firstName ? [
            `Perfect ${firstName}! I've got one spot on ${preferredDayOfWeek} at ${opt1}. Press 1 or say yes to book it.`,
            `Great news! I have ${opt1} available on ${preferredDayOfWeek}. Does that work for you, ${firstName}?`
          ] : [
            `Perfect! I have one option on ${preferredDayOfWeek}: ${opt1}. Press 1 or say yes to book it.`
          ];
          prompt = prompts[Math.floor(Math.random() * prompts.length)];
        } else if (s2) {
          const prompts = firstName ? [
            `Alright ${firstName}, I've got two good options. Option one is ${opt1}, or option two is ${opt2}. Which one works better?`,
            `Great! I found two spots for you. Option one, ${opt1}. Or option two, ${opt2}. Just say which one you'd like.`
          ] : [
            `Great! I have two options. Option one is ${opt1}, or option two is ${opt2}. Say option one or option two, or press 1 or 2.`
          ];
          prompt = prompts[Math.floor(Math.random() * prompts.length)];
        } else {
          const prompts = firstName ? [
            `Perfect! I've got ${opt1} available. Does that work for you, ${firstName}?`,
            `Great news! I have one spot at ${opt1}. Shall I book that for you?`
          ] : [
            `Perfect! I have one option: ${opt1}. Press 1 or say yes to book it.`
          ];
          prompt = prompts[Math.floor(Math.random() * prompts.length)];
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

        console.log("[BOOK-CHOOSE] 📋 Appointment Type ID:", appointmentTypeId);
        console.log("[BOOK-CHOOSE] 🔍 Checking appointment type:");
        console.log("[BOOK-CHOOSE]   - NEW_PATIENT type:", env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID);
        console.log("[BOOK-CHOOSE]   - STANDARD type:", env.CLINIKO_APPT_TYPE_ID);
        console.log("[BOOK-CHOOSE]   - Using:", appointmentTypeId === env.CLINIKO_NEW_PATIENT_APPT_TYPE_ID ? "NEW PATIENT ✅" : "STANDARD");

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

        // Handle rejection - ask for alternative with warm Australian tone
        if (interpretation.choice === "reject") {
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=ask-week&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}`),
            method: "POST",
          });
          const rejectionPrompts = firstName ? [
            `No stress at all, ${firstName}. Which day works better for you?`,
            `No worries! What other day suits you, ${firstName}?`,
            `That's okay! Let me find something else for you. Which day would you prefer?`
          ] : [
            "No stress at all. Which day works better for you?",
            "No worries! What other day suits you?"
          ];
          const randomPrompt = rejectionPrompts[Math.floor(Math.random() * rejectionPrompts.length)];
          saySafe(g, randomPrompt);
          g.pause({ length: 1 });
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        // Handle alternative day request with warm Australian tone
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

          // Ask for time preference for the new day with conversational filler
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=get-availability-specific-day&callSid=${encodeURIComponent(callSid)}&returning=${isReturningPatient ? '1' : '0'}&day=${encodeURIComponent(requestedDay)}`),
            method: "POST",
          });
          const altDayPrompts = [
            `No worries at all! Let me have a quick look at ${requestedDay}. Do you prefer morning or afternoon?`,
            `Sure thing! Let me check ${requestedDay} for you. Morning or afternoon?`,
            `Alrighty, let me see what we've got for ${requestedDay}. Morning or afternoon work better?`
          ];
          const randomPrompt = altDayPrompts[Math.floor(Math.random() * altDayPrompts.length)];
          saySafe(g, randomPrompt);
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
            const retryPrompts = [
              `Sorry, I didn't quite catch that. If you'd like one of those times, just say option one or option two. Or tell me a different day that works better.`,
              `Ahh sorry, I missed that. You can say option one, option two, or let me know another day that suits you better.`,
              `I think the line's a bit dodgy - didn't quite get that. Say option one, option two, or tell me which other day works for you.`
            ];
            const randomRetry = retryPrompts[Math.floor(Math.random() * retryPrompts.length)];
            saySafe(g, randomRetry);
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
          saySafeSSML(vr, `${EMOTIONS.disappointed("I'm sorry", "low")}, that option is no longer available. ${EMOTIONS.mediumPause()} Let's start again.`);
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
        let appointmentForOther = false;
        let otherPersonPhone = "";

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

            // Check if booking for someone else
            if (context?.appointmentForOther) {
              appointmentForOther = true;
              otherPersonPhone = context?.otherPersonPhone || "";
              console.log("[BOOK-CHOOSE] 📞 Appointment is for someone else:", fullName);
              console.log("[BOOK-CHOOSE]   - Their phone:", otherPersonPhone || "not provided");
            }

            // Check if this is a reschedule operation
            if (context?.isReschedule) {
              isReschedule = true;
              apptId = context.apptId;
              patientId = context.patientId || patientId;
            }
            console.log("[BOOK-CHOOSE] Final identity:", { fullName, email, isReschedule, apptId, reasonForVisit, phoneConfirmed, needsDifferentPhone, appointmentForOther });
          }
        } catch (err) {
          console.error("[BOOK-CHOOSE] Failed to retrieve identity:", err);
        }

        // CRITICAL: Warn if fullName is missing for new patients
        if (!fullName && !isReturningPatient) {
          console.error("[BOOK-CHOOSE] WARNING: fullName is missing for new patient! This should have been captured in the new patient flow.");
          console.error("[BOOK-CHOOSE] Patient will be created in Cliniko with default name. Phone:", from);
          // Create an alert for the reception team
          try {
            const tenant = await storage.getTenant("default");
            const call = await storage.getCallByCallSid(callSid);
            if (tenant && call) {
              await storage.createAlert({
                tenantId: tenant.id,
                conversationId: call.conversationId || undefined,
                reason: "missing_patient_name",
                payload: {
                  message: "Patient name was not captured during booking",
                  fromNumber: from,
                  callSid: callSid,
                  timestamp: new Date().toISOString()
                },
                status: "open"
              });
            }
          } catch (alertErr) {
            console.error("[BOOK-CHOOSE] Failed to create alert for missing name:", alertErr);
          }
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

            // Ask if they need anything else and WAIT for response
            const g = vr.gather({
              input: ["speech"],
              timeout: 5,
              speechTimeout: "auto",
              actionOnEmptyResult: true,
              action: abs(`/api/voice/handle?route=anything-else&callSid=${encodeURIComponent(callSid)}`),
              method: "POST",
            });

            // Warm, reassuring confirmation messages
            const confirmationMessages = firstName ? [
              `${EMOTIONS.excited("Beautiful", "medium")}, you're all set ${firstName}! You're booked for ${spokenTime} with Dr. Michael. We'll send a confirmation to your mobile ending in ${lastFourDigits}. Is there anything else I can help you with?`,
              `${EMOTIONS.excited("Perfect", "medium")}! You're all booked, ${firstName} - ${spokenTime} with Dr. Michael. We'll text you a confirmation. Anything else I can help with today?`,
              `${EMOTIONS.excited("Lovely", "medium")}! All sorted ${firstName}. You're seeing Dr. Michael at ${spokenTime}. We'll send you a confirmation text. Is there anything else you need?`
            ] : [
              `${EMOTIONS.excited("Perfect", "medium")}! You're all booked for ${spokenTime} with Dr. Michael. We'll send a confirmation to your mobile ending in ${lastFourDigits}. Anything else I can help with?`
            ];
            const randomConfirmation = confirmationMessages[Math.floor(Math.random() * confirmationMessages.length)];
            saySafeSSML(g, randomConfirmation);
            g.pause({ length: 1 });

            // If no response, warm farewell
            const farewellMessages = [
              "Lovely! We're looking forward to seeing you. Take care!",
              "Beautiful! See you at your appointment. Bye for now!",
              "Perfect! If anything changes, just give us a buzz. See you soon!"
            ];
            const randomFarewell = farewellMessages[Math.floor(Math.random() * farewellMessages.length)];
            saySafe(vr, randomFarewell);
            vr.hangup();
            return res.type("text/xml").send(vr.toString());
          } else {
            // CREATE NEW appointment
            // Include reason for visit in notes if available
            let appointmentNotes = isReturningPatient
              ? `Follow-up appointment booked via voice call at ${new Date().toISOString()}`
              : `New patient appointment booked via voice call at ${new Date().toISOString()}`;

            // Add special note if booking for someone else
            if (appointmentForOther) {
              appointmentNotes += `\n\n📞 BOOKED BY ANOTHER PERSON`;
              appointmentNotes += `\n   - Caller booked this appointment on behalf of: ${fullName || 'patient'}`;
              appointmentNotes += `\n   - Caller's phone: ${from}`;
              if (otherPersonPhone) {
                appointmentNotes += `\n   - Patient's phone: ${otherPersonPhone}`;
              }
            }

            if (reasonForVisit) {
              appointmentNotes += `\n\nReason for visit: ${reasonForVisit}`;
            }

            // Add contact info notes
            if (needsDifferentPhone) {
              appointmentNotes += `\n\n⚠️ Patient indicated they need a different contact number. Please follow up to confirm contact details.`;
            } else if (phoneConfirmed && !appointmentForOther) {
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

          // Ask if they need anything else and WAIT for response
          const g = vr.gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=anything-else&callSid=${encodeURIComponent(callSid)}`),
            method: "POST",
          });

          // Warm, reassuring confirmation messages
          const confirmationMessages = firstName ? [
            `${EMOTIONS.excited("Beautiful", "medium")}, you're all set ${firstName}! You're booked for ${spokenTime} with Dr. Michael. We'll send a confirmation to your mobile ending in ${lastFourDigits}. Is there anything else I can help you with?`,
            `${EMOTIONS.excited("Perfect", "medium")}! You're all booked, ${firstName} - ${spokenTime} with Dr. Michael. We'll text you a confirmation. Anything else I can help with today?`,
            `${EMOTIONS.excited("Lovely", "medium")}! All sorted ${firstName}. You're seeing Dr. Michael at ${spokenTime}. We'll send you a confirmation text. Is there anything else you need?`
          ] : [
            `${EMOTIONS.excited("Wonderful", "medium")}! You're all set for ${spokenTime} with Dr. Michael. We'll send a confirmation to your mobile ending in ${lastFourDigits}. Anything else I can help with?`
          ];
          const randomConfirmation = confirmationMessages[Math.floor(Math.random() * confirmationMessages.length)];
          saySafeSSML(g, randomConfirmation);
          g.pause({ length: 1 });

          // If no response, warm farewell
          const farewellMessages = [
            "Lovely! We're looking forward to seeing you. Take care!",
            "Beautiful! See you at your appointment. Bye for now!",
            "Perfect! If anything changes, just give us a buzz. See you soon!"
          ];
          const randomFarewell = farewellMessages[Math.floor(Math.random() * farewellMessages.length)];
          saySafe(vr, randomFarewell);
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
          saySafeSSML(vr, `${EMOTIONS.disappointed("I'm very sorry", "high")}, I couldn't complete the booking. ${EMOTIONS.mediumPause()} Please try again later or call our office directly.`);
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
          saySafeSSML(vr, `${EMOTIONS.disappointed("I apologize", "high")}, I'm having trouble accessing the schedule right now. ${EMOTIONS.mediumPause()} Please try calling back in a few minutes and we'll help you book your appointment. ${EMOTIONS.shortPause()} Thank you for calling.`);
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
