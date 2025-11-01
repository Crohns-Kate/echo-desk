import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerVoice } from "./routes/voice";
import { registerApp } from "./routes/app";
import { initializeWebSocket } from "./services/websocket";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize database
  await storage.seed();

  // Enhanced health check endpoint with live API verification
  app.get('/__cliniko/health', async (_req, res) => {
    const region = process.env.CLINIKO_REGION || 'au4';
    const apiKey = process.env.CLINIKO_API_KEY;
    const businessId = process.env.CLINIKO_BUSINESS_ID;
    const practitionerId = process.env.CLINIKO_PRACTITIONER_ID;
    const appointmentTypeId = process.env.CLINIKO_APPT_TYPE_ID;
    
    const response: any = {
      region,
      businessId,
      practitionerId,
      appointmentTypeId,
      ok: false,
      reason: null
    };

    try {
      if (!apiKey) {
        response.reason = 'CLINIKO_API_KEY not set';
        return res.json(response);
      }

      const base = `https://api.${region}.cliniko.com/v1`;
      const url = `${base}/appointment_types?per_page=1`;
      
      const apiRes = await fetch(url, {
        headers: {
          'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
          'Accept': 'application/json'
        }
      });

      if (!apiRes.ok) {
        const text = await apiRes.text();
        response.reason = `Cliniko API ${apiRes.status}: ${text.slice(0, 100)}`;
        return res.json(response);
      }

      response.ok = true;
      res.json(response);
    } catch (err: any) {
      response.reason = err.message || String(err);
      res.json(response);
    }
  });

  // Timezone diagnostic endpoint
  app.get('/__tz/now', async (_req, res) => {
    const { AUST_TZ } = await import('./time');
    const now = new Date();
    
    const serverTime = now.toISOString();
    const clinicTime = now.toLocaleString('en-AU', { 
      timeZone: AUST_TZ,
      dateStyle: 'full',
      timeStyle: 'long'
    });
    
    res.json({
      serverTime,
      clinicTime,
      timezone: AUST_TZ,
      serverOffset: -now.getTimezoneOffset() / 60
    });
  });

  // Availability check endpoint with day/part params
  app.get('/__cliniko/avail', async (req, res) => {
    try {
      const { localDayWindow, speakableTime, AUST_TZ } = await import('./time');
      const { getAvailability } = await import('./services/cliniko');
      
      const day = (req.query.day as string) || 'tomorrow';
      const part = (req.query.part as string) as 'morning' | 'afternoon' | undefined;
      
      // Calculate exact day window
      const { fromDate, toDate } = localDayWindow(day, AUST_TZ);
      
      console.log(`[Diagnostic] Fetching avail for day="${day}" part="${part}" → from=${fromDate} to=${toDate}`);
      
      // Fetch slots
      const slots = await getAvailability({ 
        fromDate, 
        toDate, 
        part, 
        timezone: AUST_TZ 
      });
      
      // Pick top 2 for IVR offer
      const option1 = slots[0];
      const option2 = slots[1];
      
      const response: any = {
        ok: true,
        day,
        part: part || 'any',
        fromDate,
        toDate,
        totalSlots: slots.length,
        options: []
      };
      
      if (option1) {
        response.options.push({
          iso: option1.startIso,
          speakable: speakableTime(option1.startIso, AUST_TZ)
        });
      }
      
      if (option2) {
        response.options.push({
          iso: option2.startIso,
          speakable: speakableTime(option2.startIso, AUST_TZ)
        });
      }
      
      if (slots.length === 0) {
        response.message = `No ${part || ''} slots available for ${day} (${fromDate})`;
      }
      
      res.json(response);
    } catch (err: any) {
      res.json({
        ok: false,
        reason: err.message || String(err),
        stack: err.stack
      });
    }
  });

  // TTS demo endpoint - test natural time pronunciation
  app.get('/__tts/demo', async (req, res) => {
    try {
      const { speakableTime, AUST_TZ } = await import('./time');
      const iso = (req.query.iso as string) || new Date().toISOString();
      
      const spoken = speakableTime(iso, AUST_TZ);
      
      res.json({
        iso,
        speak: spoken,
        timezone: AUST_TZ
      });
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });

  // Self-test endpoint - runs both checks
  app.get('/__selftest', async (_req, res) => {
    const results: any = {
      timestamp: new Date().toISOString(),
      tests: {}
    };

    try {
      // Test 1: Health check
      const healthUrl = `http://localhost:${process.env.PORT || 5000}/__cliniko/health`;
      const healthRes = await fetch(healthUrl);
      results.tests.health = await healthRes.json();

      // Test 2: Availability check
      const availUrl = `http://localhost:${process.env.PORT || 5000}/__cliniko/avail`;
      const availRes = await fetch(availUrl);
      results.tests.availability = await availRes.json();

      // Overall status
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
  app.get('/__tz-test', async (_req, res) => {
    const { speakTimeAU, speakDayAU, formatAppointmentTimeAU, isMorningAU, dateOnlyAU } = await import('./utils/tz');
    
    const testSlots = [
      "2025-10-31T23:00:00Z",  // 10am Nov 1 AEDT
      "2025-11-01T02:00:00Z",  // 1pm Nov 1 AEDT
      "2025-11-01T05:00:00Z"   // 4pm Nov 1 AEDT
    ];
    
    const results = testSlots.map(slot => ({
      utc: slot,
      speakTimeAU: speakTimeAU(slot),
      speakDayAU: speakDayAU(slot),
      formatAppointmentTimeAU: formatAppointmentTimeAU(slot),
      isMorningAU: isMorningAU(slot),
      dateOnlyAU: dateOnlyAU(slot)
    }));
    
    res.json({
      ok: true,
      timezone: 'Australia/Sydney',
      samples: results
    });
  });

  // Register Twilio voice webhook routes
  registerVoice(app);

  // Register dashboard API routes
  registerApp(app);

  const httpServer = createServer(app);
  
  // Initialize WebSocket server
  initializeWebSocket(httpServer);

  return httpServer;
}
