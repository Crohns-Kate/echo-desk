// server/routes.ts
import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerVoice } from "./routes/voice";
import { registerApp } from "./routes/app";
import { initializeWebSocket } from "./services/websocket";

/**
 * Register all routes and initialize dependencies for the server.
 * This is the unified routing layer for both Twilio and your app.
 */
export async function registerRoutes(app: Express): Promise<Server> {
  // ──────────────────────────────────────────────────────────────
  // 1️⃣ Initialize storage / database (safe to call; is idempotent)
  // ──────────────────────────────────────────────────────────────
  await storage.seed();

  // ──────────────────────────────────────────────────────────────
  // 2️⃣ Twilio routes — keep this early (voice module handles parsing)
  //    NOTE: Do NOT add body parsers here that could break Twilio
  //    signature validation in the voice router.
  // ──────────────────────────────────────────────────────────────
  registerVoice(app);

  // ──────────────────────────────────────────────────────────────
  // 3️⃣ Health Check Endpoints
  // ──────────────────────────────────────────────────────────────

  // Simple ping for uptime monitoring
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      env: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
    });
  });

  // Enhanced Cliniko health endpoint
  app.get("/__cliniko/health", async (_req, res) => {
    const region = process.env.CLINIKO_REGION || "au4";
    const apiKey = process.env.CLINIKO_API_KEY;
    const businessId = process.env.CLINIKO_BUSINESS_ID;
    const practitionerId = process.env.CLINIKO_PRACTITIONER_ID;

    res.json({
      ok: Boolean(apiKey && businessId && practitionerId),
      region,
      businessId,
      practitionerId,
      timestamp: new Date().toISOString(),
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 4️⃣ Diagnostics & Tools (timezone, availability, TTS helpers)
  // ──────────────────────────────────────────────────────────────

  // Timezone diagnostic endpoint
  app.get("/__tz/now", async (_req, res) => {
    const { AUST_TZ } = await import("./time");
    const now = new Date();

    const serverTime = now.toISOString();
    const clinicTime = now.toLocaleString("en-AU", {
      timeZone: AUST_TZ,
      dateStyle: "full",
      timeStyle: "long",
    });

    res.json({
      serverTime,
      clinicTime,
      timezone: AUST_TZ,
      serverOffset: -now.getTimezoneOffset() / 60,
    });
  });

  // Availability check endpoint with day/part params
  app.get("/__cliniko/avail", async (req, res) => {
    try {
      const { localDayWindow, speakableTime, AUST_TZ } = await import("./time");
      const { getAvailability } = await import("./services/cliniko");

      const day = (req.query.day as string) || "tomorrow";
      const part = (req.query.part as string) as "morning" | "afternoon" | undefined;

      // Calculate exact day window (AU TZ)
      const { fromDate, toDate } = localDayWindow(day, AUST_TZ);

      console.log(
        `[Diagnostic] Fetching avail for day="${day}" part="${part}" → from=${fromDate} to=${toDate}`
      );

      const slots = await getAvailability({
        fromDate,
        toDate,
        part,
        timezone: AUST_TZ,
      });

      const option1 = slots[0];
      const option2 = slots[1];

      const response: any = {
        ok: true,
        day,
        part: part || "any",
        fromDate,
        toDate,
        totalSlots: slots.length,
        options: [],
      };

      if (option1) {
        response.options.push({
          iso: option1.startIso,
          speakable: speakableTime(option1.startIso, AUST_TZ),
        });
      }

      if (option2) {
        response.options.push({
          iso: option2.startIso,
          speakable: speakableTime(option2.startIso, AUST_TZ),
        });
      }

      if (slots.length === 0) {
        response.message = `No ${part || ""} slots available for ${day} (${fromDate})`;
      }

      res.json(response);
    } catch (err: any) {
      res.json({
        ok: false,
        reason: err.message || String(err),
        stack: err.stack,
      });
    }
  });

  // TTS demo endpoint - test natural time pronunciation
  app.get("/__tts/demo", async (req, res) => {
    try {
      const { speakableTime, AUST_TZ } = await import("./time");
      const iso = (req.query.iso as string) || new Date().toISOString();

      const spoken = speakableTime(iso, AUST_TZ);

      res.json({
        iso,
        speak: spoken,
        timezone: AUST_TZ,
      });
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });

  // Self-test endpoint - runs both checks
  app.get("/__selftest", async (_req, res) => {
    const results: any = {
      timestamp: new Date().toISOString(),
      tests: {},
    };

    try {
      const base = `http://localhost:${process.env.PORT || 5000}`;
      const healthRes = await fetch(`${base}/__cliniko/health`);
      results.tests.health = await healthRes.json();

      const availRes = await fetch(`${base}/__cliniko/avail`);
      results.tests.availability = await availRes.json();

      results.ok = results.tests.health.ok && results.tests.availability.ok;
      results.summary = results.ok
        ? `✅ All tests passed. ${results.tests.availability.totalSlots || 0} slots available.`
        : `❌ Some tests failed. Check individual test results.`;
    } catch (err: any) {
      results.ok = false;
      results.error = err.message || String(err);
    }

    res.json(results);
  });

  // Timezone test endpoint - verify AU timezone formatting works
  app.get("/__tz-test", async (_req, res) => {
    const {
      speakTimeAU,
      speakDayAU,
      formatAppointmentTimeAU,
      isMorningAU,
      dateOnlyAU,
    } = await import("./utils/tz");

    const testSlots = [
      "2025-10-31T23:00:00Z", // 10am Nov 1 AEDT
      "2025-11-01T02:00:00Z", // 1pm Nov 1 AEDT
      "2025-11-01T05:00:00Z", // 4pm Nov 1 AEDT
    ];

    const results = testSlots.map((slot) => ({
      utc: slot,
      speakTimeAU: speakTimeAU(slot),
      speakDayAU: speakDayAU(slot),
      formatAppointmentTimeAU: formatAppointmentTimeAU(slot),
      isMorningAU: isMorningAU(slot),
      dateOnlyAU: dateOnlyAU(slot),
    }));

    res.json({
      ok: true,
      timezone: "Australia/Sydney",
      samples: results,
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 5️⃣ Recording proxy endpoints for authenticated playback/download
  // ──────────────────────────────────────────────────────────────
  app.get("/api/recordings/:sid/stream", async (req, res) => {
    try {
      const { sid } = req.params;
      const fetch = (await import("node-fetch")).default;
      const { Readable } = await import("stream");
      const env = (await import("./utils/env")).env;

      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
        return res.status(500).json({ error: "Twilio credentials not configured" });
      }

      const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
      const auth = Buffer.from(
        `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`
      ).toString("base64");

      const twilioRes = await fetch(recordingUrl, {
        headers: { Authorization: `Basic ${auth}` },
      });

      if (!twilioRes.ok) {
        if (twilioRes.status === 404) {
          return res.status(404).json({ error: "Recording not found" });
        }
        throw new Error(`Twilio API error: ${twilioRes.status}`);
      }

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Accept-Ranges", "bytes");

      if (twilioRes.body) {
        Readable.fromWeb(twilioRes.body as any).pipe(res);
      } else {
        throw new Error("No response body from Twilio");
      }
    } catch (err: any) {
      console.error("[RECORDING STREAM ERROR]", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Failed to stream recording" });
      }
    }
  });

  app.get("/api/recordings/:sid/download", async (req, res) => {
    try {
      const { sid } = req.params;
      const fetch = (await import("node-fetch")).default;
      const { Readable } = await import("stream");
      const env = (await import("./utils/env")).env;

      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
        return res.status(500).json({ error: "Twilio credentials not configured" });
      }

      const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
      const auth = Buffer.from(
        `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`
      ).toString("base64");

      const twilioRes = await fetch(recordingUrl, {
        headers: { Authorization: `Basic ${auth}` },
      });

      if (!twilioRes.ok) {
        if (twilioRes.status === 404) {
          return res.status(404).json({ error: "Recording not found" });
        }
        throw new Error(`Twilio API error: ${twilioRes.status}`);
      }

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${sid}.mp3"`);

      if (twilioRes.body) {
        Readable.fromWeb(twilioRes.body as any).pipe(res);
      } else {
        throw new Error("No response body from Twilio");
      }
    } catch (err: any) {
      console.error("[RECORDING DOWNLOAD ERROR]", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Failed to download recording" });
      }
    }
  });

  // ──────────────────────────────────────────────────────────────
  // 6️⃣ Application routes (REST endpoints, web UI, etc.)
  // ──────────────────────────────────────────────────────────────
  registerApp(app);

  // ──────────────────────────────────────────────────────────────
  // 7️⃣ WebSocket server (for live notifications / dashboard updates)
  // ──────────────────────────────────────────────────────────────
  const server = createServer(app);
  initializeWebSocket(server);

  // ──────────────────────────────────────────────────────────────
  // 8️⃣ Return the configured HTTP server
  // ──────────────────────────────────────────────────────────────
  return server;
}