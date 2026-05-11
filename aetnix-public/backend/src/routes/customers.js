import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { createCustomerSite, getCustomerDashboard, getCustomerDetail, listCustomerSites, listCustomers } from '../services/customer-service.js';

const router = Router();

router.use(requireAuth);

router.get('/dashboard', asyncHandler(async (req, res) => {
  const dashboard = await getCustomerDashboard(req.auth);
  res.json({ dashboard });
}));

router.get('/', asyncHandler(async (req, res) => {
  const customers = await listCustomers(req.auth);
  res.json({ customers });
}));

router.get('/:customerTenantId', asyncHandler(async (req, res) => {
  const detail = await getCustomerDetail(req.auth, req.params.customerTenantId);
  res.json(detail);
}));

router.get('/:customerTenantId/sites', asyncHandler(async (req, res) => {
  const sites = await listCustomerSites(req.auth, req.params.customerTenantId);
  res.json({ sites });
}));

router.post('/:customerTenantId/sites', asyncHandler(async (req, res) => {
  const payload = normalizeSiteCreatePayload(req.body ?? {});
  if (!payload.name) {
    throw badRequest('name is required');
  }

  const site = await createCustomerSite(req.auth, req.params.customerTenantId, payload);
  res.status(201).json({ site });
}));

export default router;

function normalizeSiteCreatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['name', 'siteCode', 'addressLine1', 'addressLine2', 'city', 'stateRegion', 'postalCode', 'countryCode', 'timezone', 'primaryContactName', 'primaryContactEmail', 'primaryContactPhone', 'notes']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }
  const normalized = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
  if (typeof normalized.countryCode === 'string' && normalized.countryCode) normalized.countryCode = normalized.countryCode.toUpperCase();
  if (typeof normalized.primaryContactEmail === 'string' && normalized.primaryContactEmail) normalized.primaryContactEmail = normalized.primaryContactEmail.toLowerCase();
  return normalized;
}
