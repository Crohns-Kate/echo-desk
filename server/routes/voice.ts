import { Express, Request, Response } from "express";
import twilio from "twilio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { getAvailability, createAppointmentForPatient } from "../services/cliniko";
import { saySafe } from "../utils/voice-constants";
// import { abs } from "../utils/url"; // ← not needed; we’ll use relative URLs

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Australia/Brisbane");

function rel(path: string) {
  // Ensure we always have a leading slash and only relative paths (Twilio accepts this)
  return path.startsWith("/") ? path : `/${path}`;
}

export function registerVoice(app: Express) {
  // ───────────────────────────────────────────────
  // Entry point for each call
  app.post("/api/voice/incoming", (req: Request, res: Response) => {
    const callSid =
      (req.body?.CallSid as string) ||
      (req.query?.callSid as string) ||
      "";

    const vr = new twilio.twiml.VoiceResponse();
    const handleUrl = rel(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`);
    const timeoutUrl = rel(`/api/voice/handle?route=timeout&callSid=${encodeURIComponent(callSid)}`);

    const g = vr.gather({
      input: ["speech"],
      language: "en-AU",
      timeout: 5,
      speechTimeout: "auto",
      actionOnEmptyResult: true,
      action: handleUrl,
      method: "POST",
    });

    g.say({ voice: "Polly.Olivia-Neural" }, "Hello and welcome to your clinic. How can I help you today?");
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
          language: "en-AU",
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: rel(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`),
          method: "POST",
        });
        g.say({ voice: "Polly.Olivia-Neural" }, "Sorry, I didn’t catch that. Please say book, reschedule, or cancel.");
        return res.type("text/xml").send(vr.toString());
      }

      // 1) START → ask to book
      if (route === "start") {
        const g = vr.gather({
          input: ["speech"],
          language: "en-AU",
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: rel(`/api/voice/handle?route=book-day&callSid=${encodeURIComponent(callSid)}`),
        });
        g.say({ voice: "Polly.Olivia-Neural" }, "System ready. Would you like to book an appointment?");
        return res.type("text/xml").send(vr.toString());
      }

      // 2) BOOK-DAY → confirm intent then ask which day
      if (route === "book-day") {
        if (!(speechRaw.includes("yes") || speechRaw.includes("book") || speechRaw.includes("appointment"))) {
          saySafe(vr, "Okay, goodbye.");
          return res.type("text/xml").send(vr.toString());
        }
        const g = vr.gather({
          input: ["speech"],
          language: "en-AU",
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: rel(`/api/voice/handle?route=book-part&callSid=${encodeURIComponent(callSid)}`),
        });
        g.say({ voice: "Polly.Olivia-Neural" }, "Which day suits you best?");
        return res.type("text/xml").send(vr.toString());
      }

      // 3) BOOK-PART → fetch next available 1–2 slots; encode them in the next URL (no storage)
      if (route === "book-part") {
        try {
          const tzNow = dayjs().tz();
          let fromDate = tzNow.format("YYYY-MM-DD");
          let toDate = tzNow.add(7, "day").format("YYYY-MM-DD");

          const weekdays = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
          const saidWeekdayIdx = weekdays.findIndex(w => speechRaw.includes(w));
          if (saidWeekdayIdx >= 0) {
            // Next occurrence of that weekday (including today)
            let d = tzNow;
            for (let i = 0; i < 7 && d.day() !== saidWeekdayIdx; i++) d = d.add(1, "day");
            fromDate = d.format("YYYY-MM-DD");
            toDate = d.format("YYYY-MM-DD");
          }

          console.log("[BOOK][LOOKUP]", { fromDate, toDate });

          let slots: any[] = [];
          try {
            const resAvail = await getAvailability(fromDate, toDate, "any");
            // Normalize to an array of { startIso || start }
            if (Array.isArray(resAvail)) {
              slots = resAvail;
            } else if (resAvail && Array.isArray((resAvail as any).data)) {
              slots = (resAvail as any).data;
            } else {
              slots = [];
            }
          } catch (e) {
            console.error("[BOOK-PART][getAvailability ERROR]", e);
            saySafe(vr, "Sorry, I couldn’t load available times. Please try again later.");
            return res.type("text/xml").send(vr.toString());
          }

          const available = slots.slice(0, 2).filter(s => s && (s.startIso || s.start));
          if (available.length === 0) {
            saySafe(vr, "Sorry, there are no times available for that day.");
            return res.type("text/xml").send(vr.toString());
          }

          const s1 = available[0].startIso || available[0].start;
          const s2 = available[1]?.startIso || available[1]?.start || "";

          const opt1 = dayjs(s1).tz().isValid()
            ? dayjs(s1).tz().format("h:mm A dddd D MMMM")
            : "the first option";
          const opt2 = s2 && dayjs(s2).tz().isValid()
            ? dayjs(s2).tz().format("h:mm A dddd D MMMM")
            : "";

          const nextUrl = rel(
            `/api/voice/handle?route=book-choose&callSid=${encodeURIComponent(callSid)}&s1=${encodeURIComponent(String(s1))}${s2 ? `&s2=${encodeURIComponent(String(s2))}` : ""}`
          );

          const g = vr.gather({
            input: ["speech", "dtmf"],
            language: "en-AU",
            timeout: 5,
            actionOnEmptyResult: true,
            action: nextUrl,
          });

          g.say(
            { voice: "Polly.Olivia-Neural" },
            s2
              ? `I have two options. Option one, ${opt1}. Or option two, ${opt2}. Press 1 or 2, or say your choice.`
              : `I have one option available: ${opt1}. Press 1 or say yes to book it.`
          );

          return res.type("text/xml").send(vr.toString());
        } catch (e: any) {
          console.error("[BOOK-PART][UNCAUGHT]", e?.stack || e);
          saySafe(vr, "Sorry, an error occurred while finding times. Please try again.");
          return res.type("text/xml").send(vr.toString());
        }
      }

      // 4) BOOK-CHOOSE → pick s1/s2 from query string and book
      if (route === "book-choose") {
        try {
          const s1 = (req.query.s1 as string) || "";
          const s2 = (req.query.s2 as string) || "";
          const choiceIdx = (digits === "2" || speechRaw.includes("two")) && s2 ? 1 : 0;
          const chosen = choiceIdx === 1 ? s2 : s1;

          if (!chosen) {
            console.warn("[BOOK-CHOOSE] Missing chosen slot", { s1, s2, digits, speechRaw });
            saySafe(vr, "Sorry, that option is no longer available. Let's start again.");
            vr.redirect({ method: "POST" }, rel(`/api/voice/handle?route=start`));
            return res.type("text/xml").send(vr.toString());
          }

          try {
            await createAppointmentForPatient(from, chosen);
          } catch (e) {
            console.error("[BOOK-CHOOSE][createAppointmentForPatient ERROR]", e);
            saySafe(vr, "Sorry, I couldn’t complete the booking. Please try again later.");
            return res.type("text/xml").send(vr.toString());
          }

          const spokenTime = dayjs(chosen).tz().isValid()
            ? dayjs(chosen).tz().format("h:mm A dddd D MMMM")
            : "the selected time";
          saySafe(vr, `All set. Your appointment is confirmed for ${spokenTime}. Goodbye.`);
          return res.type("text/xml").send(vr.toString());
        } catch (e: any) {
          console.error("[BOOK-CHOOSE][UNCAUGHT]", e?.stack || e);
          saySafe(vr, "Sorry, an error occurred while booking. Please try again.");
          return res.type("text/xml").send(vr.toString());
        }
      }

      // Fallback
      saySafe(vr, "Sorry, I didn't understand that. Let's start again.");
      vr.redirect({ method: "POST" }, rel(`/api/voice/handle?route=start`));
      return res.type("text/xml").send(vr.toString());
    } catch (err: any) {
      console.error("[VOICE][ERROR]", err?.stack || err);
      const fallback = new twilio.twiml.VoiceResponse();
      saySafe(fallback, "Sorry, an error occurred. Please try again later.");
      return res.type("text/xml").send(fallback.toString());
    }
  });
}
