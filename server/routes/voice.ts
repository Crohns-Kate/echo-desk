// server/routes/voice.ts
import { Express, Request, Response } from "express";
import twilio from "twilio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

import {
  getAvailability,
  findPatientByPhoneRobust,
  getNextUpcomingAppointment,
  rescheduleAppointment,
  createAppointmentForPatient,
} from "../services/cliniko";

import { saySafe } from "../utils/voice-constants";
import { abs } from "../utils/url";

// Important: use Twilio’s webhook middleware to avoid "stream is not readable"
const twilioWebhook = twilio.webhook({ validate: true, protocol: "https" });

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Australia/Brisbane");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map “monday/tuesday/…” (or “today/tomorrow”) to a single-day range */
function resolveSpokenDayToRange(speechRaw: string) {
  const s = (speechRaw || "").toLowerCase().trim();

  const tzNow = dayjs().tz();
  const weekdayIndex: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  if (s.includes("today")) {
    const d = tzNow.format("YYYY-MM-DD");
    return { from: d, to: d };
  }
  if (s.includes("tomorrow")) {
    const d = tzNow.add(1, "day").format("YYYY-MM-DD");
    return { from: d, to: d };
  }

  for (const name of Object.keys(weekdayIndex)) {
    if (s.includes(name)) {
      const targetDow = weekdayIndex[name];
      const diff =
        (targetDow - tzNow.day() + 7) % 7 || 7; // always next occurrence
      const d = tzNow.add(diff, "day").format("YYYY-MM-DD");
      return { from: d, to: d };
    }
  }

  // default: next business day
  const d = tzNow.add(1, "day").format("YYYY-MM-DD");
  return { from: d, to: d };
}

