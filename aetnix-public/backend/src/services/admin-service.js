import { badRequest, forbidden } from '../lib/errors.js';
import { roleSummary, roles as allRoles } from '../lib/rbac.js';
import { query } from './db.js';
import { setUserPassword } from './auth-service.js';
import { addTenantMember, listTenantMembers, updateTenantMember } from './tenant-service.js';
import { getProjectCatalog } from './project-service.js';

const MSP_ADMIN_ROLES = ['platform_admin', 'msp_admin'];
const MSP_MEMBER_ROLES = ['msp_admin', 'project_manager', 'technician', 'installer'];

export async function getAdminOverview(actor) {
  assertAdmin(actor);
  const tenantId = actor.activeTenant?.tenantId;
  if (!tenantId) throw forbidden('No active tenant');

  const [tenantResult, customersResult, members, ticketStatsResult, projectStatsResult] = await Promise.all([
    query('SELECT id, tenant_key, display_name, kind, status, settings, created_at, approved_at FROM tenants WHERE id = $1', [tenantId]),
    query(`SELECT id, tenant_key, display_name, status, approved_at, created_at FROM tenants WHERE parent_tenant_id = $1 AND kind = 'customer' ORDER BY display_name ASC`, [tenantId]),
    listTenantMembers(actor, tenantId),
    query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open,
         COUNT(*) FILTER (WHERE assigned_user_id IS NULL AND status NOT IN ('resolved', 'closed'))::int AS unassigned,
         COUNT(*) FILTER (WHERE status = 'pending_customer')::int AS pending_customer,
         COUNT(*) FILTER (WHERE status = 'pending_vendor')::int AS pending_vendor
       FROM tickets
       WHERE tenant_id = $1`,
      [tenantId]
    ),
    query(
      `SELECT
         COUNT(*)::int AS projects,
         COALESCE(SUM(open_job_count), 0)::int AS open_jobs,
         COUNT(*) FILTER (WHERE priority IN ('high', 'urgent'))::int AS high_priority_projects
       FROM (
         SELECT p.id, p.priority,
           COALESCE((SELECT COUNT(*) FROM project_jobs pj WHERE pj.project_id = p.id AND pj.status NOT IN ('completed', 'cancelled')), 0) AS open_job_count
         FROM projects p
         WHERE p.tenant_id = $1
       ) stats`,
      [tenantId]
    ),
  ]);

  const tenant = tenantResult.rows[0];
  return {
    tenant: {
      id: tenant.id,
      tenantKey: tenant.tenant_key,
      displayName: tenant.display_name,
      kind: tenant.kind,
      status: tenant.status,
      createdAt: tenant.created_at,
      approvedAt: tenant.approved_at,
      settings: buildEffectiveSettings(tenant.settings ?? {}),
    },
    roles: allRoles.map((role) => roleSummary(role)),
    operatorRoles: MSP_MEMBER_ROLES.map((role) => roleSummary(role)),
    customers: customersResult.rows.map((row) => ({
      id: row.id,
      tenantKey: row.tenant_key,
      displayName: row.display_name,
      status: row.status,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
    })),
    members,
    stats: {
      ticketing: ticketStatsResult.rows[0],
      delivery: projectStatsResult.rows[0],
    },
    projectCatalog: getProjectCatalog(actor),
  };
}

export async function updateAdminSettings(actor, patch = {}) {
  assertAdmin(actor);
  const tenantId = actor.activeTenant?.tenantId;
  if (!tenantId) throw forbidden('No active tenant');
  const sanitized = sanitizeSettingsPatch(patch);
  const existingResult = await query('SELECT settings FROM tenants WHERE id = $1', [tenantId]);
  const current = existingResult.rows[0]?.settings ?? {};
  const next = mergeSettings(current, sanitized);
  const result = await query('UPDATE tenants SET settings = $2::jsonb WHERE id = $1 RETURNING settings', [tenantId, JSON.stringify(next)]);
  return buildEffectiveSettings(result.rows[0]?.settings ?? next);
}

export async function createOperator(actor, input) {
  assertAdmin(actor);
  if (!MSP_MEMBER_ROLES.includes(input.role)) throw badRequest('role must be an MSP operator role');
  return addTenantMember({ tenantId: actor.activeTenant.tenantId, ...input });
}

export async function updateOperator(actor, userId, input) {
  assertAdmin(actor);
  return updateTenantMember({ actor, tenantId: actor.activeTenant.tenantId, userId, ...input });
}

export async function resetOperatorPassword(actor, userId, password) {
  assertAdmin(actor);
  const tenantId = actor.activeTenant?.tenantId;
  if (!tenantId) throw forbidden('No active tenant');
  if (!password) throw badRequest('password is required');

  const membershipResult = await query(
    `SELECT tm.user_id
     FROM tenant_memberships tm
     WHERE tm.tenant_id = $1 AND tm.user_id = $2`,
    [tenantId, userId]
  );
  if (membershipResult.rowCount === 0) throw forbidden('Operator is outside the active tenant scope');

  await setUserPassword({ userId, password });
  return { userId, reset: true };
}

function assertAdmin(actor) {
  const role = actor.activeTenant?.role ?? actor.user.platformRole;
  if (!MSP_ADMIN_ROLES.includes(role) && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Admin access required');
  }
}

function sanitizeSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw badRequest('Invalid settings payload');
  const allowedSections = new Set(['platformDefaults', 'serviceDefaults', 'helpdeskDefaults', 'workflowDefaults', 'branding']);
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowedSections.has(key)) throw badRequest(`Unexpected settings section: ${key}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${key} must be an object`);
    next[key] = value;
  }
  return next;
}

function buildEffectiveSettings(settings) {
  return mergeSettings(defaultSettings(), settings ?? {});
}

function mergeSettings(base, patch) {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = { ...(base[key] ?? {}), ...value };
    } else {
      next[key] = value;
    }
  }
  return next;
}

function defaultSettings() {
  return {
    platformDefaults: {
      defaultCustomerStatus: 'active',
      defaultProjectPriority: 'normal',
      requireAssetOnTicket: false,
      defaultTicketSource: 'portal',
    },
    serviceDefaults: {
      defaultProjectType: 'service',
      defaultDispatchColumn: 'dispatch',
      defaultServiceBoardView: 'service-board',
      autoAssignMode: 'manual',
    },
    helpdeskDefaults: {
      defaultTicketPriority: 'normal',
      defaultTicketStatus: 'new',
      customerVisibilityDefault: true,
      staleAfterHours: 24,
    },
    workflowDefaults: {
      serviceTemplate: 'break-fix',
      installationTemplate: 'camera-rollout',
      internalTemplate: '',
      myWorkMode: 'assigned-only',
    },
    branding: {
      brandName: 'AETNIX',
      product: 'Aetnix Command',
      shell: 'Aetnix Operations Shell',
      eyebrow: 'Aetnix // MSP + Ops',
      authLabel: 'Aetnix control plane',
      supportLabel: 'MSP command center',
      sidebarFooter: 'Operate customers, assets, projects, and tickets from one sharp shell.',
      headerLogoUrl: '',
    },
  };
}
