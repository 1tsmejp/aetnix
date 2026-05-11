import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createProject,
  createProjectJob,
  getProjectCatalog,
  getProjectForActor,
  getProjectWorkspace,
  listJobQueue,
  listProjectJobs,
  listProjects,
  updateProject,
  updateProjectJob,
} from '../services/project-service.js';

const router = Router();
router.use(requireAuth);

router.get('/meta/catalog', asyncHandler(async (req, res) => {
  res.json({ catalog: getProjectCatalog(req.auth) });
}));

router.get('/jobs/queue', asyncHandler(async (req, res) => {
  const jobs = await listJobQueue(req.auth, {
    assigned: req.query.assigned,
    projectType: req.query.projectType,
    status: req.query.status,
  });
  res.json({ jobs });
}));

router.get('/', asyncHandler(async (req, res) => {
  const projects = await listProjects(req.auth, {
    projectType: req.query.projectType,
    status: req.query.status,
    assigned: req.query.assigned,
  });
  res.json({ projects });
}));

router.post('/', asyncHandler(async (req, res) => {
  const payload = normalizeProjectCreatePayload(req.body ?? {});
  const project = await createProject(req.auth, payload);
  res.status(201).json({ project });
}));

router.get('/:projectId', asyncHandler(async (req, res) => {
  const project = await getProjectForActor(req.auth, req.params.projectId);
  res.json({ project });
}));

router.get('/:projectId/workspace', asyncHandler(async (req, res) => {
  const workspace = await getProjectWorkspace(req.auth, req.params.projectId);
  res.json(workspace);
}));

router.patch('/:projectId', asyncHandler(async (req, res) => {
  const project = await updateProject(req.auth, req.params.projectId, req.body ?? {});
  res.json({ project });
}));

router.get('/:projectId/jobs', asyncHandler(async (req, res) => {
  const jobs = await listProjectJobs(req.auth, req.params.projectId);
  res.json({ jobs });
}));

router.post('/:projectId/jobs', asyncHandler(async (req, res) => {
  const payload = normalizeProjectJobPayload(req.body ?? {}, { partial: false });
  const { jobType, title } = payload;
  if (!jobType || !title) throw badRequest('jobType and title are required');
  const job = await createProjectJob(req.auth, req.params.projectId, payload);
  res.status(201).json({ job });
}));

router.patch('/:projectId/jobs/:jobId', asyncHandler(async (req, res) => {
  const job = await updateProjectJob(req.auth, req.params.projectId, req.params.jobId, normalizeProjectJobPayload(req.body ?? {}, { partial: true }));
  res.json({ job });
}));

export default router;

function normalizeDateInput(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^\d{4}-\d{2}-\d{2}$/);
    if (match) return match[0];
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return value;
}

function normalizeProjectCreatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['customerTenantId', 'siteId', 'ownerUserId', 'name', 'projectType', 'status', 'priority', 'summary', 'startDate', 'dueDate', 'metadata']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }

  const payload = {
    customerTenantId: typeof body.customerTenantId === 'string' && body.customerTenantId.trim() ? body.customerTenantId.trim() : null,
    siteId: typeof body.siteId === 'string' && body.siteId.trim() ? body.siteId.trim() : null,
    ownerUserId: typeof body.ownerUserId === 'string' && body.ownerUserId.trim() ? body.ownerUserId.trim() : null,
    name: typeof body.name === 'string' ? body.name.trim() : '',
    projectType: typeof body.projectType === 'string' ? body.projectType.trim() : '',
    status: typeof body.status === 'string' && body.status.trim() ? body.status.trim() : undefined,
    priority: typeof body.priority === 'string' && body.priority.trim() ? body.priority.trim() : undefined,
    summary: typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : undefined,
    startDate: normalizeDateInput(body.startDate),
    dueDate: normalizeDateInput(body.dueDate),
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : undefined,
  };

  if (!payload.name || !payload.projectType) throw badRequest('name and projectType are required');
  if (payload.projectType !== 'internal' && !payload.customerTenantId) throw badRequest('customerTenantId is required for non-internal projects');
  if (body.startDate && !payload.startDate) throw badRequest('startDate must be a valid date');
  if (body.dueDate && !payload.dueDate) throw badRequest('dueDate must be a valid date');
  return payload;
}

function normalizeProjectJobPayload(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid request body');
  const allowed = new Set(['jobType', 'status', 'title', 'details', 'boardColumnKey', 'position', 'assignedUserId', 'dueAt', 'priority', 'labels', 'customerSiteId', 'relatedTicketId', 'relatedAssetId', 'checklist', 'comments', 'attachments', 'laborEntries', 'materialEntries', 'appendChecklistItem', 'appendComment', 'appendAttachment', 'appendLaborEntry', 'appendMaterialEntry']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw badRequest(`Unexpected field: ${key}`);
  }

  const normalizeText = (value) => {
    if (value == null) return value;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  const payload = {
    jobType: normalizeText(body.jobType),
    status: normalizeText(body.status),
    title: normalizeText(body.title),
    details: normalizeText(body.details),
    boardColumnKey: normalizeText(body.boardColumnKey),
    position: body.position == null || body.position === '' ? undefined : Number(body.position),
    assignedUserId: Object.prototype.hasOwnProperty.call(body, 'assignedUserId') ? (body.assignedUserId === null ? null : normalizeText(body.assignedUserId) ?? null) : undefined,
    dueAt: normalizeDateTimeInput(body.dueAt),
    priority: normalizeText(body.priority),
    labels: normalizeStructuredArray(body.labels, 'labels'),
    customerSiteId: Object.prototype.hasOwnProperty.call(body, 'customerSiteId') ? (body.customerSiteId === null ? null : normalizeText(body.customerSiteId) ?? null) : undefined,
    relatedTicketId: Object.prototype.hasOwnProperty.call(body, 'relatedTicketId') ? (body.relatedTicketId === null ? null : normalizeText(body.relatedTicketId) ?? null) : undefined,
    relatedAssetId: Object.prototype.hasOwnProperty.call(body, 'relatedAssetId') ? (body.relatedAssetId === null ? null : normalizeText(body.relatedAssetId) ?? null) : undefined,
    checklist: normalizeStructuredArray(body.checklist, 'checklist'),
    comments: normalizeStructuredArray(body.comments, 'comments'),
    attachments: normalizeStructuredArray(body.attachments, 'attachments'),
    laborEntries: normalizeStructuredArray(body.laborEntries, 'laborEntries'),
    materialEntries: normalizeStructuredArray(body.materialEntries, 'materialEntries'),
    appendChecklistItem: normalizeStructuredObject(body.appendChecklistItem, 'appendChecklistItem'),
    appendComment: normalizeStructuredObject(body.appendComment, 'appendComment'),
    appendAttachment: normalizeStructuredObject(body.appendAttachment, 'appendAttachment'),
    appendLaborEntry: normalizeStructuredObject(body.appendLaborEntry, 'appendLaborEntry'),
    appendMaterialEntry: normalizeStructuredObject(body.appendMaterialEntry, 'appendMaterialEntry'),
  };

  if (!partial) {
    if (!payload.jobType || !payload.title) throw badRequest('jobType and title are required');
  }

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function normalizeDateTimeInput(value) {
  if (value === null) return null;
  if (value === undefined || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest('dueAt must be a valid datetime');
  return date.toISOString();
}

function normalizeStructuredArray(value, fieldName) {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw badRequest(`${fieldName} must be an array`);
  return value;
}

function normalizeStructuredObject(value, fieldName) {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${fieldName} must be an object`);
  return value;
}