/** True if caller said option two */
function choseSecondOption(digits: string, speechRaw: string) {
  const s = (speechRaw || "").toLowerCase();
  return digits === "2" || /(^|\b)(two|2|second|option two)(\b|$)/.test(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main router
// ─────────────────────────────────────────────────────────────────────────────

export function registerVoice(app: Express) {
  app.post("/api/voice/handle", twilioWebhook, async (req: Request, res: Response) => {
    const vr = new twilio.twiml.VoiceResponse();

    try {
      const callSid = String(req.query.callSid || req.body.CallSid || "");
      const route = String(req.query.route || "start");
      const speechRaw = String(
        (req.body?.SpeechResult ?? req.query?.SpeechResult ?? "")
      ).trim().toLowerCase();
      const digits = String(req.body?.Digits ?? "");
      const from = String(req.body?.From ?? "");
      // const to = String(req.body?.To ?? ""); // not used

      console.log("[VOICE][HANDLE IN]", { route, callSid, speechRaw, digits, from });

      // ───────────────────────────────────────────────────────────────────────
      // ROUTES
      // ───────────────────────────────────────────────────────────────────────
      switch (route) {
        // ───────────────────────────────────────────────────────────────────
        // Entry: light intent detection → book / reschedule / cancel
        // ───────────────────────────────────────────────────────────────────
        case "start": {
          if (speechRaw.includes("reschedule") || speechRaw.includes("change")) {
            vr.redirect(
              { method: "POST" },
              abs(`/api/voice/handle?route=reschedule-lookup&callSid=${encodeURIComponent(callSid)}`)
            );
            break;
          }

          if (speechRaw.includes("cancel")) {
            // You can wire a cancel flow later if desired
            saySafe(vr, "Okay. I can help with booking or rescheduling.");
            vr.redirect(
              { method: "POST" },
              abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`)
            );
            break;
          }

          const g = vr.gather({
            input: ["speech"],
            language: "en-AU",
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=book-day&callSid=${encodeURIComponent(callSid)}`),
          });
          g.say({ voice: "Polly.Olivia-Neural" }, "System ready. Would you like to book an appointment?");
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // BOOK: ask which day
        // ───────────────────────────────────────────────────────────────────
        case "book-day": {
          const g = vr.gather({
            input: ["speech"],
            language: "en-AU",
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(`/api/voice/handle?route=book-part&callSid=${encodeURIComponent(callSid)}`),
          });
          g.say({ voice: "Polly.Olivia-Neural" }, "Which day suits you best?");
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // BOOK: present two times for that day, carry them to next step via URL
        // ───────────────────────────────────────────────────────────────────
        case "book-part": {
          const { from: fromDate, to: toDate } = resolveSpokenDayToRange(speechRaw);
          console.log("[BOOK][LOOKUP]", { fromDate, toDate });

          // Ask Cliniko for times on that exact day
          const slots = await getAvailability(fromDate, toDate, "any");
          const availableSlots = (slots || []).slice(0, 2);

          if (availableSlots.length === 0) {
            saySafe(vr, "Sorry, no times available that day.");
            break;
          }

          const s1ISO = availableSlots[0].startIso || availableSlots[0].start || availableSlots[0];
          const s2ISO = availableSlots[1]?.startIso || availableSlots[1]?.start || availableSlots[1];

          const option1 = dayjs(s1ISO).tz().format("h:mm A dddd D MMMM");
          const option2 = s2ISO ? dayjs(s2ISO).tz().format("h:mm A dddd D MMMM") : "";

          const s1 = encodeURIComponent(String(s1ISO));
          const s2 = s2ISO ? encodeURIComponent(String(s2ISO)) : "";

          const g = vr.gather({
            input: ["speech", "dtmf"],
            language: "en-AU",
            timeout: 5,
            actionOnEmptyResult: true,
            action: abs(
              `/api/voice/handle?route=book-choose&callSid=${encodeURIComponent(
                callSid
              )}&s1=${s1}&s2=${s2}`
            ),
          });

          g.say(
            { voice: "Polly.Olivia-Neural" },
            s2ISO
              ? `I have two options. Option one, ${option1}. Or option two, ${option2}. Press 1 or 2, or say your choice.`
              : `I have one option available: ${option1}. Press 1 or say yes to book it.`
          );
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // BOOK: user chooses; we have s1/s2 on the query; book in Cliniko
        // ───────────────────────────────────────────────────────────────────
        case "book-choose": {
          const s1 = req.query.s1 ? decodeURIComponent(String(req.query.s1)) : null;
          const s2 = req.query.s2 ? decodeURIComponent(String(req.query.s2)) : null;
          const useSecond = choseSecondOption(digits, speechRaw);
          const slotISO = useSecond && s2 ? s2 : s1;

          if (!slotISO) {
            saySafe(vr, "Sorry, that option isn’t available. Let’s start again.");
            vr.redirect({ method: "POST" }, abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`));
            break;
          }

          console.log("[BOOK-CHOOSE] Attempting to book slot:", slotISO);

          try {
            await createAppointmentForPatient(from, slotISO);
            saySafe(
              vr,
              `All set. Your booking is confirmed for ${dayjs(slotISO).tz().format(
                "h:mm a dddd D MMMM"
              )}. We'll send a confirmation shortly.`
            );
          } catch (err) {
            console.error("[BOOK-CHOOSE][ERROR]", err);
            saySafe(vr, "Sorry, I couldn't complete the booking. Please try again later.");
          }
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // RESCHEDULE: locate upcoming appt for caller
        // ───────────────────────────────────────────────────────────────────
        case "reschedule-lookup": {
          try {
            // Find patient & next appointment
            const patient = await findPatientByPhoneRobust(from);
            const appt = patient
              ? await getNextUpcomingAppointment(patient.id)
              : null;

            if (!appt) {
              saySafe(vr, "I couldn’t find an existing appointment under this number.");
              break;
            }

            // carry appointment id to next step via query
            saySafe(
              vr,
              `I found your appointment on ${dayjs(appt.start_time).tz().format("dddd D MMMM at h:mm a")}.`
            );
            vr.redirect(
              { method: "POST" },
              abs(
                `/api/voice/handle?route=reschedule-day&callSid=${encodeURIComponent(
                  callSid
                )}&aid=${encodeURIComponent(String(appt.id))}`
              )
            );
          } catch (e) {
            console.error("[RESCHEDULE][LOOKUP][ERROR]", e);
            saySafe(vr, "Sorry, I couldn’t access your appointment details.");
          }
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // RESCHEDULE: ask which new day
        // ───────────────────────────────────────────────────────────────────
        case "reschedule-day": {
          const aid = String(req.query.aid || "");
          const g = vr.gather({
            input: ["speech"],
            language: "en-AU",
            timeout: 5,
            actionOnEmptyResult: true,
            action: abs(
              `/api/voice/handle?route=reschedule-part&callSid=${encodeURIComponent(
                callSid
              )}&aid=${encodeURIComponent(aid)}`
            ),
          });
          g.say({ voice: "Polly.Olivia-Neural" }, "Which new day would you prefer?");
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // RESCHEDULE: present two new times for that day
        // ───────────────────────────────────────────────────────────────────
        case "reschedule-part": {
          const aid = String(req.query.aid || "");
          const { from: fromDate, to: toDate } = resolveSpokenDayToRange(speechRaw);

          const slots = await getAvailability(fromDate, toDate, "any");
          const availableSlots = (slots || []).slice(0, 2);

          if (!aid || availableSlots.length === 0) {
            saySafe(vr, "Sorry, I couldn’t find new times for that day.");
            break;
          }

          const s1ISO = availableSlots[0].startIso || availableSlots[0].start || availableSlots[0];
          const s2ISO = availableSlots[1]?.startIso || availableSlots[1]?.start || availableSlots[1];

          const option1 = dayjs(s1ISO).tz().format("h:mm a dddd D MMMM");
          const option2 = s2ISO ? dayjs(s2ISO).tz().format("h:mm a dddd D MMMM") : "";

          const s1 = encodeURIComponent(String(s1ISO));
          const s2 = s2ISO ? encodeURIComponent(String(s2ISO)) : "";

          const g = vr.gather({
            input: ["speech", "dtmf"],
            language: "en-AU",
            timeout: 5,
            actionOnEmptyResult: true,
            action: abs(
              `/api/voice/handle?route=reschedule-choose&callSid=${encodeURIComponent(
                callSid
              )}&aid=${encodeURIComponent(aid)}&s1=${s1}&s2=${s2}`
            ),
          });

          g.say(
            { voice: "Polly.Olivia-Neural" },
            s2ISO
              ? `I found two options. Option one, ${option1}. Option two, ${option2}. Press 1 or 2, or say your choice.`
              : `I found one option: ${option1}. Press 1 or say yes to move it.`
          );
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // RESCHEDULE: user chooses; we have appt id + s1/s2 on query
        // ───────────────────────────────────────────────────────────────────
        case "reschedule-choose": {
          const aid = String(req.query.aid || "");
          const s1 = req.query.s1 ? decodeURIComponent(String(req.query.s1)) : null;
          const s2 = req.query.s2 ? decodeURIComponent(String(req.query.s2)) : null;
          const useSecond = choseSecondOption(digits, speechRaw);
          const slotISO = useSecond && s2 ? s2 : s1;

          if (!aid || !slotISO) {
            saySafe(vr, "Sorry, I couldn’t reschedule that appointment.");
            break;
          }

          try {
            await rescheduleAppointment(aid, slotISO);
            saySafe(
              vr,
              `Your appointment has been moved to ${dayjs(slotISO).tz().format(
                "h:mm a dddd D MMMM"
              )}.`
            );
          } catch (err) {
            console.error("[RESCHEDULE][CHOOSE][ERROR]", err);
            saySafe(vr, "Sorry, I couldn’t complete the reschedule.");
          }
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        default: {
          saySafe(vr, "I’m not sure what you meant. Let’s start again.");
          vr.redirect(
            { method: "POST" },
            abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`)
          );
          break;
        }
      }

      res.type("text/xml").send(vr.toString());
    } catch (err: any) {
      console.error("[VOICE][ERROR]", err?.stack || err);
      const fallback = new twilio.twiml.VoiceResponse();
      saySafe(fallback, "Sorry, an error occurred. Please try again later.");
      res.type("text/xml").send(fallback.toString());
    }
  });
}
