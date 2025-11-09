import { Express, Request, Response } from "express";
import twilio from "twilio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { storage } from "../storage";
import {
  getAvailability,
  findPatientByPhoneRobust,
  getNextUpcomingAppointment,
  rescheduleAppointment,
  createAppointmentForPatient,
} from "../services/cliniko";
import { saySafe } from "../utils/voice-constants";
import { abs } from "../utils/url";

// --- Setup ---
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Australia/Brisbane");

export function registerVoice(app: Express) {
  //
  // ─────────────── INCOMING CALL ───────────────
  //
  app.post(
    "/api/voice/incoming",
    twilio.webhook({ validate: true, protocol: "https" }),
    async (req: Request, res: Response) => {
      try {
        const vr = new twilio.twiml.VoiceResponse();
        vr.gather({
          input: "speech",
          language: "en-AU",
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=start&callSid=${req.body.CallSid}`),
          method: "POST",
        }).say(
          { voice: "Polly.Olivia-Neural" },
          "Hello and welcome to your clinic. How can I help you today?"
        );
        vr.pause({ length: 1 });
        vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=timeout&callSid=${req.body.CallSid}`));
        res.type("text/xml").send(vr.toString());
      } catch (err) {
        console.error("[VOICE][ERROR incoming]", err);
        const vr = new twilio.twiml.VoiceResponse();
        vr.say("Sorry, there was a problem starting the call. Please try again later.");
        res.type("text/xml").send(vr.toString());
      }
    }
  );

  //
  // ─────────────── HANDLE CALL ───────────────
  //
  app.post(
    "/api/voice/handle",
    twilio.webhook({ validate: true, protocol: "https" }),
    async (req: Request, res: Response) => {
      const vr = new twilio.twiml.VoiceResponse();
      try {
        const callSid = req.query.callSid || req.body.CallSid;
        const route = req.query.route || "start";
        const speechRaw = (req.body?.SpeechResult || req.query?.SpeechResult || "")
          .trim()
          .toLowerCase();
        const digits = req.body?.Digits || "";
        const from = req.body?.From || "";
        const to = req.body?.To || "";

        console.log("[VOICE][HANDLE IN]", { route, callSid, speechRaw, digits, from, to });

        // --- Press 9 → Reschedule shortcut ---
        if (route === "start" && (digits || "").trim() === "9") {
          const redirectUrl = abs(
            `/api/voice/handle?route=reschedule-lookup&callSid=${encodeURIComponent(String(callSid || ""))}`
          );
          const vr9 = new twilio.twiml.VoiceResponse();
          vr9.redirect({ method: "POST" }, redirectUrl);
          return res.type("text/xml").send(vr9.toString());
        }

        const tenant = await storage.getTenant("default");
        if (!tenant) throw new Error("No tenant configured");

        // Temporary placeholder to confirm system works
        vr.say({ voice: "Polly.Olivia-Neural" }, "System ready. You can now book or reschedule.");
        res.type("text/xml").send(vr.toString());
      } catch (err) {
        console.error("[VOICE][ERROR handle]", err);
        vr.say("Sorry, something went wrong. Please try again later.");
        res.type("text/xml").send(vr.toString());
      }
    }
  );

  //
  // ─────────────── RECORDING CALLBACK ───────────────
  //
  app.post(
    "/api/voice/recording",
    twilio.webhook({ validate: true, protocol: "https" }),
    async (req: Request, res: Response) => {
      try {
        console.log("[RECORDING]", {
          CallSid: req.body.CallSid,
          RecordingSid: req.body.RecordingSid,
          RecordingUrl: req.body.RecordingUrl,
          RecordingDuration: req.body.RecordingDuration,
        });
        res.sendStatus(204);
      } catch (err) {
        console.error("[VOICE][ERROR recording]", err);
        res.sendStatus(204);
      }
    }
  );
}
