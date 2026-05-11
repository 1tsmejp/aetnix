import { Router } from 'express';
import { asyncHandler, pickRequestMeta } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { bootstrapPlatform, changeOwnPassword, getPlatformMeta, login, revokeSession } from '../services/auth-service.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/bootstrap/status', asyncHandler(async (_req, res) => {
  const meta = await getPlatformMeta();
  res.json({
    bootstrapped: meta.platformAdminCount > 0,
    ...meta,
  });
}));

router.post('/bootstrap', asyncHandler(async (req, res) => {
  const { companyName, tenantKey, adminEmail, adminPassword, adminName } = req.body ?? {};

  assertFields({ companyName, tenantKey, adminEmail, adminPassword, adminName });

  const profile = await bootstrapPlatform({ companyName, tenantKey, adminEmail, adminPassword, adminName });
  const session = await login({ email: adminEmail, password: adminPassword, tenantKey, meta: pickRequestMeta(req) });

  res.status(201).json({
    message: 'Platform bootstrap complete',
    profile,
    session,
  });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password, tenantKey } = req.body ?? {};
  if (!email || !password) {
    throw badRequest('Email and password are required');
  }

  const session = await login({ email, password, tenantKey, meta: pickRequestMeta(req) });
  res.json(session);
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({
    user: req.auth.user,
    activeTenant: req.auth.activeTenant,
    memberships: req.auth.memberships,
    session: {
      id: req.auth.session.id,
      expiresAt: req.auth.session.expires_at,
    },
  });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await revokeSession(req.auth.session.id);
  res.status(204).send();
}));

router.post('/account/password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body ?? {};
  if (!currentPassword || !newPassword || !confirmPassword) throw badRequest('currentPassword, newPassword, and confirmPassword are required');
  if (newPassword !== confirmPassword) throw badRequest('New password and confirmation must match');
  const result = await changeOwnPassword({ actor: req.auth, currentPassword, newPassword });
  res.json({ message: 'Password changed. Please sign in again.', ...result });
}));

function assertFields(fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (!value || !String(value).trim()) {
      throw badRequest(`${key} is required`);
    }
  }
}

export default router;
