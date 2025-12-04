import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerVoice } from "./routes/voice";
import { registerApp } from "./routes/app";
import { initializeWebSocket } from "./services/websocket";
import authRoutes from "./routes/auth";
import phonePoolRoutes from "./routes/phonePool";
import tenantRoutes from "./routes/tenant";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize database
  await storage.seed();

  // Authentication routes (before other API routes)
  app.use("/api/auth", authRoutes);

  // Phone pool admin routes (super admin only)
  app.use("/api/admin/phone-pool", phonePoolRoutes);

  // Tenant self-service routes (authenticated tenant users)
  app.use("/api/tenant", tenantRoutes);

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
      timestamp: new Date().toISOString(),
      configuration: {
        region,
        businessId: businessId || null,
        practitionerId: practitionerId || null,
        appointmentTypeId: appointmentTypeId || null,
        apiKeyConfigured: !!apiKey
      },
      autoDetection: {
        attempted: false,
        business: null,
        practitioner: null,
        appointmentType: null
      },
      connectivity: {
        ok: false,
        reason: null
      },
      availabilityTest: {
        attempted: false,
        ok: false,
        reason: null,
        slotsFound: 0
      },
      recommendations: []
    };

    try {
      // Check API key
      if (!apiKey) {
        response.connectivity.reason = 'CLINIKO_API_KEY not set';
        response.recommendations.push('Set CLINIKO_API_KEY in environment variables. Get your API key from Cliniko Settings → API Keys.');
        response.recommendations.push('Run: node setup-cliniko-config.mjs to get all required configuration.');
        return res.json(response);
      }

      // Test API connectivity
      const base = `https://api.${region}.cliniko.com/v1`;
      const headers = {
        'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
        'Accept': 'application/json'
      };

      const testUrl = `${base}/businesses?per_page=1`;
      const apiRes = await fetch(testUrl, { headers });

      if (!apiRes.ok) {
        const text = await apiRes.text();
        response.connectivity.reason = `Cliniko API ${apiRes.status}: ${text.slice(0, 200)}`;

        if (apiRes.status === 401) {
          response.recommendations.push('API key is invalid or expired. Check CLINIKO_API_KEY in your environment variables.');
        } else if (apiRes.status === 404) {
          response.recommendations.push(`Region might be incorrect. Current: ${region}. Check your Cliniko URL to verify the region (e.g., app.au1.cliniko.com means region = au1).`);
        }

        return res.json(response);
      }

      response.connectivity.ok = true;

      // Attempt auto-detection
      response.autoDetection.attempted = true;

      try {
        // Auto-detect business
        if (!businessId) {
          const { getBusinesses } = await import('./services/cliniko');
          const businesses = await getBusinesses();
          if (businesses.length > 0) {
            response.autoDetection.business = {
              id: businesses[0].id,
              name: businesses[0].name,
              note: businesses.length > 1 ? `${businesses.length} businesses found, showing first one` : 'Single business found'
            };
            response.recommendations.push(`Auto-detected business: ${businesses[0].name} (${businesses[0].id}). Add CLINIKO_BUSINESS_ID=${businesses[0].id} to environment if you want to lock this in.`);
          } else {
            response.recommendations.push('No businesses found in Cliniko account. Please create at least one business in Cliniko.');
          }
        }

        // Auto-detect practitioner
        if (!practitionerId) {
          const { getPractitioners } = await import('./services/cliniko');
          const practitioners = await getPractitioners();
          if (practitioners.length > 0) {
            response.autoDetection.practitioner = {
              id: practitioners[0].id,
              name: `${practitioners[0].first_name} ${practitioners[0].last_name}`,
              note: practitioners.length > 1 ? `${practitioners.length} practitioners found, showing first one` : 'Single practitioner found'
            };
            response.recommendations.push(`Auto-detected practitioner: ${practitioners[0].first_name} ${practitioners[0].last_name} (${practitioners[0].id}). Add CLINIKO_PRACTITIONER_ID=${practitioners[0].id} to environment to specify.`);
          } else {
            response.recommendations.push('No practitioners found in Cliniko. Ensure at least one practitioner is marked as "Show in online bookings" and "Active".');
          }
        }

        // Auto-detect appointment type
        const detectedPractitionerId = practitionerId || response.autoDetection.practitioner?.id;
        if (!appointmentTypeId && detectedPractitionerId) {
          const { getAppointmentTypes } = await import('./services/cliniko');
          const appointmentTypes = await getAppointmentTypes(detectedPractitionerId);
          if (appointmentTypes.length > 0) {
            response.autoDetection.appointmentType = {
              id: appointmentTypes[0].id,
              name: appointmentTypes[0].name,
              duration: appointmentTypes[0].duration_in_minutes,
              note: appointmentTypes.length > 1 ? `${appointmentTypes.length} types found, showing first one` : 'Single appointment type found',
              allTypes: appointmentTypes.map(at => ({ id: at.id, name: at.name, duration: at.duration_in_minutes }))
            };
            response.recommendations.push(`Auto-detected appointment type: ${appointmentTypes[0].name} (${appointmentTypes[0].id}, ${appointmentTypes[0].duration_in_minutes}min). Add CLINIKO_APPT_TYPE_ID=${appointmentTypes[0].id} to environment to specify.`);
          } else {
            response.recommendations.push(`No appointment types found for practitioner ${detectedPractitionerId}. Ensure this practitioner has at least one appointment type marked as "Show in online bookings".`);
          }
        }

        // Test availability fetch
        response.availabilityTest.attempted = true;
        const { getAvailability } = await import('./services/cliniko');

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const fromISO = tomorrow.toISOString().split('T')[0];

        const { slots } = await getAvailability({
          fromISO,
          toISO: fromISO,
          practitionerId: practitionerId || response.autoDetection.practitioner?.id,
          appointmentTypeId: appointmentTypeId || response.autoDetection.appointmentType?.id
        });

        response.availabilityTest.ok = true;
        response.availabilityTest.slotsFound = slots.length;

        if (slots.length === 0) {
          response.recommendations.push(`✅ Cliniko connection successful but no availability found for ${fromISO}. This may be normal if the practitioner has no openings tomorrow.`);
        } else {
          response.recommendations.push(`✅ Successfully retrieved ${slots.length} available slots for ${fromISO}. Cliniko integration is working!`);
        }

      } catch (autoDetectErr: any) {
        response.availabilityTest.reason = autoDetectErr.message;
        response.recommendations.push(`❌ Error during configuration: ${autoDetectErr.message}`);
      }

      // Add final setup recommendation if needed
      if (response.recommendations.length === 0) {
        response.recommendations.push('✅ All Cliniko configuration is complete and working!');
      } else if (!practitionerId || !appointmentTypeId) {
        response.recommendations.push('');
        response.recommendations.push('💡 Quick setup: Run `node setup-cliniko-config.mjs` to automatically fetch all required IDs.');
      }

      res.json(response);
    } catch (err: any) {
      response.connectivity.reason = err.message || String(err);
      response.recommendations.push(`Unexpected error: ${err.message}`);
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
      
      // Stream to client - node-fetch body is already a Node.js stream
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');

      if (twilioRes.body) {
        // node-fetch v2 returns a Node.js stream, not a Web ReadableStream
        twilioRes.body.pipe(res);
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
      
      // Download to client - node-fetch body is already a Node.js stream
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${sid}.mp3"`);

      if (twilioRes.body) {
        // node-fetch v2 returns a Node.js stream, not a Web ReadableStream
        twilioRes.body.pipe(res);
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

  // Register form collection routes
  const { registerForms } = await import('./routes/forms');
  registerForms(app);

  // Register SMS webhook routes
  const { registerSMS } = await import('./routes/sms');
  registerSMS(app);

  // Register dashboard API routes
  registerApp(app);

  // ═══════════════════════════════════════════════════════════
  // TENANT ADMIN API
  // ═══════════════════════════════════════════════════════════

  // List all tenants
  app.get('/api/admin/tenants', async (_req, res) => {
    try {
      const tenants = await storage.listTenants();
      // Remove sensitive fields but include configuration fields
      const safeTenants = tenants.map(t => ({
        id: t.id,
        slug: t.slug,
        clinicName: t.clinicName,
        phoneNumber: t.phoneNumber,
        email: t.email,
        timezone: t.timezone,
        voiceName: t.voiceName,
        greeting: t.greeting,
        isActive: t.isActive,
        subscriptionTier: t.subscriptionTier,
        subscriptionStatus: t.subscriptionStatus,
        recordingEnabled: t.recordingEnabled,
        transcriptionEnabled: t.transcriptionEnabled,
        faqEnabled: t.faqEnabled,
        smsEnabled: t.smsEnabled,
        hasClinikoKey: !!t.clinikoApiKeyEncrypted,
        clinikoShard: t.clinikoShard,
        clinikoPractitionerId: t.clinikoPractitionerId,
        clinikoStandardApptTypeId: t.clinikoStandardApptTypeId,
        clinikoNewPatientApptTypeId: t.clinikoNewPatientApptTypeId,
        createdAt: t.createdAt
      }));
      res.json(safeTenants);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single tenant by slug
  app.get('/api/admin/tenants/:slug', async (req, res) => {
    try {
      const tenant = await storage.getTenant(req.params.slug);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      // Remove encrypted API key from response
      const { clinikoApiKeyEncrypted, ...safeTenant } = tenant;
      res.json({
        ...safeTenant,
        hasClinikoKey: !!clinikoApiKeyEncrypted
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create new tenant
  app.post('/api/admin/tenants', async (req, res) => {
    try {
      const { slug, clinicName, phoneNumber, email, timezone, voiceName, greeting } = req.body;

      if (!slug || !clinicName) {
        return res.status(400).json({ error: 'slug and clinicName are required' });
      }

      // Check if slug already exists
      const existing = await storage.getTenant(slug);
      if (existing) {
        return res.status(409).json({ error: 'Tenant with this slug already exists' });
      }

      const tenant = await storage.createTenant({
        slug,
        clinicName,
        phoneNumber,
        email,
        timezone: timezone || 'Australia/Brisbane',
        voiceName: voiceName || 'Polly.Olivia-Neural',
        greeting: greeting || 'Thanks for calling'
      });

      res.status(201).json(tenant);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update tenant
  app.patch('/api/admin/tenants/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid tenant ID' });
      }

      const {
        clinicName, phoneNumber, email, address, timezone,
        voiceName, greeting, fallbackMessage, businessHours,
        clinikoApiKey, clinikoShard, clinikoPractitionerId,
        clinikoStandardApptTypeId, clinikoNewPatientApptTypeId,
        recordingEnabled, transcriptionEnabled, qaAnalysisEnabled,
        faqEnabled, smsEnabled, isActive,
        // New clinic settings fields
        parkingText, servicesText, firstVisitText, aboutText, healthText, faqJson
      } = req.body;

      const updates: any = {};

      // Only include fields that were provided
      if (clinicName !== undefined) updates.clinicName = clinicName;
      if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;
      if (email !== undefined) updates.email = email;
      if (address !== undefined) updates.address = address;
      if (timezone !== undefined) updates.timezone = timezone;
      if (voiceName !== undefined) updates.voiceName = voiceName;
      if (greeting !== undefined) updates.greeting = greeting;
      if (fallbackMessage !== undefined) updates.fallbackMessage = fallbackMessage;
      if (businessHours !== undefined) updates.businessHours = businessHours;
      if (clinikoShard !== undefined) updates.clinikoShard = clinikoShard;
      if (clinikoPractitionerId !== undefined) updates.clinikoPractitionerId = clinikoPractitionerId;
      if (clinikoStandardApptTypeId !== undefined) updates.clinikoStandardApptTypeId = clinikoStandardApptTypeId;
      if (clinikoNewPatientApptTypeId !== undefined) updates.clinikoNewPatientApptTypeId = clinikoNewPatientApptTypeId;
      if (recordingEnabled !== undefined) updates.recordingEnabled = recordingEnabled;
      if (transcriptionEnabled !== undefined) updates.transcriptionEnabled = transcriptionEnabled;
      if (qaAnalysisEnabled !== undefined) updates.qaAnalysisEnabled = qaAnalysisEnabled;
      if (faqEnabled !== undefined) updates.faqEnabled = faqEnabled;
      if (smsEnabled !== undefined) updates.smsEnabled = smsEnabled;
      if (isActive !== undefined) updates.isActive = isActive;
      // New clinic settings fields
      if (parkingText !== undefined) updates.parkingText = parkingText;
      if (servicesText !== undefined) updates.servicesText = servicesText;
      if (firstVisitText !== undefined) updates.firstVisitText = firstVisitText;
      if (aboutText !== undefined) updates.aboutText = aboutText;
      if (healthText !== undefined) updates.healthText = healthText;
      if (faqJson !== undefined) updates.faqJson = faqJson;

      // Handle Cliniko API key encryption
      if (clinikoApiKey) {
        const { encrypt } = await import('./services/tenantResolver');
        updates.clinikoApiKeyEncrypted = encrypt(clinikoApiKey);
      }

      const tenant = await storage.updateTenant(id, updates);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Remove sensitive data from response
      const { clinikoApiKeyEncrypted, ...safeTenant } = tenant;
      res.json({
        ...safeTenant,
        hasClinikoKey: !!clinikoApiKeyEncrypted
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get tenant stats
  app.get('/api/admin/tenants/:id/stats', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid tenant ID' });
      }

      const stats = await storage.getStats(id);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // Clinic Settings API (for Admin dashboard)
  // ============================================

  // GET /api/admin/settings - Get clinic settings for default tenant
  app.get('/api/admin/settings', async (_req, res) => {
    try {
      const tenant = await storage.getTenant('default');
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Return clinic settings (exclude sensitive data)
      res.json({
        id: tenant.id,
        clinicName: tenant.clinicName,
        address: tenant.address,
        phoneNumber: tenant.phoneNumber,
        email: tenant.email,
        timezone: tenant.timezone,
        businessHours: tenant.businessHours,
        greeting: tenant.greeting,
        voiceName: tenant.voiceName,
        // New clinic settings
        parkingText: tenant.parkingText || '',
        servicesText: tenant.servicesText || '',
        firstVisitText: tenant.firstVisitText || '',
        aboutText: tenant.aboutText || '',
        healthText: tenant.healthText || '',
        faqJson: tenant.faqJson || [],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/admin/settings - Update clinic settings for default tenant
  app.put('/api/admin/settings', async (req, res) => {
    try {
      const tenant = await storage.getTenant('default');
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const {
        clinicName, address, phoneNumber, email, timezone,
        businessHours, greeting, voiceName,
        parkingText, servicesText, firstVisitText, aboutText, healthText, faqJson
      } = req.body;

      const updates: any = {};

      // Only include fields that were provided
      if (clinicName !== undefined) updates.clinicName = clinicName;
      if (address !== undefined) updates.address = address;
      if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;
      if (email !== undefined) updates.email = email;
      if (timezone !== undefined) updates.timezone = timezone;
      if (businessHours !== undefined) updates.businessHours = businessHours;
      if (greeting !== undefined) updates.greeting = greeting;
      if (voiceName !== undefined) updates.voiceName = voiceName;
      if (parkingText !== undefined) updates.parkingText = parkingText;
      if (servicesText !== undefined) updates.servicesText = servicesText;
      if (firstVisitText !== undefined) updates.firstVisitText = firstVisitText;
      if (aboutText !== undefined) updates.aboutText = aboutText;
      if (healthText !== undefined) updates.healthText = healthText;
      if (faqJson !== undefined) updates.faqJson = faqJson;

      const updated = await storage.updateTenant(tenant.id, updates);
      if (!updated) {
        return res.status(500).json({ error: 'Failed to update settings' });
      }

      res.json({
        success: true,
        message: 'Settings saved successfully',
        settings: {
          id: updated.id,
          clinicName: updated.clinicName,
          address: updated.address,
          phoneNumber: updated.phoneNumber,
          email: updated.email,
          timezone: updated.timezone,
          businessHours: updated.businessHours,
          greeting: updated.greeting,
          voiceName: updated.voiceName,
          parkingText: updated.parkingText || '',
          servicesText: updated.servicesText || '',
          firstVisitText: updated.firstVisitText || '',
          aboutText: updated.aboutText || '',
          healthText: updated.healthText || '',
          faqJson: updated.faqJson || [],
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // FAQ Management API
  // ============================================

  // List FAQs (optionally filtered by tenant)
  app.get('/api/faqs', async (req, res) => {
    try {
      const tenantId = req.query.tenantId ? parseInt(req.query.tenantId as string, 10) : undefined;
      const activeOnly = req.query.activeOnly !== 'false';
      const faqs = await storage.listFaqs(tenantId, activeOnly);
      res.json(faqs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single FAQ
  app.get('/api/faqs/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid FAQ ID' });
      }
      const faq = await storage.getFaqById(id);
      if (!faq) {
        return res.status(404).json({ error: 'FAQ not found' });
      }
      res.json(faq);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create new FAQ
  app.post('/api/faqs', async (req, res) => {
    try {
      const { tenantId, category, question, answer, keywords, priority, isActive } = req.body;

      if (!category || !question || !answer) {
        return res.status(400).json({ error: 'category, question, and answer are required' });
      }

      const faq = await storage.createFaq({
        tenantId: tenantId || null,
        category,
        question,
        answer,
        keywords: keywords || [],
        priority: priority ?? 0,
        isActive: isActive ?? true
      });

      res.status(201).json(faq);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update FAQ
  app.patch('/api/faqs/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid FAQ ID' });
      }

      const existing = await storage.getFaqById(id);
      if (!existing) {
        return res.status(404).json({ error: 'FAQ not found' });
      }

      const { category, question, answer, keywords, priority, isActive } = req.body;
      const updates: any = {};

      if (category !== undefined) updates.category = category;
      if (question !== undefined) updates.question = question;
      if (answer !== undefined) updates.answer = answer;
      if (keywords !== undefined) updates.keywords = keywords;
      if (priority !== undefined) updates.priority = priority;
      if (isActive !== undefined) updates.isActive = isActive;

      const faq = await storage.updateFaq(id, updates);
      res.json(faq);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete FAQ
  app.delete('/api/faqs/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid FAQ ID' });
      }

      const existing = await storage.getFaqById(id);
      if (!existing) {
        return res.status(404).json({ error: 'FAQ not found' });
      }

      await storage.deleteFaq(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generate FAQs from tenant knowledge using AI
  app.post('/api/faqs/generate', async (req, res) => {
    try {
      const { tenantId } = req.body;

      if (!tenantId) {
        return res.status(400).json({ error: 'tenantId is required' });
      }

      const tenant = await storage.getTenantById(tenantId);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const { generateFaqsFromKnowledge } = await import('./services/faq');
      const generatedFaqs = await generateFaqsFromKnowledge(tenant);

      res.json({
        success: true,
        faqs: generatedFaqs,
        count: generatedFaqs.length
      });
    } catch (err: any) {
      console.error('[POST /api/faqs/generate] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // Stripe Billing API
  // ============================================

  // Get subscription tiers and current tenant subscription
  app.get('/api/billing/tiers', async (_req, res) => {
    try {
      const { SUBSCRIPTION_TIERS, isStripeConfigured } = await import('./services/stripe');
      res.json({
        configured: isStripeConfigured(),
        tiers: Object.entries(SUBSCRIPTION_TIERS).map(([key, tier]) => ({
          id: key,
          name: tier.name,
          price: tier.price,
          features: tier.features,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get tenant subscription status
  app.get('/api/billing/:tenantId/subscription', async (req, res) => {
    try {
      const tenantId = parseInt(req.params.tenantId, 10);
      if (isNaN(tenantId)) {
        return res.status(400).json({ error: 'Invalid tenant ID' });
      }

      const { getSubscription, checkCallLimit } = await import('./services/stripe');
      const subscription = await getSubscription(tenantId);
      const limits = await checkCallLimit(tenantId);

      if (!subscription) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      res.json({ ...subscription, limits });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create checkout session for subscription upgrade
  app.post('/api/billing/:tenantId/checkout', async (req, res) => {
    try {
      const tenantId = parseInt(req.params.tenantId, 10);
      if (isNaN(tenantId)) {
        return res.status(400).json({ error: 'Invalid tenant ID' });
      }

      const { tier } = req.body;
      if (!tier) {
        return res.status(400).json({ error: 'Tier is required' });
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const successUrl = `${baseUrl}/tenants?billing=success`;
      const cancelUrl = `${baseUrl}/tenants?billing=canceled`;

      const { createCheckoutSession } = await import('./services/stripe');
      const result = await createCheckoutSession(tenantId, tier, successUrl, cancelUrl);

      if ('error' in result) {
        return res.status(400).json({ error: result.error });
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create billing portal session
  app.post('/api/billing/:tenantId/portal', async (req, res) => {
    try {
      const tenantId = parseInt(req.params.tenantId, 10);
      if (isNaN(tenantId)) {
        return res.status(400).json({ error: 'Invalid tenant ID' });
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const returnUrl = `${baseUrl}/tenants`;

      const { createPortalSession } = await import('./services/stripe');
      const result = await createPortalSession(tenantId, returnUrl);

      if ('error' in result) {
        return res.status(400).json({ error: result.error });
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cancel subscription
  app.post('/api/billing/:tenantId/cancel', async (req, res) => {
    try {
      const tenantId = parseInt(req.params.tenantId, 10);
      if (isNaN(tenantId)) {
        return res.status(400).json({ error: 'Invalid tenant ID' });
      }

      const { cancelSubscription } = await import('./services/stripe');
      const result = await cancelSubscription(tenantId);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stripe webhook endpoint (raw body required)
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        return res.status(400).json({ error: 'Missing stripe-signature header' });
      }

      const { handleWebhook } = await import('./services/stripe');
      const result = await handleWebhook(req.body, signature);

      if (!result.received) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error('[Stripe Webhook] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  const httpServer = createServer(app);
  
  // Initialize WebSocket server
  initializeWebSocket(httpServer);

  return httpServer;
}
