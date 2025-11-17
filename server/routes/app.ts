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
}
