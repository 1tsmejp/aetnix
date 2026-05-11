import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { addTicketComment, createTicket, createTicketConversion, getTicketDashboard, getTicketDetail, listTickets, updateTicket } from '../services/ticket-service.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const tickets = await listTickets(req.auth, req.query ?? {});
  res.json({ tickets });
}));

router.get('/dashboard', asyncHandler(async (req, res) => {
  const dashboard = await getTicketDashboard(req.auth);
  res.json(dashboard);
}));

router.post('/', asyncHandler(async (req, res) => {
  const payload = normalizeTicketCreatePayload(req.body ?? {});
  if (!payload.subject || !payload.description) {
    throw badRequest('subject and description are required');
  }
  const ticket = await createTicket(req.auth, payload);
  res.status(201).json({ ticket });
}));

router.get('/:ticketId', asyncHandler(async (req, res) => {
  const detail = await getTicketDetail(req.auth, req.params.ticketId);
  res.json(detail);
}));

router.patch('/:ticketId', asyncHandler(async (req, res) => {
  const ticket = await updateTicket(req.auth, req.params.ticketId, normalizeTicketUpdatePayload(req.body ?? {}));
  res.json({ ticket });
}));

router.post('/:ticketId/comments', asyncHandler(async (req, res) => {
  const payload = normalizeTicketCommentPayload(req.body ?? {});
  if (!payload.body) {
    throw badRequest('body is required');
  }
  const comment = await addTicketComment(req.auth, req.params.ticketId, payload);
  res.status(201).json({ comment });
}));

router.post('/:ticketId/conversions', asyncHandler(async (req, res) => {
  const payload = normalizeTicketConversionPayload(req.body ?? {});
  if (!payload.conversionType) {
    throw badRequest('conversionType is required');
  }
  const conversion = await createTicketConversion(req.auth, req.params.ticketId, payload);
  res.status(201).json({ conversion });
}));

export default router;

function normalizeTicketCreatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['customerTenantId', 'siteId', 'assetId', 'status', 'priority', 'source', 'category', 'subject', 'description', 'requesterName', 'requesterEmail', 'requesterUserId', 'assignedUserId', 'metadata']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }
  return normalizeTicketPayloadFields(body);
}

function normalizeTicketUpdatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['status', 'priority', 'category', 'subject', 'description', 'siteId', 'assetId', 'assignedUserId', 'requesterName', 'requesterEmail', 'metadata']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }
  return normalizeTicketPayloadFields(body);
}

function normalizeTicketCommentPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['body', 'status', 'isCustomerVisible', 'metadata']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }
  return {
    body: typeof body.body === 'string' ? body.body.trim() : '',
    status: typeof body.status === 'string' && body.status.trim() ? body.status.trim() : undefined,
    isCustomerVisible: typeof body.isCustomerVisible === 'boolean' ? body.isCustomerVisible : undefined,
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : undefined,
  };
}

function normalizeTicketConversionPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['conversionType', 'status', 'targetRef', 'summary', 'metadata']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }
  return {
    conversionType: typeof body.conversionType === 'string' ? body.conversionType.trim() : '',
    status: typeof body.status === 'string' && body.status.trim() ? body.status.trim() : undefined,
    targetRef: typeof body.targetRef === 'string' && body.targetRef.trim() ? body.targetRef.trim() : undefined,
    summary: typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : undefined,
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : undefined,
  };
}

function normalizeTicketPayloadFields(body) {
  const normalized = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      normalized[key] = trimmed === '' ? undefined : trimmed;
    } else {
      normalized[key] = value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'assignedUserId') && normalized.assignedUserId == null) {
    normalized.assignedUserId = null;
  }
  return normalized;
}
