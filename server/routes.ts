import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerVoice } from "./routes/voice";
import { registerApp } from "./routes/app";
import { initializeWebSocket } from "./services/websocket";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize database
  await storage.seed();

  // Simple health check for Twilio and monitoring
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

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
      const result = await getAvailability({
        fromISO: fromDate,
        toISO: toDate,
        part,
        timezone: AUST_TZ
      });
      const slots = result.slots || [];

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
          iso: option1.startISO,
          speakable: speakableTime(option1.startISO, AUST_TZ)
        });
      }

      if (option2) {
        response.options.push({
          iso: option2.startISO,
          speakable: speakableTime(option2.startISO, AUST_TZ)
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

  // Voice test utility - test TTS voices
  app.get('/__voice/test', async (req, res) => {
    const voice = (req.query.voice as string) || process.env.TTS_VOICE || 'Polly.Matthew';
    const text = (req.query.say as string) || 'Hello, this is a voice test.';

    const twilio = (await import('twilio')).default;
    const vr = new twilio.twiml.VoiceResponse();
    vr.say({ voice: voice as any }, text);

    res.type('text/xml').send(vr.toString());
  });

  // Intent classifier test endpoint
  app.post('/__intent/classify', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'Missing text parameter' });
      }

      const { classifyIntent } = await import('./services/intent');
      const result = await classifyIntent(text);

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dashboard - last 20 calls with intent filter
  app.get('/__cliniko/dashboard', async (req, res) => {
    const intentFilter = req.query.intent as string | undefined;

    try {
      const { storage } = await import('./storage');
      const allCalls = await storage.listCalls(undefined, 50);

      // Filter by intent if specified
      const calls = intentFilter
        ? allCalls.filter(c => c.intent?.toLowerCase() === intentFilter.toLowerCase())
        : allCalls;

      const displayCalls = calls.slice(0, 20).map(c => ({
        time: c.createdAt ? new Date(c.createdAt).toLocaleString('en-AU', {
          timeZone: 'Australia/Brisbane',
          dateStyle: 'short',
          timeStyle: 'short'
        }) : '-',
        sid: c.callSid || '-',
        intent: c.intent || '-',
        outcome: c.summary || '-',
        error: c.summary?.includes('error') || c.summary?.includes('failed') ? '⚠️' : ''
      }));

      // HTML response with filter and search
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Call Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .controls { margin: 20px 0; display: flex; gap: 10px; }
    input, select { padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #0079F2; color: white; font-weight: 600; }
    tr:hover { background: #f9f9f9; }
    .error { color: #d32f2f; }
    .empty { text-align: center; padding: 40px; color: #666; }
  </style>
</head>
<body>
  <h1>📞 Call Dashboard</h1>
  <div class="controls">
    <select id="intentFilter" onchange="filterIntent()">
      <option value="">All Intents</option>
      <option value="incoming" ${intentFilter === 'incoming' ? 'selected' : ''}>Incoming</option>
      <option value="booking" ${intentFilter === 'booking' ? 'selected' : ''}>Booking</option>
      <option value="book" ${intentFilter === 'book' ? 'selected' : ''}>Book</option>
    </select>
    <input type="search" id="searchBox" placeholder="Search calls..." onkeyup="searchCalls()" />
  </div>
  <table id="callsTable">
    <thead>
      <tr>
        <th>Time</th>
        <th>Call SID</th>
        <th>Intent</th>
        <th>Outcome</th>
        <th>Error</th>
      </tr>
    </thead>
    <tbody>
      ${displayCalls.length ? displayCalls.map(c => `
        <tr>
          <td>${c.time}</td>
          <td><code>${c.sid}</code></td>
          <td><strong>${c.intent}</strong></td>
          <td>${c.outcome}</td>
          <td class="error">${c.error}</td>
        </tr>
      `).join('') : '<tr><td colspan="5" class="empty">No calls found</td></tr>'}
    </tbody>
  </table>
  <script>
    function filterIntent() {
      const intent = document.getElementById('intentFilter').value;
      window.location.href = intent ? '?intent=' + intent : '/__cliniko/dashboard';
    }
    function searchCalls() {
      const query = document.getElementById('searchBox').value.toLowerCase();
      const rows = document.querySelectorAll('#callsTable tbody tr');
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
      });
    }

    // Live WebSocket updates
    const wsToken = new URLSearchParams(window.location.search).get('ws_token') || '';
    if (wsToken) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(\`\${protocol}//\${window.location.host}/ws?ws_token=\${wsToken}\`);

      ws.onmessage = (event) => {
        try {
          const { event: eventType, data } = JSON.parse(event.data);

          if (eventType === 'call:started' || eventType === 'call:updated') {
            prependCall(data);
          } else if (eventType === 'alert:created') {
            showToast('⚠️ New Alert: ' + data.reason);
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      ws.onerror = () => console.warn('WS connection error');
      ws.onclose = () => console.log('WS disconnected');
    }

    function prependCall(call) {
      const tbody = document.querySelector('#callsTable tbody');
      const time = new Date(call.createdAt).toLocaleString('en-AU', {
        timeZone: 'Australia/Brisbane',
        dateStyle: 'short',
        timeStyle: 'short'
      });

      const row = document.createElement('tr');
      row.innerHTML = \`
        <td>\${time}</td>
        <td><code>\${call.callSid || '-'}</code></td>
        <td><strong>\${call.intent || '-'}</strong></td>
        <td>\${call.summary || '-'}</td>
        <td class="error">\${call.summary?.includes('error') ? '⚠️' : ''}</td>
      \`;

      // Prepend to table (newest first)
      tbody.insertBefore(row, tbody.firstChild);

      // Highlight briefly
      row.style.backgroundColor = '#fffbcc';
      setTimeout(() => row.style.backgroundColor = '', 2000);
    }

    function showToast(message) {
      const toast = document.createElement('div');
      toast.textContent = message;
      toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#d32f2f;color:white;padding:16px 24px;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:9999;';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }
  </script>
</body>
</html>`;

      res.type('text/html').send(html);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
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


  // Recording proxy endpoints for authenticated playback and download
  app.get('/api/recordings/:sid/stream', async (req, res) => {
    try {
      // Simple authentication - just verify the recording SID exists in our database
      const { sid } = req.params;

      // Verify this recording SID exists in our call logs
      const callWithRecording = await storage.listCalls();
      const hasRecording = callWithRecording.some(call => call.recordingSid === sid);

      if (!hasRecording) {
        console.log('[RECORDING STREAM] Recording SID not found in database:', sid);
        return res.status(404).json({ error: 'Recording not found' });
      }
      const fetch = (await import('node-fetch')).default;
      const { Readable } = await import('stream');
      const env = (await import('./utils/env')).env;

      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
        return res.status(500).json({ error: 'Twilio credentials not configured' });
      }
      
      // Build Twilio recording URL
      const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
      
      // Fetch from Twilio with Basic Auth
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const twilioRes = await fetch(recordingUrl, {
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });
      
      if (!twilioRes.ok) {
        if (twilioRes.status === 404) {
          return res.status(404).json({ error: 'Recording not found' });
        }
        throw new Error(`Twilio API error: ${twilioRes.status}`);
      }
      
      // Stream to client - convert Web ReadableStream to Node stream
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      
      if (twilioRes.body) {
        Readable.fromWeb(twilioRes.body as any).pipe(res);
      } else {
        throw new Error('No response body from Twilio');
      }
    } catch (err: any) {
      console.error('[RECORDING STREAM ERROR]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Failed to stream recording' });
      }
    }
  });

  app.get('/api/recordings/:sid/download', async (req, res) => {
    try {
      // Simple authentication - just verify the recording SID exists in our database
      const { sid } = req.params;

      // Verify this recording SID exists in our call logs
      const callWithRecording = await storage.listCalls();
      const hasRecording = callWithRecording.some(call => call.recordingSid === sid);

      if (!hasRecording) {
        console.log('[RECORDING DOWNLOAD] Recording SID not found in database:', sid);
        return res.status(404).json({ error: 'Recording not found' });
      }
      const fetch = (await import('node-fetch')).default;
      const { Readable } = await import('stream');
      const env = (await import('./utils/env')).env;

      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
        return res.status(500).json({ error: 'Twilio credentials not configured' });
      }
      
      // Build Twilio recording URL
      const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
      
      // Fetch from Twilio with Basic Auth
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const twilioRes = await fetch(recordingUrl, {
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });
      
      if (!twilioRes.ok) {
        if (twilioRes.status === 404) {
          return res.status(404).json({ error: 'Recording not found' });
        }
        throw new Error(`Twilio API error: ${twilioRes.status}`);
      }
      
      // Download to client - convert Web ReadableStream to Node stream
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${sid}.mp3"`);
      
      if (twilioRes.body) {
        Readable.fromWeb(twilioRes.body as any).pipe(res);
      } else {
        throw new Error('No response body from Twilio');
      }
    } catch (err: any) {
      console.error('[RECORDING DOWNLOAD ERROR]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Failed to download recording' });
      }
    }
  });

  // Apply URL-encoded parser specifically for Twilio voice webhooks
  // This prevents "stream is not readable" errors by parsing only once
  app.use('/api/voice', express.urlencoded({ extended: false }));

  // Apply Twilio signature validation to all voice webhooks
  const { validateTwilioSignature } = await import('./middlewares/twilioAuth');
  app.use('/api/voice', validateTwilioSignature);

  // Register Twilio voice webhook routes
  registerVoice(app);

  // Register dashboard API routes
  registerApp(app);

  const httpServer = createServer(app);
  
  // Initialize WebSocket server
  initializeWebSocket(httpServer);

  return httpServer;
}
