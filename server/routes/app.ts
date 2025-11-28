import { Request, Response, Express } from 'express';
import { storage } from '../storage';
import { BUILD } from '../utils/version';
import { emitAlertDismissed } from '../services/websocket';

export function registerApp(app: Express) {
  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Version info
  app.get('/api/version', (req: Request, res: Response) => {
    res.json(BUILD);
  });

  // Comprehensive system health check for admin
  app.get('/api/admin/system-health', async (req: Request, res: Response) => {
    const healthChecks: Record<string, { status: 'ok' | 'warning' | 'error'; message?: string; latency?: number }> = {};
    const startTime = Date.now();

    // 1. Database connectivity
    try {
      const dbStart = Date.now();
      const tenant = await storage.getTenant('default');
      healthChecks.database = {
        status: tenant ? 'ok' : 'warning',
        message: tenant ? 'Connected' : 'Default tenant not found',
        latency: Date.now() - dbStart
      };
    } catch (err: any) {
      healthChecks.database = { status: 'error', message: err.message };
    }

    // 2. Environment configuration
    const requiredEnvVars = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'DATABASE_URL'];
    const optionalEnvVars = ['CLINIKO_API_KEY', 'ASSEMBLYAI_API_KEY', 'STRIPE_SECRET_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];

    const missingRequired = requiredEnvVars.filter(v => !process.env[v]);
    const missingOptional = optionalEnvVars.filter(v => !process.env[v]);

    healthChecks.environment = {
      status: missingRequired.length === 0 ? 'ok' : 'error',
      message: missingRequired.length === 0
        ? `All required vars set, ${missingOptional.length} optional missing`
        : `Missing: ${missingRequired.join(', ')}`
    };

    // 3. External services availability check
    const services = {
      twilio: !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN,
      cliniko: !!process.env.CLINIKO_API_KEY,
      transcription: !!process.env.ASSEMBLYAI_API_KEY,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      llm: !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY
    };

    healthChecks.services = {
      status: services.twilio ? 'ok' : 'error',
      message: `Twilio: ${services.twilio ? '✓' : '✗'}, Cliniko: ${services.cliniko ? '✓' : '✗'}, Transcription: ${services.transcription ? '✓' : '✗'}, LLM: ${services.llm ? '✓' : '✗'}, Stripe: ${services.stripe ? '✓' : '✗'}`
    };

    // 4. Memory usage
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memPercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
    healthChecks.memory = {
      status: memPercent > 90 ? 'warning' : 'ok',
      message: `${memMB}MB used (${memPercent}% of heap)`
    };

    // 5. Recent activity stats
    try {
      const stats = await storage.getStats();
      healthChecks.activity = {
        status: 'ok',
        message: `${stats.todayCalls || 0} calls today, ${stats.pendingAlerts || 0} pending alerts`
      };
    } catch (err: any) {
      healthChecks.activity = { status: 'warning', message: 'Could not fetch stats' };
    }

    // Overall status
    const statuses = Object.values(healthChecks).map(c => c.status);
    const overallStatus = statuses.includes('error') ? 'error' : statuses.includes('warning') ? 'warning' : 'ok';

    res.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checkDuration: Date.now() - startTime,
      checks: healthChecks,
      version: BUILD
    });
  });

  // Debug endpoint to check environment configuration
  app.get('/api/debug/config', (req: Request, res: Response) => {
    const dotEnvValue = 'https://echo-desk-mbjltd70.replit.app'; // What .env file says
    const actualValue = process.env.PUBLIC_BASE_URL || 'NOT SET';
    const recordingEnabled = (process.env.CALL_RECORDING_ENABLED ?? 'true') === 'true';
    const transcriptionEnabled = (process.env.TRANSCRIPTION_ENABLED ?? 'true') === 'true';

    const isCorrect = actualValue === dotEnvValue;

    res.json({
      status: isCorrect ? 'ok' : 'error',
      issue: isCorrect ? null : 'PUBLIC_BASE_URL is being overridden by Replit Secrets',
      recording: {
        enabled: recordingEnabled,
        transcriptionEnabled: transcriptionEnabled,
        publicBaseUrl: {
          expected: dotEnvValue,
          actual: actualValue,
          correct: isCorrect,
          override: !isCorrect ? 'Replit Secret is overriding .env file - DELETE the PUBLIC_BASE_URL secret!' : null
        },
        callbacks: {
          recording: `${actualValue}/api/voice/recording-status`,
          transcription: `${actualValue}/api/voice/transcription-status`
        }
      },
      fix: !isCorrect ? [
        '1. Open Replit Secrets (🔒 icon in left sidebar)',
        '2. Find PUBLIC_BASE_URL',
        '3. DELETE it or change it to: ' + dotEnvValue,
        '4. Restart the server',
        '5. Make a test call'
      ] : null
    });
  });

  // Stats
  app.get('/api/stats', async (req: Request, res: Response) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      console.error('Stats error:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Calls
  app.get('/api/calls', async (req: Request, res: Response) => {
    try {
      const calls = await storage.listCalls();
      res.json(calls);
    } catch (error) {
      console.error('List calls error:', error);
      res.status(500).json({ error: 'Failed to fetch calls' });
    }
  });

  app.get('/api/calls/recent', async (req: Request, res: Response) => {
    try {
      const calls = await storage.listCalls(undefined, 5);
      res.json(calls);
    } catch (error) {
      console.error('Recent calls error:', error);
      res.status(500).json({ error: 'Failed to fetch recent calls' });
    }
  });

  app.get('/api/calls/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const call = await storage.getCallById(id);
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }
      res.json(call);
    } catch (error) {
      console.error('Get call error:', error);
      res.status(500).json({ error: 'Failed to fetch call' });
    }
  });

  // Quality Insights
  app.get('/api/quality/insights', async (req: Request, res: Response) => {
    try {
      const { getQualityInsights } = await import('../services/communication-quality');
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const insights = await getQualityInsights(undefined, limit);
      res.json(insights);
    } catch (error: any) {
      console.error('Quality insights error:', error);
      res.status(500).json({ error: 'Failed to fetch quality insights', details: error.message });
    }
  });

  app.get('/api/quality/analyze/:callSid', async (req: Request, res: Response) => {
    try {
      const { analyzeCallQuality } = await import('../services/communication-quality');
      const callSid = req.params.callSid;
      const call = await storage.getCallByCallSid(callSid);

      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }

      if (!call.transcript || call.transcript.length < 10) {
        return res.status(400).json({ error: 'No transcript available for this call' });
      }

      const metrics = await analyzeCallQuality(call);
      if (!metrics) {
        return res.status(500).json({ error: 'Quality analysis failed' });
      }

      res.json(metrics);
    } catch (error: any) {
      console.error('Call quality analysis error:', error);
      res.status(500).json({ error: 'Failed to analyze call quality', details: error.message });
    }
  });

  // QA Reports
  app.get('/api/qa/report/:callId', async (req: Request, res: Response) => {
    try {
      const callId = req.params.callId;

      // callId can be either numeric ID or callSid
      let call;
      if (/^\d+$/.test(callId)) {
        // Numeric ID
        call = await storage.getCallById(parseInt(callId));
      } else {
        // callSid
        call = await storage.getCallByCallSid(callId);
      }

      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }

      if (!call.callSid) {
        return res.status(400).json({ error: 'Call has no SID' });
      }

      // Try to get existing QA report
      const existingReport = await storage.getQaReportByCallSid(call.callSid);
      if (existingReport) {
        return res.json(existingReport);
      }

      // If no report exists, generate one on-the-fly
      if (!call.transcript || call.transcript.length < 10) {
        return res.status(400).json({ error: 'No transcript available for this call' });
      }

      const { generateQAReport } = await import('../services/qa-engine');
      const report = await generateQAReport(call);
      if (!report) {
        return res.status(500).json({ error: 'Failed to generate QA report' });
      }

      // Save the generated report
      const savedReport = await storage.saveQaReport({
        callSid: report.callSid,
        callLogId: call.id,
        identityDetectionScore: report.identityDetectionScore,
        patientClassificationScore: report.patientClassificationScore,
        emailCaptureScore: report.emailCaptureScore,
        appointmentTypeScore: report.appointmentTypeScore,
        promptClarityScore: report.promptClarityScore,
        overallScore: report.overallScore,
        issues: report.issues as any,
      });

      res.json(savedReport);
    } catch (error: any) {
      console.error('QA report error:', error);
      res.status(500).json({ error: 'Failed to fetch QA report', details: error.message });
    }
  });

  app.get('/api/qa/reports', async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const reports = await storage.listQaReports(limit);
      res.json(reports);
    } catch (error: any) {
      console.error('List QA reports error:', error);
      res.status(500).json({ error: 'Failed to fetch QA reports', details: error.message });
    }
  });

  // Alerts
  app.get('/api/alerts', async (req: Request, res: Response) => {
    try {
      const alerts = await storage.listAlerts();

      // Enrich alerts with recording and transcript from call logs
      const enrichedAlerts = await Promise.all(
        alerts.map(async (alert) => {
          let recordingUrl: string | null = null;
          let recordingSid: string | null = null;
          let transcript: string | null = null;
          let callSid: string | null = null;
          let fromNumber: string | null = null;

          // Get callSid from payload
          const payload = alert.payload as any;
          if (payload?.callSid) {
            callSid = payload.callSid;
            try {
              const call = await storage.getCallByCallSid(callSid as string);
              if (call) {
                recordingUrl = call.recordingUrl || null;
                recordingSid = call.recordingSid || null;
                transcript = call.transcript || null;
                fromNumber = call.fromNumber || null;
              }
            } catch (err) {
              console.error('Error fetching call for alert:', err);
            }
          }

          return {
            ...alert,
            recordingUrl,
            recordingSid,
            transcript,
            callSid,
            fromNumber,
          };
        })
      );

      res.json(enrichedAlerts);
    } catch (error) {
      console.error('List alerts error:', error);
      res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  });

  app.get('/api/alerts/recent', async (req: Request, res: Response) => {
    try {
      const alerts = await storage.listAlerts(undefined, 5);

      // Enrich alerts with recording and transcript from call logs
      const enrichedAlerts = await Promise.all(
        alerts.map(async (alert) => {
          let recordingUrl: string | null = null;
          let recordingSid: string | null = null;
          let transcript: string | null = null;
          let callSid: string | null = null;

          const payload = alert.payload as any;
          if (payload?.callSid) {
            callSid = payload.callSid;
            try {
              const call = await storage.getCallByCallSid(callSid as string);
              if (call) {
                recordingUrl = call.recordingUrl || null;
                recordingSid = call.recordingSid || null;
                transcript = call.transcript || null;
              }
            } catch (err) {
              console.error('Error fetching call for alert:', err);
            }
          }

          return {
            ...alert,
            recordingUrl,
            recordingSid,
            transcript,
            callSid,
          };
        })
      );

      res.json(enrichedAlerts);
    } catch (error) {
      console.error('Recent alerts error:', error);
      res.status(500).json({ error: 'Failed to fetch recent alerts' });
    }
  });

  app.patch('/api/alerts/:id/dismiss', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const alert = await storage.dismissAlert(id);
      if (!alert) {
        return res.status(404).json({ error: 'Alert not found' });
      }
      
      // Emit WebSocket event for dismissed alert
      emitAlertDismissed(alert);
      
      res.json(alert);
    } catch (error) {
      console.error('Dismiss alert error:', error);
      res.status(500).json({ error: 'Failed to dismiss alert' });
    }
  });

  // Tenants
  app.get('/api/tenants', async (req: Request, res: Response) => {
    try {
      const tenants = await storage.listTenants();
      res.json(tenants);
    } catch (error) {
      console.error('List tenants error:', error);
      res.status(500).json({ error: 'Failed to fetch tenants' });
    }
  });

  // AI Diagnostic endpoint - comprehensive call analysis data
  app.get('/api/ai/analyze/:callSid?', async (req: Request, res: Response) => {
    try {
      const callSid = req.params.callSid;
      let call;

      if (callSid) {
        // Analyze specific call
        call = await storage.getCallByCallSid(callSid);
        if (!call) {
          return res.status(404).json({ error: 'Call not found' });
        }
      } else {
        // Analyze most recent call
        const calls = await storage.listCalls(undefined, 1);
        if (calls.length === 0) {
          return res.status(404).json({ error: 'No calls found' });
        }
        call = calls[0];
      }

      // Fetch conversation context
      let conversationContext = null;
      if (call.conversationId) {
        const conversation = await storage.getConversation(call.conversationId);
        conversationContext = conversation?.context || null;
      }

      // Fetch related alerts
      const allAlerts = await storage.listAlerts(call.tenantId ?? undefined, 50);
      const relatedAlerts = allAlerts.filter(alert =>
        alert.conversationId === call.conversationId ||
        (alert.payload as any)?.callSid === call.callSid
      );

      // Build comprehensive analysis data
      const analysisData = {
        // Call metadata
        callSid: call.callSid,
        fromNumber: call.fromNumber,
        toNumber: call.toNumber,
        duration: call.duration,
        createdAt: call.createdAt,

        // Intent and outcome
        intent: call.intent,
        summary: call.summary,

        // Transcript
        transcript: call.transcript || null,
        transcriptAvailable: !!call.transcript,

        // Recording
        recordingUrl: call.recordingUrl || null,
        recordingSid: call.recordingSid || null,
        recordingStatus: call.recordingStatus || null,
        recordingAvailable: !!call.recordingUrl,

        // Conversation context (FSM state, patient data)
        context: conversationContext,

        // Patient mode analysis
        patientMode: (conversationContext as any)?.patientMode || null,
        patientId: (conversationContext as any)?.patientId || null,
        existingPatientId: (conversationContext as any)?.existingPatientId || null,
        existingPatientName: (conversationContext as any)?.existingPatientName || null,
        fullName: (conversationContext as any)?.fullName || null,
        firstName: (conversationContext as any)?.firstName || null,
        email: (conversationContext as any)?.email || null,

        // Flags
        isNewPatient: (conversationContext as any)?.isNewPatient || false,
        isReturning: (conversationContext as any)?.isReturning || false,
        identityConfirmed: (conversationContext as any)?.identityConfirmed || false,

        // Related alerts/errors
        alerts: relatedAlerts.map(alert => ({
          id: alert.id,
          reason: alert.reason,
          payload: alert.payload,
          status: alert.status,
          createdAt: alert.createdAt
        })),

        // Analysis hints
        analysisHints: {
          hasTranscript: !!call.transcript,
          hasRecording: !!call.recordingUrl,
          hasContext: !!conversationContext,
          hasAlerts: relatedAlerts.length > 0,
          patientModeSet: !!(conversationContext as any)?.patientMode,
          possibleIssues: [] as string[]
        }
      };

      // Add automatic issue detection
      const hints = analysisData.analysisHints.possibleIssues;

      if (analysisData.patientMode === "new" && analysisData.patientId === analysisData.existingPatientId) {
        hints.push("⚠️ CRITICAL: New patient mode but patientId equals existingPatientId");
      }

      if (!analysisData.transcript && analysisData.recordingAvailable) {
        hints.push("⚠️ Recording available but transcript missing");
      }

      if (analysisData.email && !analysisData.email.includes('@')) {
        hints.push("⚠️ Email appears invalid (missing @)");
      }

      if (analysisData.intent === "booking" && !analysisData.summary?.includes("booked")) {
        hints.push("⚠️ Intent is 'booking' but summary doesn't confirm success");
      }

      if (relatedAlerts.length > 0) {
        hints.push(`⚠️ ${relatedAlerts.length} alert(s) associated with this call`);
      }

      res.json(analysisData);
    } catch (error) {
      console.error('AI analysis error:', error);
      res.status(500).json({ error: 'Failed to fetch analysis data' });
    }
  });

  // AI Diagnostic endpoint - analyze multiple recent calls
  app.get('/api/ai/analyze-recent/:limit?', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.params.limit || '5');
      const calls = await storage.listCalls(undefined, Math.min(limit, 50));

      const analyses = await Promise.all(calls.map(async (call) => {
        // Fetch conversation context
        let conversationContext = null;
        if (call.conversationId) {
          const conversation = await storage.getConversation(call.conversationId);
          conversationContext = conversation?.context || null;
        }

        return {
          callSid: call.callSid,
          fromNumber: call.fromNumber,
          createdAt: call.createdAt,
          intent: call.intent,
          summary: call.summary,
          hasTranscript: !!call.transcript,
          hasRecording: !!call.recordingUrl,
          patientMode: (conversationContext as any)?.patientMode || null,
          patientId: (conversationContext as any)?.patientId || null,
          existingPatientId: (conversationContext as any)?.existingPatientId || null,
        };
      }));

      res.json({
        totalCalls: analyses.length,
        calls: analyses
      });
    } catch (error) {
      console.error('AI recent analysis error:', error);
      res.status(500).json({ error: 'Failed to fetch recent analysis data' });
    }
  });

  // Email collection endpoint - accepts email submission via web form
  app.post('/api/email-collect', async (req: Request, res: Response) => {
    try {
      const { callSid, email } = req.body;

      if (!callSid || !email) {
        return res.status(400).json({ error: 'Missing callSid or email' });
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      // Find call and update conversation context
      const call = await storage.getCallByCallSid(callSid);
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }

      if (call.conversationId) {
        const conversation = await storage.getConversation(call.conversationId);
        const existingContext = (conversation?.context as any) || {};
        await storage.updateConversation(call.conversationId, {
          context: { ...existingContext, email: email.toLowerCase(), emailCollectedViaSMS: true }
        });
        console.log('[EMAIL-COLLECT] ✅ Stored email from web form:', email, 'for call:', callSid);
        console.log('[EMAIL-COLLECT] Email will be synced to Cliniko during appointment booking');

        // IMPORTANT: Do NOT update Cliniko here!
        // Reason: We don't know if this is a new patient or returning patient.
        // - If NEW patient: we need to CREATE a new patient record, not update existing
        // - If RETURNING patient: we can update the existing record
        // The booking logic (server/routes/voice.ts) handles this correctly.
        // Updating here would cause BUG-001: overwriting existing patients' data!
      }

      res.json({ success: true, message: 'Email saved successfully!' });
    } catch (error) {
      console.error('Email collection error:', error);
      res.status(500).json({ error: 'Failed to save email' });
    }
  });

  // Name verification endpoint - accepts name submission via web form
  app.post('/api/name-verify', async (req: Request, res: Response) => {
    try {
      const { callSid, firstName, lastName } = req.body;

      if (!callSid || !firstName) {
        return res.status(400).json({ error: 'Missing callSid or firstName' });
      }

      // Basic validation
      if (firstName.trim().length < 1) {
        return res.status(400).json({ error: 'First name is required' });
      }

      const fullName = lastName
        ? `${firstName.trim()} ${lastName.trim()}`
        : firstName.trim();

      // Find call and update conversation context
      const call = await storage.getCallByCallSid(callSid);
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }

      if (call.conversationId) {
        const conversation = await storage.getConversation(call.conversationId);
        const existingContext = (conversation?.context as any) || {};
        await storage.updateConversation(call.conversationId, {
          context: {
            ...existingContext,
            fullName,
            firstName: firstName.trim(),
            nameVerifiedViaSMS: true
          }
        });
        console.log('[NAME-VERIFY] ✅ Stored name from web form:', fullName, 'for call:', callSid);
        console.log('[NAME-VERIFY] Name will be synced to Cliniko during appointment booking');

        // IMPORTANT: Do NOT update Cliniko here!
        // Reason: We don't know if this is a new patient or returning patient.
        // - If NEW patient: we need to CREATE a new patient record, not update existing
        // - If RETURNING patient: we can update the existing record
        // The booking logic (server/routes/voice.ts) handles this correctly.
        //
        // 🚨 CRITICAL BUG PREVENTED (BUG-001):
        // If we updated Cliniko here by phone lookup, we would OVERWRITE the existing
        // patient's name when a NEW patient calls from the same phone number!
        // Example: John Smith has phone +61401234567
        //          Jane Doe calls from same phone as new patient
        //          Jane fills form with "Jane Doe"
        //          If we updated here: John Smith would be renamed to "Jane Doe"! ❌
      }

      res.json({ success: true, message: 'Name saved successfully!' });
    } catch (error) {
      console.error('Name verification error:', error);
      res.status(500).json({ error: 'Failed to save name' });
    }
  });

  // Post-call data verification endpoint - comprehensive data update
  app.post('/api/verify-details', async (req: Request, res: Response) => {
    try {
      const { callSid, firstName, lastName, email, dateOfBirth, preferredPhone } = req.body;

      if (!callSid) {
        return res.status(400).json({ error: 'Missing callSid' });
      }

      // Find call
      const call = await storage.getCallByCallSid(callSid);
      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }

      if (!call.conversationId) {
        return res.status(400).json({ error: 'No conversation associated with call' });
      }

      const conversation = await storage.getConversation(call.conversationId);
      const existingContext = (conversation?.context as any) || {};

      // Build update object
      const updates: any = { ...existingContext };

      if (firstName && firstName.trim()) {
        updates.firstName = firstName.trim();
        const fullName = lastName && lastName.trim()
          ? `${firstName.trim()} ${lastName.trim()}`
          : firstName.trim();
        updates.fullName = fullName;
        updates.nameVerifiedViaSMS = true;
      }

      if (email && email.trim()) {
        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        updates.email = email.toLowerCase();
        updates.emailCollectedViaSMS = true;
      }

      if (dateOfBirth && dateOfBirth.trim()) {
        updates.dateOfBirth = dateOfBirth.trim();
      }

      if (preferredPhone && preferredPhone.trim()) {
        updates.preferredPhone = preferredPhone.trim();
        updates.phoneConfirmed = true;
      }

      updates.detailsVerifiedPostCall = true;
      updates.detailsVerifiedAt = new Date().toISOString();

      // Update conversation context
      await storage.updateConversation(call.conversationId, { context: updates });
      console.log('[VERIFY-DETAILS] Updated details from post-call form for call:', callSid);

      // Try to update Cliniko immediately if patient exists
      try {
        // Get tenant to access tenant-specific Cliniko credentials
        if (!call.tenantId) {
          console.log('[VERIFY-DETAILS] No tenant ID, skipping Cliniko update');
          return res.json({ success: true });
        }
        const tenant = await storage.getTenantById(call.tenantId);
        if (!tenant) {
          console.log('[VERIFY-DETAILS] No tenant found, skipping Cliniko update');
        } else if (!tenant.clinikoApiKeyEncrypted) {
          console.log('[VERIFY-DETAILS] Tenant has no Cliniko API key configured, skipping update');
        } else {
          // Decrypt tenant's Cliniko credentials
          const { decrypt } = await import('../services/tenantResolver');
          const clinikoApiKey = decrypt(tenant.clinikoApiKeyEncrypted);
          const clinikoShard = tenant.clinikoShard || 'au1';
          const clinikoBaseUrl = `https://api.${clinikoShard}.cliniko.com/v1`;

          console.log('[VERIFY-DETAILS] Using tenant-specific Cliniko credentials for:', tenant.slug);

          // Create tenant-specific headers
          const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(clinikoApiKey + ':').toString('base64')}`,
            'Accept': 'application/json'
          };

          if (call.fromNumber) {
            console.log('[VERIFY-DETAILS] Looking up patient by phone:', call.fromNumber);

            // Sanitize phone number
            const { sanitizePhoneE164AU } = await import('../integrations/cliniko');
            const phone = sanitizePhoneE164AU(call.fromNumber);

            if (!phone) {
              console.log('[VERIFY-DETAILS] Invalid phone format:', call.fromNumber);
            } else {
              // Search for patient by phone
              let patient = null;
              try {
                // Try E.164 format first
                const url = `${clinikoBaseUrl}/patients?phone_number=${encodeURIComponent(phone)}`;
                const res = await fetch(url, { headers });
                if (res.ok) {
                  const data = await res.json();
                  const list = Array.isArray(data?.patients) ? data.patients : [];
                  patient = list[0] || null;

                  // Try local format (0...) as fallback
                  if (!patient && phone.startsWith('+61')) {
                    const localFormat = '0' + phone.slice(3);
                    const localUrl = `${clinikoBaseUrl}/patients?phone_number=${encodeURIComponent(localFormat)}`;
                    const localRes = await fetch(localUrl, { headers });
                    if (localRes.ok) {
                      const localData = await localRes.json();
                      const localList = Array.isArray(localData?.patients) ? localData.patients : [];
                      patient = localList[0] || null;
                    }
                  }
                }
              } catch (searchErr: any) {
                console.error('[VERIFY-DETAILS] Patient search failed:', searchErr.message);
              }

              if (patient && patient.id) {
                console.log('[VERIFY-DETAILS] Found patient in Cliniko:', patient.id, '-', patient.first_name, patient.last_name);

                const clinikoUpdate: any = {};
                if (firstName && firstName.trim()) clinikoUpdate.first_name = firstName.trim();
                if (lastName && lastName.trim()) clinikoUpdate.last_name = lastName.trim();
                if (email && email.trim()) {
                  const { sanitizeEmail } = await import('../integrations/cliniko');
                  const sanitizedEmail = sanitizeEmail(email);
                  if (sanitizedEmail) clinikoUpdate.email = sanitizedEmail;
                }
                if (dateOfBirth && dateOfBirth.trim()) clinikoUpdate.date_of_birth = dateOfBirth.trim();

                console.log('[VERIFY-DETAILS] Attempting Cliniko update with:', clinikoUpdate);

                if (Object.keys(clinikoUpdate).length > 0) {
                  const updateUrl = `${clinikoBaseUrl}/patients/${patient.id}`;
                  const updateRes = await fetch(updateUrl, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify(clinikoUpdate)
                  });

                  if (updateRes.ok) {
                    const result = await updateRes.json();
                    console.log('[VERIFY-DETAILS] ✅ Cliniko patient updated successfully:', result.id);
                  } else {
                    const errorText = await updateRes.text();
                    console.error('[VERIFY-DETAILS] ❌ Cliniko update failed:', updateRes.status, errorText);
                  }
                } else {
                  console.log('[VERIFY-DETAILS] No fields to update in Cliniko');
                }
              } else {
                console.log('[VERIFY-DETAILS] ⚠️  Patient not found in Cliniko by phone:', call.fromNumber);
                console.log('[VERIFY-DETAILS] Patient will be created/updated during next appointment booking');
              }
            }
          }
        }
      } catch (clinikoErr: any) {
        console.error('[VERIFY-DETAILS] ❌ Cliniko update failed:', clinikoErr.message);
        console.error('[VERIFY-DETAILS] Stack:', clinikoErr.stack);
        console.warn('[VERIFY-DETAILS] Data saved locally - will sync to Cliniko on next booking');
      }

      res.json({ success: true, message: 'Details saved successfully!' });
    } catch (error) {
      console.error('Verify details error:', error);
      res.status(500).json({ error: 'Failed to save details' });
    }
  });

  // Get call details for verification form (helps pre-populate form)
  app.get('/api/call-details/:callSid', async (req: Request, res: Response) => {
    try {
      const callSid = req.params.callSid;
      const call = await storage.getCallByCallSid(callSid);

      if (!call) {
        return res.status(404).json({ error: 'Call not found' });
      }

      let context: any = {};
      if (call.conversationId) {
        const conversation = await storage.getConversation(call.conversationId);
        context = (conversation?.context as any) || {};
      }

      // Return sanitized data for form pre-population
      res.json({
        callSid: call.callSid,
        fromNumber: call.fromNumber,
        firstName: context.firstName || '',
        fullName: context.fullName || '',
        email: context.email || '',
        dateOfBirth: context.dateOfBirth || '',
        preferredPhone: context.preferredPhone || call.fromNumber || '',
        appointmentBooked: !!context.appointmentId
      });
    } catch (error) {
      console.error('Get call details error:', error);
      res.status(500).json({ error: 'Failed to fetch call details' });
    }
  });
}
