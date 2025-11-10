// server/routes/voice.ts
import { Express, Request, Response } from "express";
import twilio from "twilio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

import {
  getAvailability,
  findPatientByPhoneRobust,
  getPatientAppointments,
  rescheduleAppointment,
  cancelAppointment,
  createAppointmentForPatient,
} from "../services/cliniko";

import { saySafe } from "../utils/voice-constants";
import { abs } from "../utils/url";

// ─────────────────────────────────────────────────────────────────────────────
// Twilio webhook middleware
// - Do NOT force protocol/host; it can break signature checks behind proxies.
// - You can temporarily disable validation with DISABLE_TWILIO_VALIDATION=true
//   while testing webhooks from non-Twilio origins.
// ─────────────────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== "production";
const skipValidation =
  isDev || process.env.DISABLE_TWILIO_VALIDATION === "true";
const twilioWebhook = twilio.webhook({ validate: !skipValidation });

dayjs.extend(utc);
dayjs.extend(timezone);
const TZ = "Australia/Brisbane";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map “monday/tuesday/…” (or “today/tomorrow”) to a single-day range in clinic TZ */
function nextWeekdayFromSpeech(
  speechRaw: string
): { day: string; fromIso: string; toIso: string } {
  const map: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    today: -1,
    tomorrow: -2,
  };
  const words = (speechRaw || "").toLowerCase();
  let targetDow: number | null = null;

  if (words.includes("today")) targetDow = -1;
  else if (words.includes("tomorrow")) targetDow = -2;
  else {
    for (const k of Object.keys(map)) {
      if (k === "today" || k === "tomorrow") continue;
      if (words.includes(k)) {
        targetDow = map[k];
        break;
      }
    }
  }

  let base = dayjs().tz(TZ);
  if (targetDow === -1) {
    // today
  } else if (targetDow === -2) {
    base = base.add(1, "day");
  } else if (targetDow !== null) {
    const todayDow = base.day(); // 0..6
    let delta = targetDow - todayDow;
    if (delta < 0) delta += 7;
    base = base.add(delta, "day");
  }

  const fromIso = base.startOf("day").tz(TZ).toDate().toISOString();
  const toIso = base.endOf("day").tz(TZ).toDate().toISOString();
  return { day: base.format("dddd D MMMM"), fromIso, toIso };
}

/** True if caller clearly chose the second option */
function choseSecondOption(digits: string, speechRaw: string) {
  const s = (speechRaw || "").toLowerCase().trim();
  return (
    digits === "2" ||
    /\b(two|2|second|option\s*two)\b/.test(s)
  );
}

/** True if caller affirmed “yes/ok/one” in a single-option flow */
function saidYesOrFirst(digits: string, speechRaw: string) {
  const s = (speechRaw || "").toLowerCase().trim();
  return (
    digits === "1" ||
    /\b(yes|yeah|yep|sure|ok|okay|one|1|option\s*one|first)\b/.test(s)
  );
}

