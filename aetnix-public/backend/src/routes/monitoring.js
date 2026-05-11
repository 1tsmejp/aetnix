import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getMonitoringAssetDetail, ingestHeartbeat, listMonitoringAlerts, listMonitoringAssets } from '../services/monitoring-service.js';

const router = Router();

router.post('/heartbeat', asyncHandler(async (req, res) => {
  const payload = req.body ?? {};
  if (!payload.agentKey) throw badRequest('agentKey is required');
  const heartbeat = await ingestHeartbeat(payload);
  res.status(201).json(heartbeat);
}));

router.use(requireAuth);

router.get('/assets', asyncHandler(async (req, res) => {
  const assets = await listMonitoringAssets(req.auth);
  res.json({ assets });
}));

router.get('/assets/:assetId', asyncHandler(async (req, res) => {
  const detail = await getMonitoringAssetDetail(req.auth, req.params.assetId);
  res.json(detail);
}));

router.get('/alerts', asyncHandler(async (req, res) => {
  const alerts = await listMonitoringAlerts(req.auth, req.query ?? {});
  res.json({ alerts });
}));

export default router;
