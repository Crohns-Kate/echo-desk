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

  // Availability check endpoint
  app.get('/__cliniko/avail', async (_req, res) => {
    const region = process.env.CLINIKO_REGION || 'au4';
    const apiKey = process.env.CLINIKO_API_KEY;
    const businessId = process.env.CLINIKO_BUSINESS_ID;
    const practitionerId = process.env.CLINIKO_PRACTITIONER_ID;
    const appointmentTypeId = process.env.CLINIKO_APPT_TYPE_ID;

    try {
      if (!apiKey || !businessId || !practitionerId || !appointmentTypeId) {
        return res.json({
          ok: false,
          reason: 'Missing required CLINIKO_* environment variables',
          slots: []
        });
      }

      // Compute 6-day window: tomorrow to tomorrow+5 (more conservative to avoid timezone issues)
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const endDate = new Date(tomorrow);
      endDate.setDate(endDate.getDate() + 5);
      
      const from = tomorrow.toISOString().split('T')[0];
      const to = endDate.toISOString().split('T')[0];

      const base = `https://api.${region}.cliniko.com/v1`;
      const url = `${base}/businesses/${businessId}/practitioners/${practitionerId}/appointment_types/${appointmentTypeId}/available_times?from=${from}&to=${to}&per_page=20`;
      
      console.log('[Cliniko Debug] Availability URL:', url);

      const apiRes = await fetch(url, {
        headers: {
          'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
          'Accept': 'application/json'
        }
      });

      if (!apiRes.ok) {
        const text = await apiRes.text();
        return res.json({
          ok: false,
          reason: `Cliniko API ${apiRes.status}: ${text}`,
          url,
          slots: []
        });
      }

      const data = await apiRes.json();
      const times = data.available_times || [];
      const slots = times.slice(0, 10).map((t: any) => t.appointment_start);

      res.json({
        ok: true,
        url,
        from,
        to,
        totalSlots: times.length,
        slots
      });
    } catch (err: any) {
      res.json({
        ok: false,
        reason: err.message || String(err),
        slots: []
      });
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

  // Register Twilio voice webhook routes
  registerVoice(app);

  // Register dashboard API routes
  registerApp(app);

  const httpServer = createServer(app);
  
  // Initialize WebSocket server
  initializeWebSocket(httpServer);

  return httpServer;
}
