import { Request, Response, Express } from 'express';
import { Pool } from 'pg';
import { runMigrations } from '../migrations';
import { env } from '../utils/env';

export function registerMigrateAdmin(app: Express, dbPool: Pool) {
  // Middleware to validate admin token
  const requireAdminToken = (req: Request, res: Response, next: Function) => {
    const token = req.query.token as string;
    const adminToken = env.ADMIN_TOKEN;

    if (!adminToken) {
      return res.status(500).json({
        error: 'ADMIN_TOKEN not configured',
        message: 'Set ADMIN_TOKEN environment variable to enable admin endpoints'
      });
    }

    if (token !== adminToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid admin token'
      });
    }

    next();
  };

  // Dry run - shows what would be executed
  app.get('/__admin/migrate/dry-run', requireAdminToken, async (req: Request, res: Response) => {
    try {
      console.log('[ADMIN] Migration dry-run requested');
      
      const result = await runMigrations({
        client: dbPool,
        dryRun: true
      });

      res.json({
        success: true,
        dryRun: true,
        result: {
          wouldExecute: result.executed,
          wouldSkip: result.skipped,
          totalSteps: result.executed.length + result.skipped.length
        },
        message: 'Dry run complete. No changes were made to the database.'
      });
    } catch (error: any) {
      console.error('[ADMIN] Dry-run error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Execute migrations
  app.post('/__admin/migrate', requireAdminToken, async (req: Request, res: Response) => {
    try {
      console.log('[ADMIN] Migration execution requested');
      
      const startTime = Date.now();
      const result = await runMigrations({
        client: dbPool,
        dryRun: false
      });
      const totalTime = Date.now() - startTime;

      res.json({
        success: true,
        result: {
          executed: result.executed,
          skipped: result.skipped,
          timings: result.timings,
          totalTime: `${totalTime}ms`
        },
        message: `Successfully executed ${result.executed.length} migration(s)`
      });
    } catch (error: any) {
      console.error('[ADMIN] Migration execution error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // Health check
  app.get('/__admin/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: env.NODE_ENV,
      migrationsEnabled: env.RUN_MIGRATIONS_ON_BOOT
    });
  });
}