/** Simple intent parsing for start step */
function intentFromSpeech(speechRaw: string): "reschedule" | "cancel" | "book" {
  const s = (speechRaw || "").toLowerCase();
  if (/\b(resched|re[-\s]?schedule|change|move|shift)\b/.test(s)) return "reschedule";
  if (/\b(cancel|delete|remove)\b/.test(s)) return "cancel";
  return "book";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main router
// ─────────────────────────────────────────────────────────────────────────────

export function registerVoice(app: Express) {
  // NOTE: Ideally, in server/index.ts you should register these routes
  // BEFORE attaching any global body parsers to avoid raw-body conflicts.

  // Core voice state machine
  app.post("/api/voice/handle", twilioWebhook, async (req: Request, res: Response) => {
    const vr = new twilio.twiml.VoiceResponse();

    try {
      const callSid = String(req.query.callSid || req.body.CallSid || "");
      const route = String(req.query.route || "start");
      const speechRaw = String(
        (req.body?.SpeechResult ?? req.query?.SpeechResult ?? "")
      )
        .trim()
        .toLowerCase();
      const digits = String(req.body?.Digits ?? "").trim();
      const from = String(req.body?.From ?? "").trim();

      console.log("[VOICE][HANDLE IN]", { route, callSid, speechRaw, digits, from });

      switch (route) {
        // ───────────────────────────────────────────────────────────────────
        // Entry: intent → book / reschedule / cancel
        // ───────────────────────────────────────────────────────────────────
        case "start": {
          const intent = intentFromSpeech(speechRaw);

          if (intent === "reschedule") {
            vr.redirect(
              { method: "POST" },
              abs(`/api/voice/handle?route=res-list&callSid=${encodeURIComponent(callSid)}`)
            );
            break;
          }

          if (intent === "cancel") {
            vr.redirect(
              { method: "POST" },
              abs(`/api/voice/handle?route=cancel-list&callSid=${encodeURIComponent(callSid)}`)
            );
            break;
          }

          // Default to booking prompt
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
        // BOOK: present two times for that day, carry via query
        // ───────────────────────────────────────────────────────────────────
        case "book-part": {
          const { day, fromIso, toIso } = nextWeekdayFromSpeech(speechRaw || "");
          console.log("[BOOK][LOOKUP]", { fromIso, toIso, day });

          const slots = await getAvailability({ fromIso, toIso, part: "any" });
          const availableSlots = (slots || []).slice(0, 2);

          if (availableSlots.length === 0) {
            saySafe(vr, "Sorry, no times available that day.");
            break;
          }

          const s1ISO = availableSlots[0].startIso;
          const s2ISO = availableSlots[1]?.startIso;

          const option1 = dayjs(s1ISO).tz(TZ).format("h:mm A dddd D MMMM");
          const option2 = s2ISO ? dayjs(s2ISO).tz(TZ).format("h:mm A dddd D MMMM") : "";

          const s1 = encodeURIComponent(String(s1ISO));
          const s2 = s2ISO ? encodeURIComponent(String(s2ISO)) : "";

          const g = vr.gather({
            input: ["speech", "dtmf"],
            language: "en-AU",
            timeout: 5,
            actionOnEmptyResult: true,
            action: abs(
              `/api/voice/handle?route=book-choose&callSid=${encodeURIComponent(callSid)}&s1=${s1}&s2=${s2}`
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
        // BOOK: user chooses; book in Cliniko
        // ───────────────────────────────────────────────────────────────────
        case "book-choose": {
          const s1 = req.query.s1 ? decodeURIComponent(String(req.query.s1)) : null;
          const s2 = req.query.s2 ? decodeURIComponent(String(req.query.s2)) : null;

          let slotISO: string | null = null;
          if (s2) {
            slotISO = choseSecondOption(digits, speechRaw) ? s2 : s1;
          } else {
            slotISO = saidYesOrFirst(digits, speechRaw) ? (s1 as string) : s1; // default to s1 if unclear
          }

          if (!slotISO) {
            saySafe(vr, "Sorry, that option isn’t available. Let’s start again.");
            vr.redirect(
              { method: "POST" },
              abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`)
            );
            break;
          }

          console.log("[BOOK-CHOOSE] Attempting to book slot:", slotISO);

          const start = new Date(slotISO);
          if (isNaN(start.getTime())) {
            console.error("[BOOK-CHOOSE] Invalid slot time:", slotISO);
            saySafe(vr, "Sorry, there was an error with that time slot. Please try again.");
            vr.redirect(
              { method: "POST" },
              abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`)
            );
            break;
          }

          const startIso = start.toISOString();

          const CLINIKO_BUSINESS_ID = process.env.CLINIKO_BUSINESS_ID || "";
          const CLINIKO_PRACTITIONER_ID = process.env.CLINIKO_PRACTITIONER_ID || "";
          const CLINIKO_APPOINTMENT_TYPE_ID = process.env.CLINIKO_APPT_TYPE_ID || "";

          if (!CLINIKO_BUSINESS_ID || !CLINIKO_PRACTITIONER_ID || !CLINIKO_APPOINTMENT_TYPE_ID) {
            console.error("[BOOK-CHOOSE] Missing Cliniko IDs in env", {
              CLINIKO_BUSINESS_ID,
              CLINIKO_PRACTITIONER_ID,
              CLINIKO_APPOINTMENT_TYPE_ID,
            });
            saySafe(vr, "Sorry, booking is not available right now.");
            break;
          }

          try {
            await createAppointmentForPatient(from, {
              practitionerId: CLINIKO_PRACTITIONER_ID,
              appointmentTypeId: CLINIKO_APPOINTMENT_TYPE_ID,
              startsAt: startIso,
              businessId: CLINIKO_BUSINESS_ID,
            });
            saySafe(
              vr,
              `All set. Your booking is confirmed for ${dayjs(startIso)
                .tz(TZ)
                .format("h:mm A dddd D MMMM")}. We'll send a confirmation shortly.`
            );
          } catch (err) {
            console.error("[BOOK-CHOOSE][ERROR]", err);
            saySafe(vr, "Sorry, I couldn't complete the booking. Please try again later.");
          }
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // RESCHEDULE: list up to 2 upcoming appointments
        // ───────────────────────────────────────────────────────────────────
        case "res-list": {
          try {
            const appts = await getPatientAppointments(from);

            if (!appts || appts.length === 0) {
              saySafe(vr, "I couldn't find any upcoming bookings on your number.");
              vr.redirect(
                { method: "POST" },
                abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`)
              );
              break;
            }

            const [a1, a2] = appts.slice(0, 2);
            const g = vr.gather({
              input: ["speech", "dtmf"],
              language: "en-AU",
              timeout: 5,
              actionOnEmptyResult: true,
              action:
                abs(
                  `/api/voice/handle?route=res-pick-day&callSid=${encodeURIComponent(callSid)}`
                ) +
                `&aid1=${encodeURIComponent(a1.id)}` +
                (a2 ? `&aid2=${encodeURIComponent(a2.id)}` : ""),
            });

            if (a2) {
              g.say(
                { voice: "Polly.Olivia-Neural" },
                `You have two bookings. Option one, ${dayjs(a1.starts_at)
                  .tz(TZ)
                  .format("h:mm A dddd D MMMM")}. Option two, ${dayjs(a2.starts_at)
                  .tz(TZ)
                  .format("h:mm A dddd D MMMM")}. Press 1 or 2, or say your choice.`
              );
            } else {
              g.say(
                { voice: "Polly.Olivia-Neural" },
                `Your upcoming booking is ${dayjs(a1.starts_at)
                  .tz(TZ)
                  .format("h:mm A dddd D MMMM")}. Press 1 or say yes to reschedule this appointment.`
              );
            }
          } catch (err) {
            console.error("[RES][LIST][ERROR]", err);
            saySafe(vr, "Sorry, I couldn't load your bookings.");
          }
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // RESCHEDULE: pick which appointment (1 or 2), ask new day
        // ───────────────────────────────────────────────────────────────────
        case "res-pick-day": {
          const aid1 = String(req.query.aid1 || "");
          const aid2 = String(req.query.aid2 || "");
          const useSecond = choseSecondOption(digits, speechRaw);
          const apptId = useSecond && aid2 ? aid2 : aid1;

          if (!apptId) {
            saySafe(vr, "Sorry, I didn't catch that. Let's start again.");
            vr.redirect(
              { method: "POST" },
              abs(`/api/voice/handle?route=res-list&callSid=${encodeURIComponent(callSid)}`)
            );
            break;
          }

          const g = vr.gather({
            input: ["speech"],
            language: "en-AU",
            timeout: 5,
            speechTimeout: "auto",
            actionOnEmptyResult: true,
            action: abs(
              `/api/voice/handle?route=res-day&callSid=${encodeURIComponent(
                callSid
              )}&aid=${encodeURIComponent(apptId)}`
            ),
          });
          g.say({ voice: "Polly.Olivia-Neural" }, "Which day would you like to move it to?");
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // RESCHEDULE: get availability for new day
        // ───────────────────────────────────────────────────────────────────
        case "res-day": {
          const aid = String(req.query.aid || "");
          const { day, fromIso, toIso } = nextWeekdayFromSpeech(speechRaw || "");
          console.log("[RES][DAY]", { fromIso, toIso, day });

          const slots = await getAvailability({ fromIso, toIso, part: "any" });
          const [c1, c2] = (slots || []).slice(0, 2);

          if (!c1) {
            saySafe(vr, "Sorry, there are no times available that day.");
            vr.redirect(
              { method: "POST" },
              abs(
                `/api/voice/handle?route=res-pick-day&callSid=${encodeURIComponent(
                  callSid
                )}&aid1=${encodeURIComponent(aid)}`
              )
            );
            break;
          }

          const g = vr.gather({
            input: ["speech", "dtmf"],
            language: "en-AU",
            timeout: 5,
            actionOnEmptyResult: true,
            action:
              abs(
                `/api/voice/handle?route=res-choose&callSid=${encodeURIComponent(
                  callSid
                )}&aid=${encodeURIComponent(aid)}`
              ) +
              `&s1=${encodeURIComponent(c1.startIso)}` +
              (c2 ? `&s2=${encodeURIComponent(c2.startIso)}` : ""),
          });

          g.say(
            { voice: "Polly.Olivia-Neural" },
            c2
              ? `I have two options. Option one, ${dayjs(c1.startIso)
                  .tz(TZ)
                  .format("h:mm A dddd D MMMM")}. Or option two, ${dayjs(c2.startIso)
                  .tz(TZ)
                  .format("h:mm A dddd D MMMM")}. Press 1 or 2, or say your choice.`
              : `I have one option: ${dayjs(c1.startIso)
                  .tz(TZ)
                  .format("h:mm A dddd D MMMM")}. Press 1 or say yes to move it here.`
          );
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // RESCHEDULE: complete move
        // ───────────────────────────────────────────────────────────────────
        case "res-choose": {
          const aid = String(req.query.aid || "");
          const s1 = String(req.query.s1 || "");
          const s2 = String(req.query.s2 || "");
          const picked =
            s2 ? (choseSecondOption(digits, speechRaw) ? s2 : s1) : (saidYesOrFirst(digits, speechRaw) ? s1 : s1);

          if (!aid || !picked) {
            saySafe(vr, "Sorry, I couldn't complete that. Let's start again.");
            vr.redirect(
              { method: "POST" },
              abs(`/api/voice/handle?route=res-list&callSid=${encodeURIComponent(callSid)}`)
            );
            break;
          }

          try {
            await rescheduleAppointment(aid, picked);
            saySafe(
              vr,
              `Done. I've moved your booking to ${dayjs(picked)
                .tz(TZ)
                .format("h:mm A dddd D MMMM")}. You'll receive a confirmation shortly. Goodbye.`
            );
          } catch (err) {
            console.error("[RES-CHOOSE][ERROR]", err);
            saySafe(vr, "Sorry, I couldn't complete the reschedule.");
          }
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // CANCEL: list up to 2 upcoming appointments
        // ───────────────────────────────────────────────────────────────────
        case "cancel-list": {
          try {
            const appts = await getPatientAppointments(from);

            if (!appts || appts.length === 0) {
              saySafe(vr, "I couldn't find any upcoming bookings on your number.");
              vr.redirect(
                { method: "POST" },
                abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`)
              );
              break;
            }

            const [a1, a2] = appts.slice(0, 2);
            const g = vr.gather({
              input: ["speech", "dtmf"],
              language: "en-AU",
              timeout: 5,
              actionOnEmptyResult: true,
              action:
                abs(
                  `/api/voice/handle?route=cancel-confirm&callSid=${encodeURIComponent(callSid)}`
                ) +
                `&aid1=${encodeURIComponent(a1.id)}` +
                (a2 ? `&aid2=${encodeURIComponent(a2.id)}` : ""),
            });

            if (a2) {
              g.say(
                { voice: "Polly.Olivia-Neural" },
                `You have two bookings. Option one, ${dayjs(a1.starts_at)
                  .tz(TZ)
                  .format("h:mm A dddd D MMMM")}. Option two, ${dayjs(a2.starts_at)
                  .tz(TZ)
                  .format("h:mm A dddd D MMMM")}. Press 1 or 2, or say your choice to cancel.`
              );
            } else {
              g.say(
                { voice: "Polly.Olivia-Neural" },
                `Your upcoming booking is ${dayjs(a1.starts_at)
                  .tz(TZ)
                  .format("h:mm A dddd D MMMM")}. Press 1 or say yes to cancel this appointment.`
              );
            }
          } catch (err) {
            console.error("[CANCEL][LIST][ERROR]", err);
            saySafe(vr, "Sorry, I couldn't load your bookings.");
          }
          break;
        }

        // ───────────────────────────────────────────────────────────────────
        // CANCEL: perform cancellation
        // ───────────────────────────────────────────────────────────────────
        case "cancel-confirm": {
          const aid1 = String(req.query.aid1 || "");
          const aid2 = String(req.query.aid2 || "");
          const apptId = choseSecondOption(digits, speechRaw) && aid2 ? aid2 : aid1;

          if (!apptId) {
            saySafe(vr, "Sorry, I didn't catch that.");
            vr.redirect(
              { method: "POST" },
              abs(`/api/voice/handle?route=cancel-list&callSid=${encodeURIComponent(callSid)}`)
            );
            break;
          }

          try {
            await cancelAppointment(apptId);
            saySafe(
              vr,
              "Your appointment has been cancelled. If you'd like to book another time, just say book an appointment."
            );
          } catch (err) {
            console.error("[CANCEL][CONFIRM][ERROR]", err);
            saySafe(vr, "Sorry, I couldn't cancel that.");
          }
          break;
        }

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

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST (no signature validation needed)
  // ─────────────────────────────────────────────────────────────────────────────
  app.post("/api/voice/test", async (_req: Request, res: Response) => {
    const vr = new twilio.twiml.VoiceResponse();
    saySafe(vr, "This is a test Twi M L response. The voice system is working.");
    vr.redirect({ method: "POST" }, abs("/api/voice/handle?route=start"));
    res.type("text/xml").send(vr.toString());
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INCOMING CALL WEBHOOK (entry point)
  // ─────────────────────────────────────────────────────────────────────────────
  app.post("/api/voice/incoming", twilioWebhook, async (req: Request, res: Response) => {
    const vr = new twilio.twiml.VoiceResponse();
    const callSid = String(req.body?.CallSid || "");
    const from = String(req.body?.From || "");

    console.log("[VOICE][INCOMING]", { callSid, from });

    saySafe(vr, "Hello and welcome to your clinic. How can I help you today?");
    vr.pause({ length: 1 });
    vr.redirect(
      { method: "POST" },
      abs(`/api/voice/handle?route=start&callSid=${encodeURIComponent(callSid)}`)
    );

    res.type("text/xml").send(vr.toString());
  });
}
