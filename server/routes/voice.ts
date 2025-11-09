import { Express, Request, Response } from "express";
import twilio from "twilio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { storage } from "../storage";
import { getAvailability, createAppointmentForPatient } from "../services/cliniko";
import { saySafe } from "../utils/voice-constants";
import { abs } from "../utils/url";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Australia/Brisbane");

export function registerVoice(app: Express) {
  app.post("/api/voice/handle", async (req: Request, res: Response) => {
    const vr = new twilio.twiml.VoiceResponse();

    try {
      const callSid = (req.query.callSid as string) || (req.body?.CallSid as string) || "";
      const route = (req.query.route as string) || "start";
      const speechRaw = ((req.body?.SpeechResult as string) || "").trim().toLowerCase();
      const digits = (req.body?.Digits as string) || "";
      const from = (req.body?.From as string) || "";

      console.log("[VOICE][HANDLE IN]", { route, callSid, speechRaw, digits, from });

      // ───────────────────────────────────────────────────────────
      // 1) START
      if (route === "start") {
        const g = vr.gather({
          input: ["speech"],
          language: "en-AU",
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=book-day&callSid=${encodeURIComponent(callSid)}`),
        });
        g.say({ voice: "Polly.Olivia-Neural" }, "System ready. Would you like to book an appointment?");
        return res.type("text/xml").send(vr.toString());
      }

      // ───────────────────────────────────────────────────────────
      // 2) BOOK-DAY
      if (route === "book-day") {
        if (!(speechRaw.includes("yes") || speechRaw.includes("book"))) {
          saySafe(vr, "Okay, goodbye.");
          return res.type("text/xml").send(vr.toString());
        }

        const g = vr.gather({
          input: ["speech"],
          language: "en-AU",
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=book-part&callSid=${encodeURIComponent(callSid)}`),
        });
        g.say({ voice: "Polly.Olivia-Neural" }, "Which day suits you best?");
        return res.type("text/xml").send(vr.toString());
      }

      // ───────────────────────────────────────────────────────────
      // 3) BOOK-PART  (offer 1–2 slots)
      if (route === "book-part") {
        const slots = (await getAvailability()) || [];
        const available = slots.slice(0, 2);

        if (available.length === 0) {
          saySafe(vr, "Sorry, there are no times available in the next few days.");
          return res.type("text/xml").send(vr.toString());
        }

        const opt1 = dayjs(available[0].startIso).tz().format("h:mm A dddd D MMMM");
        const opt2 = available[1] ? dayjs(available[1].startIso).tz().format("h:mm A dddd D MMMM") : "";

        const g = vr.gather({
          input: ["speech", "dtmf"],
          language: "en-AU",
          timeout: 5,
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=book-choose&callSid=${encodeURIComponent(callSid)}`),
        });

        g.say(
          { voice: "Polly.Olivia-Neural" },
          available[1]
            ? `I have two options. Option one, ${opt1}. Or option two, ${opt2}. Press 1 or 2, or say your choice.`
            : `I have one option available: ${opt1}. Press 1 or say yes to book it.`
        );

        await storage.set(`call:${callSid}:slots`, available);
        return res.type("text/xml").send(vr.toString());
      }

      // ───────────────────────────────────────────────────────────
      // 4) BOOK-CHOOSE (confirm and create)
      if (route === "book-choose") {
        const slots: Array<{ startIso: string }> = (await storage.get(`call:${callSid}:slots`)) || [];
        const choiceIdx = digits === "2" || speechRaw.includes("two") ? 1 : 0;
        const slot = slots[choiceIdx];

        if (!slot) {
          saySafe(vr, "Sorry, that time is no longer available. Let's start again.");
          vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=start`));
          return res.type("text/xml").send(vr.toString());
        }

        await createAppointmentForPatient(from, slot.startIso);
        const spokenTime = dayjs(slot.startIso).tz().format("h:mm A dddd D MMMM");
        saySafe(vr, `All set. Your appointment is confirmed for ${spokenTime}. Goodbye.`);
        return res.type("text/xml").send(vr.toString());
      }

      // ───────────────────────────────────────────────────────────
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
