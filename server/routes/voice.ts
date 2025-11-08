import { Express, Request, Response } from "express";
import twilio from "twilio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { storage } from "../storage";
import { getAvailability, findPatientByPhoneRobust, getNextUpcomingAppointment, rescheduleAppointment, createAppointmentForPatient } from "../services/cliniko";
import { saySafe } from "../utils/voice-constants";
import { abs } from "../utils/url";
import { validateTwilioSignature } from "../middlewares/twilioAuth";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Australia/Brisbane");

export function registerVoice(app: Express) {
  app.post("/api/voice/handle", validateTwilioSignature, async (req: Request, res: Response) => {
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

    console.log("[VOICE][HANDLE IN]", {
      route,
      callSid,
      speechRaw,
      digits,
      from,
      to,
    });

    const tenant = await storage.getTenant("default");
    if (!tenant) throw new Error("No tenant configured");

    // === ROUTE LOGIC ===
    switch (route) {
      // ───────────────────────────────
      case "start": {
        // Detect intent
        if (speechRaw.includes("book") || speechRaw.includes("appointment")) {
          vr.redirect(
            { method: "POST" },
            abs(`/api/voice/handle?route=book-day&callSid=${callSid}`),
          );
          break;
        }
        if (speechRaw.includes("reschedule") || speechRaw.includes("change")) {
          vr.redirect(
            { method: "POST" },
            abs(`/api/voice/handle?route=reschedule-lookup&callSid=${callSid}`),
          );
          break;
        }
        if (speechRaw.includes("cancel")) {
          vr.redirect(
            { method: "POST" },
            abs(`/api/voice/handle?route=cancel-lookup&callSid=${callSid}`),
          );
          break;
        }

        const g = vr.gather({
          input: ['speech'],
          language: "en-AU",
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=start&callSid=${callSid}`),
        });
        g.say(
          { voice: "Polly.Olivia-Neural" },
          "Sorry, I didn't catch that. Please say book, reschedule, or cancel.",
        );
        break;
      }

      // ───────────────────────────────
      case "book-day": {
        const g = vr.gather({
          input: ['speech'],
          language: "en-AU",
          timeout: 5,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=book-part&callSid=${callSid}`),
        });
        g.say({ voice: "Polly.Olivia-Neural" }, "Which day suits you?");
        break;
      }

      // ───────────────────────────────
      case "book-part": {
        // Simplified: get availability for next 7 days
        const fromDate = dayjs().tz().format("YYYY-MM-DD");
        const toDate = dayjs().tz().add(7, "days").format("YYYY-MM-DD");

        console.log("[BOOK][LOOKUP]", { fromDate, toDate });

        const slots = await getAvailability();
        const availableSlots = slots?.slice(0, 2) || [];

        if (availableSlots.length === 0) {
          vr.say(
            { voice: "Polly.Olivia-Neural" },
            "Sorry, no times available in the next week.",
          );
          break;
        }

        const option1 = dayjs(availableSlots[0].startIso).tz().format("h:mm A dddd D MMMM");
        const option2 = availableSlots[1] ? dayjs(availableSlots[1].startIso).tz().format("h:mm A dddd D MMMM") : "";

        const g = vr.gather({
          input: ['speech', 'dtmf'],
          language: "en-AU",
          timeout: 5,
          actionOnEmptyResult: true,
          action: abs(`/api/voice/handle?route=book-choose&callSid=${callSid}`),
        });

        g.say(
          { voice: "Polly.Olivia-Neural" },
          availableSlots[1] 
            ? `I have two options. Option one, ${option1}. Or option two, ${option2}. Press 1 or 2, or say your choice.`
            : `I have one option available: ${option1}. Press 1 or say yes to book it.`,
        );

        // Store slots in conversation context would go here (simplified for now)
        break;
      }

      // ───────────────────────────────
      case "book-choose": {
        // Simplified: would fetch from conversation context in full implementation
        const slots: any[] = [];
        const choice = digits === "2" || speechRaw.includes("two") ? 1 : 0;
        const slot = slots[choice];
        if (!slot) {
          vr.say(
            { voice: "Polly.Olivia-Neural" },
            "Sorry, that option isn’t available. Let’s start again.",
          );
          vr.redirect(
            { method: "POST" },
            abs(`/api/voice/handle?route=start&callSid=${callSid}`),
          );
          break;
        }

        console.log("[REVALIDATE] Checking slot", slot.start);
        const stillAvailable = await cliniko.validateSlot(slot.start);
        if (!stillAvailable) {
          vr.say(
            { voice: "Polly.Olivia-Neural" },
            "Sorry, that slot was just taken. Let’s try again.",
          );
          vr.redirect(
            { method: "POST" },
            abs(`/api/voice/handle?route=start&callSid=${callSid}`),
          );
          break;
        }

        const booking = await cliniko.book(slot.start, from);
        console.log("[BOOKED]", booking.id);

        vr.say(
          { voice: "Polly.Olivia-Neural" },
          `All set. Your booking is confirmed for ${dayjs(slot.start).tz().format("h:mm a dddd D MMMM")}. We’ll send a confirmation by message. Goodbye.`,
        );
        break;
      }

      // ───────────────────────────────
      case "reschedule-lookup": {
        console.log("[RESCH][LOOKUP] Starting...");
        const appointment = await cliniko.findUpcomingAppointmentByPhone(from);
        if (!appointment) {
          vr.say(
            { voice: "Polly.Olivia-Neural" },
            "I couldn’t find an existing appointment under this number.",
          );
          break;
        }

        // Would store in conversation context in full implementation
        vr.say(
          { voice: "Polly.Olivia-Neural" },
          `I found your appointment on ${dayjs(appointment.start).tz().format("dddd D MMMM at h:mm a")}.`,
        );
        vr.redirect(
          { method: "POST" },
          abs(`/api/voice/handle?route=reschedule-day&callSid=${callSid}`),
        );
        break;
      }

      // ───────────────────────────────
      case "reschedule-day": {
        const g = vr.gather({
          input: ["speech"],
          language: "en-AU",
          timeout: 5,
          actionOnEmptyResult: true,
          action: abs(
            `/api/voice/handle?route=reschedule-part&callSid=${callSid}`,
          ),
        });
        g.say(
          { voice: "Polly.Olivia-Neural" },
          "Which new day would you prefer?",
        );
        break;
      }

      // ───────────────────────────────
      case "reschedule-part": {
        const weekday = resolveWeekdayToClinikoRange(speechRaw);
        const fromDate = weekday.from;
        const toDate = weekday.to;
        const appt = await storage.get(`call:${callSid}:appointment`);

        const availability = await cliniko.getAvailability(
          fromDate,
          toDate,
          "any",
        );
        const slots = availability?.slice(0, 2) || [];

        if (!appt || slots.length === 0) {
          vr.say(
            { voice: "Polly.Olivia-Neural" },
            "Sorry, I couldn’t find new times for that day.",
          );
          break;
        }

        const option1 = dayjs(slots[0].start).tz().format("h:mm a dddd D MMMM");
        const option2 = dayjs(slots[1].start).tz().format("h:mm a dddd D MMMM");

        await storage.set(`call:${callSid}:rescheduleSlots`, slots);

        const g = vr.gather({
          input: ["speech", "dtmf"],
          language: "en-AU",
          timeout: 5,
          actionOnEmptyResult: true,
          action: abs(
            `/api/voice/handle?route=reschedule-choose&callSid=${callSid}`,
          ),
        });

        g.say(
          { voice: "Polly.Olivia-Neural" },
          `I found two options. Option one, ${option1}. Option two, ${option2}. Press 1 or 2, or say your choice.`,
        );
        break;
      }

      // ───────────────────────────────
      case "reschedule-choose": {
        const slots =
          (await storage.get(`call:${callSid}:rescheduleSlots`)) || [];
        const appt = await storage.get(`call:${callSid}:appointment`);
        const choice = digits === "2" || speechRaw.includes("two") ? 1 : 0;
        const slot = slots[choice];

        if (!slot || !appt) {
          vr.say(
            { voice: "Polly.Olivia-Neural" },
            "Sorry, I couldn’t reschedule that appointment.",
          );
          break;
        }

        const updated = await cliniko.reschedule(appt.id, slot.start);
        console.log("[RESCHEDULED]", updated.id);

        vr.say(
          { voice: "Polly.Olivia-Neural" },
          `Your appointment has been moved to ${dayjs(slot.start).tz().format("h:mm a dddd D MMMM")}. Goodbye.`,
        );
        break;
      }

      // ───────────────────────────────
      default: {
        vr.say(
          { voice: "Polly.Olivia-Neural" },
          "I’m not sure what you meant. Let’s start again.",
        );
        vr.redirect(
          { method: "POST" },
          abs(`/api/voice/handle?route=start&callSid=${callSid}`),
        );
        break;
      }
    }

    res.type("text/xml");
    res.send(vr.toString());
  } catch (err: any) {
    console.error("[VOICE][ERROR]", err.stack || err);
    const fallback = new twilio.twiml.VoiceResponse();
    saySafe(fallback, "Sorry, an error occurred. Please try again later.");
    res.type("text/xml");
    res.send(fallback.toString());
  }
  });
}
