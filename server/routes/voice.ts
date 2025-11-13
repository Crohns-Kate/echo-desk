import { Express, Request, Response } from "express";
import twilio from "twilio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { getAvailability, createAppointmentForPatient } from "../services/cliniko";
import { saySafe, VOICE_NAME } from "../utils/voice-constants";
import { abs } from "../utils/url";
import { labelForSpeech, AUST_TZ } from "../time";
import { storage } from "../storage";
import { sendAppointmentConfirmation } from "../services/sms";
import { emitCallStarted, emitCallUpdated, emitAlertCreated } from "../services/websocket";
import { classifyIntent } from "../services/intent";

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

    // ✅ Safe say - Ultra-simplified text to diagnose 13520 error
    saySafe(g, "Hello. How can I help you today?");
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

      // 1) START → ask to book
      if (route === "start") {
        const g = vr.gather({
          input: ["speech"],
          // NOTE: language removed - Polly voices have built-in language
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=book-day&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        // ✅ Safe say
        saySafe(g, "System ready. Would you like to book an appointment?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 2) BOOK-DAY → confirm intent then ask for name
      if (route === "book-day") {
        if (!(speechRaw.includes("yes") || speechRaw.includes("book") || speechRaw.includes("appointment"))) {
          saySafe(vr, "Okay, goodbye.");
          return res.type("text/xml").send(vr.toString());
        }

        const g = vr.gather({
          input: ["speech"],
          // NOTE: language removed - Polly voices have built-in language
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=ask-name&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        // ✅ Safe say
        saySafe(g, "Great! May I have your full name please?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 3) ASK-NAME → capture name and ask for email
      if (route === "ask-name") {
        const name = speechRaw || "";

        // Store name in conversation context
        if (name && name.length > 0) {
          try {
            const conversation = await storage.getCallByCallSid(callSid);
            if (conversation?.conversationId) {
              await storage.updateConversation(conversation.conversationId, {
                context: { fullName: name }
              });
            }
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
          action: abs(`/api/voice/handle?route=ask-email&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        // ✅ Safe say
        if (name && name.length > 0) {
          saySafe(g, "Thank you. And what is your email address?");
        } else {
          saySafe(g, "I didn't quite catch that. What is your email address?");
        }
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=ask-day&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 4) ASK-EMAIL → capture email and ask which day
      if (route === "ask-email") {
        const email = speechRaw || "";

        // Store email in conversation context
        if (email && email.length > 0) {
          try {
            const conversation = await storage.getCallByCallSid(callSid);
            if (conversation?.conversationId) {
              const existingContext = await storage.getConversation(conversation.conversationId);
              const context = { ...(existingContext?.context || {}), email };
              await storage.updateConversation(conversation.conversationId, { context });
            }
          } catch (err) {
            console.error("[ASK-EMAIL] Failed to store email:", err);
          }
        }

        const g = vr.gather({
          input: ["speech"],
          // NOTE: language removed - Polly voices have built-in language
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=ask-day&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        // ✅ Safe say
        saySafe(g, "Perfect. Which day suits you best?");
        g.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`));
        return res.type("text/xml").send(vr.toString());
      }

      // 5) ASK-DAY / BOOK-PART → fetch next available 1–2 slots
      if (route === "ask-day" || route === "book-part") {
        const tzNow = dayjs().tz();
        let fromDate = tzNow.format("YYYY-MM-DD");
        let toDate = tzNow.add(7, "day").format("YYYY-MM-DD");

        const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        const saidWeekdayIdx = weekdays.findIndex((w) => speechRaw.includes(w));
        if (saidWeekdayIdx >= 0) {
          let d = tzNow;
          for (let i = 0; i < 7 && d.day() !== saidWeekdayIdx; i++) d = d.add(1, "day");
          fromDate = d.format("YYYY-MM-DD");
          toDate = d.format("YYYY-MM-DD");
        }

        console.log("[BOOK][LOOKUP]", { fromDate, toDate });

        let slots: Array<{ startISO: string; endISO?: string; label?: string }> = [];
        try {
          const result = await getAvailability({ fromISO: fromDate, toISO: toDate });
          slots = result.slots || [];
        } catch (e: any) {
          console.error("[BOOK-PART][getAvailability ERROR]", e);
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
                payload: { fromDate, toDate, callSid, from },
              });
              emitAlertCreated(alert);
            }
          } catch (alertErr) {
            console.error("[ALERT ERROR]", alertErr);
          }
          saySafe(vr, "Sorry, there are no times available for that day. Would you like to try a different day?");
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=book-day&callSid=${encodeURIComponent(callSid)}`));
          return res.type("text/xml").send(vr.toString());
        }

        const s1 = available[0].startISO;
        const s2 = available[1]?.startISO;
        const opt1 = labelForSpeech(s1, AUST_TZ);
        const opt2 = s2 ? labelForSpeech(s2, AUST_TZ) : "";

        const nextUrl = abs(
          `/api/voice/handle?route=book-choose&callSid=${encodeURIComponent(callSid)}&s1=${encodeURIComponent(s1)}${
            s2 ? `&s2=${encodeURIComponent(s2)}` : ""
          }`
        );
        const timeoutUrl = abs(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`);

        const g = vr.gather({
          input: ["speech", "dtmf"],
          // NOTE: language removed - Polly voices have built-in language
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: nextUrl,
          method: "POST",
        });

        // ✅ Safe say
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

      // 6) BOOK-CHOOSE → pick slot & book with captured identity
      if (route === "book-choose") {
        const s1 = (req.query.s1 as string) || "";
        const s2 = (req.query.s2 as string) || "";
        const choiceIdx = (digits === "2" || speechRaw.includes("two")) && s2 ? 1 : 0;
        const chosen = choiceIdx === 1 ? s2 : s1;

        if (!chosen) {
          saySafe(vr, "Sorry, that option is no longer available. Let's start again.");
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=start`));
          return res.type("text/xml").send(vr.toString());
        }

        // Retrieve captured identity from conversation context
        let fullName: string | undefined;
        let email: string | undefined;
        try {
          const call = await storage.getCallByCallSid(callSid);
          if (call?.conversationId) {
            const conversation = await storage.getConversation(call.conversationId);
            const context = conversation?.context as any;
            fullName = context?.fullName;
            email = context?.email;
            console.log("[BOOK-CHOOSE] Retrieved identity:", { fullName, email });
          }
        } catch (err) {
          console.error("[BOOK-CHOOSE] Failed to retrieve identity:", err);
        }

        try {
          const { env } = await import("../utils/env");

          // Create appointment with captured identity
          await createAppointmentForPatient(from, {
            startsAt: chosen,
            practitionerId: env.CLINIKO_PRACTITIONER_ID,
            appointmentTypeId: env.CLINIKO_APPT_TYPE_ID,
            notes: `Booked via voice call at ${new Date().toISOString()}`,
            fullName,
            email,
          });

          // Store identity in phone_map for future use
          if (fullName || email) {
            try {
              await storage.upsertPhoneMap({
                phone: from,
                fullName,
                email,
              });
              console.log("[BOOK-CHOOSE] Stored identity in phone_map:", { phone: from, fullName, email });
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
