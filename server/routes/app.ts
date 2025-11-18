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

  // Alerts
  app.get('/api/alerts', async (req: Request, res: Response) => {
    try {
      const alerts = await storage.listAlerts();
      res.json(alerts);
    } catch (error) {
      console.error('List alerts error:', error);
      res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  });

  app.get('/api/alerts/recent', async (req: Request, res: Response) => {
    try {
      const alerts = await storage.listAlerts(undefined, 5);
      res.json(alerts);
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
      const allAlerts = await storage.listAlerts(call.tenantId, 50);
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
          possibleIssues: []
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
        console.log('[EMAIL-COLLECT] Stored email from web form:', email, 'for call:', callSid);

        // Try to update Cliniko immediately if patient exists
        try {
          const { findPatientByPhone } = await import('../services/cliniko');
          const { updateClinikoPatient } = await import('../integrations/cliniko');

          if (call.fromNumber && updateClinikoPatient) {
            const patient = await findPatientByPhone(call.fromNumber);
            if (patient && patient.id && (!patient.email || patient.email === '')) {
              console.log('[EMAIL-COLLECT] Updating Cliniko patient immediately:', patient.id);
              await updateClinikoPatient(patient.id, { email: email.toLowerCase() });
              console.log('[EMAIL-COLLECT] ✅ Cliniko patient updated with email');
            }
          }
        } catch (clinikoErr) {
          console.warn('[EMAIL-COLLECT] Could not update Cliniko immediately (will sync on booking):', clinikoErr);
        }
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
        console.log('[NAME-VERIFY] Stored name from web form:', fullName, 'for call:', callSid);

        // Try to update Cliniko immediately if patient exists
        try {
          const { findPatientByPhone } = await import('../services/cliniko');
          const { updateClinikoPatient } = await import('../integrations/cliniko');

          if (call.fromNumber && updateClinikoPatient) {
            const patient = await findPatientByPhone(call.fromNumber);
            if (patient && patient.id) {
              console.log('[NAME-VERIFY] Updating Cliniko patient immediately:', patient.id);
              const updateData: any = { first_name: firstName.trim() };
              if (lastName && lastName.trim()) {
                updateData.last_name = lastName.trim();
              }
              await updateClinikoPatient(patient.id, updateData);
              console.log('[NAME-VERIFY] ✅ Cliniko patient updated with name');
            }
          }
        } catch (clinikoErr) {
          console.warn('[NAME-VERIFY] Could not update Cliniko immediately (will sync on booking):', clinikoErr);
        }
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
        const { findPatientByPhone } = await import('../services/cliniko');
        const { updateClinikoPatient } = await import('../integrations/cliniko');

        if (call.fromNumber && updateClinikoPatient) {
          const patient = await findPatientByPhone(call.fromNumber);
          if (patient && patient.id) {
            console.log('[VERIFY-DETAILS] Updating Cliniko patient immediately:', patient.id);

            const clinikoUpdate: any = {};
            if (firstName && firstName.trim()) clinikoUpdate.first_name = firstName.trim();
            if (lastName && lastName.trim()) clinikoUpdate.last_name = lastName.trim();
            if (email && email.trim()) clinikoUpdate.email = email.toLowerCase();
            if (dateOfBirth && dateOfBirth.trim()) clinikoUpdate.date_of_birth = dateOfBirth.trim();

            if (Object.keys(clinikoUpdate).length > 0) {
              await updateClinikoPatient(patient.id, clinikoUpdate);
              console.log('[VERIFY-DETAILS] ✅ Cliniko patient updated with verified details');
            }
          }
        }
      } catch (clinikoErr) {
        console.warn('[VERIFY-DETAILS] Could not update Cliniko immediately (will sync on booking):', clinikoErr);
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
