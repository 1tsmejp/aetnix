import { Router } from 'express';
import { query } from '../services/db.js';
import { roles } from '../lib/rbac.js';
import { getPlatformMeta } from '../services/auth-service.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/health', async (_req, res) => {
  try {
    const [dbResult, bootstrap, alertResult, staleResult] = await Promise.all([
      query('SELECT NOW() AS now'),
      getPlatformMeta(),
      query("SELECT COUNT(*)::int AS open_alerts FROM monitoring_alerts WHERE state = 'open'").catch(() => ({ rows: [{ open_alerts: 0 }] })),
      query("SELECT COUNT(*)::int AS stale_agents FROM asset_agents WHERE last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '2 minutes'").catch(() => ({ rows: [{ stale_agents: 0 }] })),
    ]);

    res.json({
      status: 'ok',
      service: 'backend',
      database: 'connected',
      timestamp: new Date().toISOString(),
      dbTime: dbResult.rows[0]?.now,
      monitoring: {
        openAlerts: alertResult.rows[0]?.open_alerts ?? 0,
        staleAgents: staleResult.rows[0]?.stale_agents ?? 0,
      },
      bootstrap,
    });
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      service: 'backend',
      database: 'unavailable',
      error: error.message,
    });
  }
});

router.get('/v1/platform/meta', async (_req, res) => {
  const bootstrap = await getPlatformMeta();

  res.json({
    product: env.platformName,
    phase: 'phase-4-monitoring-agent',
    multiTenantReady: true,
    authReady: true,
    modules: ['frontend', 'backend', 'postgres', 'agent-test', 'customer-ops', 'asset-ops', 'monitoring', 'alerts'],
    requiredRoles: roles,
    bootstrap,
  });
});

export default router;
