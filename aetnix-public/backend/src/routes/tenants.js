import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { addTenantMember, createCustomerTenantWithAdmin, createTenant, listTenantMembers, listTenantsVisibleTo } from '../services/tenant-service.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const tenants = await listTenantsVisibleTo(req.auth);
  res.json({ tenants });
}));

router.post('/', asyncHandler(async (req, res) => {
  if (req.auth.user.platformRole !== 'platform_admin') throw forbidden('Only platform admins can create top-level MSP tenants');
  const { tenantKey, displayName, kind, parentTenantId } = req.body ?? {};
  if (!tenantKey || !displayName || !kind) throw badRequest('tenantKey, displayName, and kind are required');
  const tenant = await createTenant({ tenantKey, displayName, kind, parentTenantId });
  res.status(201).json({ tenant });
}));

router.post('/customer', asyncHandler(async (req, res) => {
  const actorRole = req.auth.activeTenant?.role;
  if (!['platform_admin', 'msp_admin', 'project_manager'].includes(actorRole) && req.auth.user.platformRole !== 'platform_admin') {
    throw forbidden('Only MSP-side admins/managers can create customer tenants');
  }
  const { tenantKey, displayName } = normalizeCustomerCreatePayload(req.body ?? {});
  const mspTenantId = req.auth.activeTenant?.tenantId;
  const payload = await createCustomerTenantWithAdmin({ mspTenantId, tenantKey, displayName });
  res.status(201).json(payload);
}));

router.get('/:tenantId/members', asyncHandler(async (req, res) => {
  const members = await listTenantMembers(req.auth, req.params.tenantId);
  res.json({ members });
}));

router.post('/:tenantId/members', asyncHandler(async (req, res) => {
  const actorRole = req.auth.activeTenant?.role;
  if (!['platform_admin', 'msp_admin'].includes(actorRole) && req.auth.user.platformRole !== 'platform_admin') throw forbidden('Only admins can add tenant members');
  const { email, password, fullName, role } = normalizeTenantMemberPayload(req.body ?? {});
  if (!email || !password || !fullName || !role) throw badRequest('email, password, fullName, and role are required');
  const member = await addTenantMember({ tenantId: req.params.tenantId, email, password, fullName, role });
  res.status(201).json({ member });
}));

export default router;

function normalizeCustomerCreatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['tenantKey', 'displayName']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }
  const tenantKey = typeof body.tenantKey === 'string' ? body.tenantKey.trim().toLowerCase() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!tenantKey || !displayName) throw badRequest('tenantKey and displayName are required');
  if (!/^[a-z0-9-]+$/.test(tenantKey)) throw badRequest('tenantKey must contain only lowercase letters, numbers, and hyphens');
  return { tenantKey, displayName };
}

function normalizeTenantMemberPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['email', 'password', 'fullName', 'role']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }
  const payload = {
    email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : '',
    password: typeof body.password === 'string' ? body.password : '',
    fullName: typeof body.fullName === 'string' ? body.fullName.trim() : '',
    role: typeof body.role === 'string' ? body.role.trim() : '',
  };
  if (!['customer_admin', 'customer_user'].includes(payload.role)) {
    throw badRequest('role must be customer_admin or customer_user');
  }
  return payload;
}
