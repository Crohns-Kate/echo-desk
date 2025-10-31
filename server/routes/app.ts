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
}
