import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import tenantRouter from './routes/tenants.js';
import projectRouter from './routes/projects.js';
import customerRouter from './routes/customers.js';
import assetRouter from './routes/assets.js';
import monitoringRouter from './routes/monitoring.js';
import ticketRouter from './routes/tickets.js';
import adminRouter from './routes/admin.js';
import { runOfflineSweep } from './services/monitoring-service.js';

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.json({
    name: env.platformName,
    status: 'online',
    phase: 'phase-7-project-boards',
  });
});

app.use(env.apiPrefix, healthRouter);
app.use(`${env.apiPrefix}/v1/auth`, authRouter);
app.use(`${env.apiPrefix}/v1/tenants`, tenantRouter);
app.use(`${env.apiPrefix}/v1/projects`, projectRouter);
app.use(`${env.apiPrefix}/v1/customers`, customerRouter);
app.use(`${env.apiPrefix}/v1/assets`, assetRouter);
app.use(`${env.apiPrefix}/v1/monitoring`, monitoringRouter);
app.use(`${env.apiPrefix}/v1/tickets`, ticketRouter);
app.use(`${env.apiPrefix}/v1/admin`, adminRouter);

app.use((error, _req, res, _next) => {
  const status = error.status ?? 500;
  res.status(status).json({
    error: error.message ?? 'Internal server error',
    details: error.details ?? null,
  });
});

app.listen(env.port, () => {
  console.log(`Backend listening on port ${env.port}`);
});

const monitoringSweep = setInterval(async () => {
  try {
    const result = await runOfflineSweep();
    if (result.checkedAssets > 0) {
      console.log(`Monitoring sweep checked ${result.checkedAssets} assets`);
    }
  } catch (error) {
    console.error('Monitoring sweep failed', error.message);
  }
}, env.monitoringSweepIntervalMs);

monitoringSweep.unref?.();
