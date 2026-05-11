import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { createOperator, getAdminOverview, resetOperatorPassword, updateAdminSettings, updateOperator } from '../services/admin-service.js';

const router = Router();
router.use(requireAuth);

router.get('/overview', asyncHandler(async (req, res) => {
  const overview = await getAdminOverview(req.auth);
  res.json(overview);
}));

router.patch('/settings', asyncHandler(async (req, res) => {
  const settings = await updateAdminSettings(req.auth, normalizeSettingsPayload(req.body ?? {}));
  res.json({ settings });
}));

router.post('/users', asyncHandler(async (req, res) => {
  const payload = normalizeOperatorPayload(req.body ?? {}, { requirePassword: true });
  const member = await createOperator(req.auth, payload);
  res.status(201).json({ member });
}));

router.patch('/users/:userId', asyncHandler(async (req, res) => {
  const payload = normalizeOperatorPayload(req.body ?? {}, { requirePassword: false, allowPartial: true });
  const member = await updateOperator(req.auth, req.params.userId, payload);
  res.json({ member });
}));

router.post('/users/:userId/password', asyncHandler(async (req, res) => {
  const { password } = normalizePasswordResetPayload(req.body ?? {});
  const result = await resetOperatorPassword(req.auth, req.params.userId, password);
  res.json(result);
}));

export default router;

function normalizeSettingsPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  return body;
}

function normalizePasswordResetPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['password']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) throw badRequest('password is required');
  return { password };
}

function normalizeOperatorPayload(body, { requirePassword = false, allowPartial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['email', 'password', 'fullName', 'role', 'status']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }

  const payload = {
    email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : '',
    password: typeof body.password === 'string' ? body.password : '',
    fullName: typeof body.fullName === 'string' ? body.fullName.trim() : '',
    role: typeof body.role === 'string' ? body.role.trim() : '',
    status: typeof body.status === 'string' ? body.status.trim() : '',
  };

  if (!allowPartial) {
    if (!payload.email || !payload.fullName || !payload.role) throw badRequest('email, fullName, and role are required');
    if (requirePassword && !payload.password) throw badRequest('password is required');
  }

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== ''));
}
