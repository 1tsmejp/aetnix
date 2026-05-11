import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { addAssetRelationship, createAsset, getAssetDetail, listAssets, recordAssetHealth, registerAgent, updateAsset } from '../services/asset-service.js';
import { createAssetEnrollment, enrollAgent, getAssetAgentDetail, getAssetEnrollmentPackage } from '../services/agent-enrollment-service.js';

const router = Router();

router.post('/register-agent', asyncHandler(async (req, res) => {
  const registration = await registerAgent(req.body ?? {});
  res.status(201).json(registration);
}));

router.post('/enroll-agent', asyncHandler(async (req, res) => {
  const registration = await enrollAgent(req.body ?? {});
  res.status(201).json(registration);
}));

router.post('/health', asyncHandler(async (req, res) => {
  if (!req.body?.status) {
    throw badRequest('status is required');
  }

  const snapshot = await recordAssetHealth(req.body ?? {});
  res.status(201).json(snapshot);
}));

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const assets = await listAssets(req.auth, req.query ?? {});
  res.json({ assets });
}));

router.post('/', asyncHandler(async (req, res) => {
  const asset = await createAsset(req.auth, normalizeAssetCreatePayload(req.body ?? {}));
  res.status(201).json({ asset });
}));

router.get('/:assetId', asyncHandler(async (req, res) => {
  const detail = await getAssetDetail(req.auth, req.params.assetId);
  res.json(detail);
}));

router.patch('/:assetId', asyncHandler(async (req, res) => {
  const asset = await updateAsset(req.auth, req.params.assetId, normalizeAssetUpdatePayload(req.body ?? {}));
  res.json({ asset });
}));

router.get('/:assetId/agent', asyncHandler(async (req, res) => {
  const detail = await getAssetAgentDetail(req.auth, req.params.assetId);
  res.json(detail);
}));

router.post('/:assetId/agent-enrollments', asyncHandler(async (req, res) => {
  const payload = normalizeAgentEnrollmentPayload(req.body ?? {});
  const result = await createAssetEnrollment(req.auth, req.params.assetId, payload);
  res.status(201).json(result);
}));

router.post('/:assetId/agent-package', asyncHandler(async (req, res) => {
  const payload = normalizeAgentEnrollmentPayload(req.body ?? {});
  const result = await getAssetEnrollmentPackage(req.auth, req.params.assetId, payload);
  res.status(201).json(result);
}));

router.post('/:assetId/relationships', asyncHandler(async (req, res) => {
  const payload = normalizeAssetRelationshipPayload(req.body ?? {});
  const { relationType, externalRef } = payload;
  if (!relationType || !externalRef) {
    throw badRequest('relationType and externalRef are required');
  }

  const relationship = await addAssetRelationship(req.auth, req.params.assetId, payload);
  res.status(201).json({ relationship });
}));

export default router;

function normalizeAssetCreatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['customerTenantId', 'siteId', 'assetName', 'assetType', 'status', 'hostname', 'primaryIp', 'manufacturer', 'model', 'serialNumber', 'operatingSystem', 'warrantyExpiresAt', 'lifecycleState', 'notes']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }

  const payload = {
    customerTenantId: typeof body.customerTenantId === 'string' ? body.customerTenantId.trim() : '',
    siteId: typeof body.siteId === 'string' && body.siteId.trim() ? body.siteId.trim() : null,
    assetName: typeof body.assetName === 'string' ? body.assetName.trim() : '',
    assetType: typeof body.assetType === 'string' && body.assetType.trim() ? body.assetType.trim() : undefined,
    status: typeof body.status === 'string' && body.status.trim() ? body.status.trim() : undefined,
    hostname: typeof body.hostname === 'string' && body.hostname.trim() ? body.hostname.trim() : undefined,
    primaryIp: typeof body.primaryIp === 'string' && body.primaryIp.trim() ? body.primaryIp.trim() : undefined,
    manufacturer: typeof body.manufacturer === 'string' && body.manufacturer.trim() ? body.manufacturer.trim() : undefined,
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
    serialNumber: typeof body.serialNumber === 'string' && body.serialNumber.trim() ? body.serialNumber.trim() : undefined,
    operatingSystem: typeof body.operatingSystem === 'string' && body.operatingSystem.trim() ? body.operatingSystem.trim() : undefined,
    warrantyExpiresAt: normalizeOptionalIsoDate(body.warrantyExpiresAt),
    lifecycleState: typeof body.lifecycleState === 'string' && body.lifecycleState.trim() ? body.lifecycleState.trim() : undefined,
    notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined,
  };

  if (!payload.customerTenantId || !payload.assetName) throw badRequest('customerTenantId and assetName are required');
  return payload;
}

function normalizeAssetRelationshipPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['relationType', 'externalRef', 'label', 'metadata']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }

  return {
    relationType: typeof body.relationType === 'string' ? body.relationType.trim() : '',
    externalRef: typeof body.externalRef === 'string' ? body.externalRef.trim() : '',
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : undefined,
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : undefined,
  };
}

function normalizeAssetUpdatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['siteId', 'assetName', 'assetType', 'status', 'hostname', 'primaryIp', 'manufacturer', 'model', 'serialNumber', 'operatingSystem', 'warrantyExpiresAt', 'lifecycleState', 'notes']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }

  return {
    siteId: Object.prototype.hasOwnProperty.call(body, 'siteId') ? normalizeOptionalString(body.siteId) : undefined,
    assetName: Object.prototype.hasOwnProperty.call(body, 'assetName') ? normalizeOptionalString(body.assetName) : undefined,
    assetType: Object.prototype.hasOwnProperty.call(body, 'assetType') ? normalizeOptionalString(body.assetType) : undefined,
    status: Object.prototype.hasOwnProperty.call(body, 'status') ? normalizeOptionalString(body.status) : undefined,
    hostname: Object.prototype.hasOwnProperty.call(body, 'hostname') ? normalizeOptionalString(body.hostname) : undefined,
    primaryIp: Object.prototype.hasOwnProperty.call(body, 'primaryIp') ? normalizeOptionalString(body.primaryIp) : undefined,
    manufacturer: Object.prototype.hasOwnProperty.call(body, 'manufacturer') ? normalizeOptionalString(body.manufacturer) : undefined,
    model: Object.prototype.hasOwnProperty.call(body, 'model') ? normalizeOptionalString(body.model) : undefined,
    serialNumber: Object.prototype.hasOwnProperty.call(body, 'serialNumber') ? normalizeOptionalString(body.serialNumber) : undefined,
    operatingSystem: Object.prototype.hasOwnProperty.call(body, 'operatingSystem') ? normalizeOptionalString(body.operatingSystem) : undefined,
    warrantyExpiresAt: Object.prototype.hasOwnProperty.call(body, 'warrantyExpiresAt') ? normalizeOptionalIsoDate(body.warrantyExpiresAt) : undefined,
    lifecycleState: Object.prototype.hasOwnProperty.call(body, 'lifecycleState') ? normalizeOptionalString(body.lifecycleState) : undefined,
    notes: Object.prototype.hasOwnProperty.call(body, 'notes') ? normalizeOptionalString(body.notes) : undefined,
  };
}

function normalizeOptionalString(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw badRequest('Expected string value');
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalIsoDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('warrantyExpiresAt must be a string');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw badRequest('warrantyExpiresAt must be a valid date');
  return parsed.toISOString();
}

function normalizeAgentEnrollmentPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['platform', 'packageKind', 'expiresInMinutes', 'label', 'apiBaseUrl', 'metadata']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }

  return {
    platform: typeof body.platform === 'string' && body.platform.trim() ? body.platform.trim() : undefined,
    packageKind: typeof body.packageKind === 'string' && body.packageKind.trim() ? body.packageKind.trim() : undefined,
    expiresInMinutes: body.expiresInMinutes == null ? undefined : Number(body.expiresInMinutes),
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : undefined,
    apiBaseUrl: typeof body.apiBaseUrl === 'string' && body.apiBaseUrl.trim() ? body.apiBaseUrl.trim() : undefined,
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : undefined,
  };
}
