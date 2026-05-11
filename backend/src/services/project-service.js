import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { roleHasPermission } from '../lib/rbac.js';
import { query, withTransaction } from './db.js';

const PROJECT_TYPES = new Set(['service', 'installation', 'internal']);
const PROJECT_STATUSES = new Set(['draft', 'planned', 'active', 'approved', 'completed', 'archived']);
const JOB_STATUSES = new Set(['queued', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

const PROJECT_PROFILES = {
  service: {
    key: 'service',
    label: 'Service',
    description: 'Break/fix, troubleshooting, recurring maintenance, monitoring-generated work, and technician dispatch.',
    boardColumns: [
      { key: 'intake', name: 'Intake', wipLimit: 12, metadata: { reportBucket: 'new', dispatch: false } },
      { key: 'triage', name: 'Triage', wipLimit: 10, metadata: { reportBucket: 'triage', dispatch: false } },
      { key: 'dispatch', name: 'Dispatch', wipLimit: 8, metadata: { reportBucket: 'dispatch', dispatch: true } },
      { key: 'onsite', name: 'On Site / Active', wipLimit: 8, metadata: { reportBucket: 'active', dispatch: true } },
      { key: 'waiting', name: 'Waiting / Follow-up', wipLimit: 10, metadata: { reportBucket: 'waiting', dispatch: false } },
      { key: 'done', name: 'Resolved', metadata: { reportBucket: 'resolved', dispatch: false } },
    ],
    projectStatuses: ['draft', 'planned', 'active', 'approved', 'completed', 'archived'],
    projectStatusLabels: { draft: 'Draft', planned: 'Queued', active: 'In Service', approved: 'Customer Approved', completed: 'Resolved', archived: 'Archived' },
    cardStatuses: ['queued', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled'],
    cardStatusLabels: { queued: 'Queued', scheduled: 'Scheduled', in_progress: 'Working', blocked: 'Waiting', completed: 'Resolved', cancelled: 'Cancelled' },
    templates: [
      { key: 'break-fix', name: 'Break / Fix Dispatch', project: { status: 'active', priority: 'high' }, card: { jobType: 'service', status: 'queued', priority: 'high', title: 'Diagnose reported issue', details: 'Capture symptoms, isolate cause, and restore service.' } },
      { key: 'monitoring-response', name: 'Monitoring Response', project: { status: 'active', priority: 'urgent' }, card: { jobType: 'service', status: 'queued', priority: 'urgent', title: 'Investigate monitoring alert', details: 'Validate alert, triage impact, and dispatch as needed.' } },
      { key: 'recurring-maintenance', name: 'Recurring Maintenance', project: { status: 'planned', priority: 'normal' }, card: { jobType: 'service', status: 'scheduled', priority: 'normal', title: 'Perform scheduled maintenance', details: 'Execute checklist, capture findings, and note follow-up work.' } },
    ],
    reports: [
      { key: 'sla', name: 'SLA / Response Watch', description: 'Open work, scheduled work, and overdue technician dispatch.' },
      { key: 'dispatch-load', name: 'Dispatch Load', description: 'Assignee spread and active field workload.' },
      { key: 'monitoring-followup', name: 'Monitoring Follow-up', description: 'Monitoring-linked items still waiting on action or customer reply.' },
    ],
    dashboards: [
      'Open service cards by stage',
      'Due now / overdue dispatch work',
      'Technician utilization and waiting work',
    ],
    permissions: {
      manageProject: ['platform_admin', 'msp_admin', 'project_manager'],
      manageCards: ['platform_admin', 'msp_admin', 'project_manager', 'technician'],
      dashboardAudience: ['platform_admin', 'msp_admin', 'project_manager', 'technician'],
    },
  },
  installation: {
    key: 'installation',
    label: 'Installation',
    description: 'Camera and access installs, network upgrades, server deployments, cabling, procurement, milestones, and sign-off.',
    boardColumns: [
      { key: 'scope', name: 'Scoping', wipLimit: 8, metadata: { reportBucket: 'scope', milestone: 'planning' } },
      { key: 'procurement', name: 'Procurement', wipLimit: 8, metadata: { reportBucket: 'procurement', milestone: 'ordering' } },
      { key: 'ready', name: 'Ready to Schedule', wipLimit: 8, metadata: { reportBucket: 'ready', milestone: 'scheduling' } },
      { key: 'field-work', name: 'Field Work', wipLimit: 8, metadata: { reportBucket: 'execution', milestone: 'execution' } },
      { key: 'qa', name: 'QA / Punch List', wipLimit: 8, metadata: { reportBucket: 'qa', milestone: 'qa' } },
      { key: 'signoff', name: 'Customer Sign-off', wipLimit: 6, metadata: { reportBucket: 'signoff', milestone: 'signoff' } },
      { key: 'done', name: 'Completed', metadata: { reportBucket: 'completed', milestone: 'closed' } },
    ],
    projectStatuses: ['draft', 'planned', 'active', 'approved', 'completed', 'archived'],
    projectStatusLabels: { draft: 'Draft', planned: 'Planned', active: 'In Install', approved: 'Signed Off', completed: 'Complete', archived: 'Archived' },
    cardStatuses: ['queued', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled'],
    cardStatusLabels: { queued: 'Backlog', scheduled: 'Scheduled', in_progress: 'In Progress', blocked: 'Blocked', completed: 'Done', cancelled: 'Cancelled' },
    templates: [
      { key: 'camera-rollout', name: 'Camera Rollout', project: { status: 'planned', priority: 'high' }, card: { jobType: 'installation', status: 'queued', priority: 'high', title: 'Verify scope and camera placements', details: 'Confirm counts, views, storage, uplinks, and permit requirements.' } },
      { key: 'access-control', name: 'Access Control Install', project: { status: 'planned', priority: 'high' }, card: { jobType: 'installation', status: 'queued', priority: 'high', title: 'Review door hardware and controller BOM', details: 'Validate locks, power, network drops, credentials, and cutover plan.' } },
      { key: 'network-upgrade', name: 'Network Upgrade', project: { status: 'planned', priority: 'normal' }, card: { jobType: 'installation', status: 'queued', priority: 'normal', title: 'Stage hardware and implementation plan', details: 'Order hardware, capture migration plan, and prepare maintenance window.' } },
    ],
    reports: [
      { key: 'milestones', name: 'Milestone Burnup', description: 'Scope, procurement, field execution, QA, and sign-off progress.' },
      { key: 'procurement', name: 'Procurement Watch', description: 'Material-dependent work and ordering bottlenecks.' },
      { key: 'signoff', name: 'Customer Sign-off Queue', description: 'Projects waiting on QA completion or formal customer acceptance.' },
    ],
    dashboards: [
      'Milestone progress and schedule health',
      'Procurement blockers and materials still outstanding',
      'Projects nearing QA and sign-off',
    ],
    permissions: {
      manageProject: ['platform_admin', 'msp_admin', 'project_manager'],
      manageCards: ['platform_admin', 'msp_admin', 'project_manager', 'installer'],
      dashboardAudience: ['platform_admin', 'msp_admin', 'project_manager', 'installer'],
    },
  },
  internal: {
    key: 'internal',
    label: 'Internal',
    description: 'Internal operating work and platform improvement efforts.',
    boardColumns: [
      { key: 'backlog', name: 'Backlog' },
      { key: 'ready', name: 'Ready' },
      { key: 'doing', name: 'Doing' },
      { key: 'blocked', name: 'Blocked' },
      { key: 'done', name: 'Done' },
    ],
    projectStatuses: ['draft', 'planned', 'active', 'approved', 'completed', 'archived'],
    projectStatusLabels: { draft: 'Draft', planned: 'Planned', active: 'Active', approved: 'Approved', completed: 'Completed', archived: 'Archived' },
    cardStatuses: ['queued', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled'],
    cardStatusLabels: { queued: 'Queued', scheduled: 'Scheduled', in_progress: 'In Progress', blocked: 'Blocked', completed: 'Completed', cancelled: 'Cancelled' },
    templates: [],
    reports: [{ key: 'flow', name: 'Flow', description: 'Backlog vs delivery pacing.' }],
    dashboards: ['Backlog, active work, and blockers'],
    permissions: {
      manageProject: ['platform_admin', 'msp_admin', 'project_manager'],
      manageCards: ['platform_admin', 'msp_admin', 'project_manager'],
      dashboardAudience: ['platform_admin', 'msp_admin', 'project_manager'],
    },
  },
};

export async function listProjects(actor, filters = {}) {
  if (!actor.activeTenant) return [];

  const params = [];
  const clauses = [];
  const isCustomerView = isCustomer(actor);

  if (isCustomerView) {
    params.push(actor.activeTenant.tenantId);
    clauses.push(`p.customer_tenant_id = $${params.length}`);
    clauses.push(`p.status = 'approved'`);
  } else {
    params.push(actor.activeTenant.tenantId);
    clauses.push(`p.tenant_id = $${params.length}`);
  }

  if (filters.projectType) {
    params.push(filters.projectType);
    clauses.push(`p.project_type = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`p.status = $${params.length}`);
  }

  if (filters.assigned === 'me' && actor.user?.id) {
    params.push(actor.user.id);
    clauses.push(`EXISTS (SELECT 1 FROM project_jobs pj_me WHERE pj_me.project_id = p.id AND pj_me.assigned_user_id = $${params.length})`);
  }

  const result = await query(
    `SELECT
      p.*,
      customer.display_name AS customer_name,
      customer.tenant_key AS customer_tenant_key,
      owner.full_name AS owner_name,
      owner.email AS owner_email,
      COALESCE(stats.job_count, 0) AS job_count,
      COALESCE(stats.open_job_count, 0) AS open_job_count,
      COALESCE(stats.completed_job_count, 0) AS completed_job_count,
      stats.next_due_at,
      stats.last_activity_at
     FROM projects p
     LEFT JOIN tenants customer ON customer.id = p.customer_tenant_id
     LEFT JOIN users owner ON owner.id = p.owner_user_id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) AS job_count,
         COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled')) AS open_job_count,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed_job_count,
         MIN(due_at) FILTER (WHERE status NOT IN ('completed', 'cancelled') AND due_at IS NOT NULL) AS next_due_at,
         MAX(updated_at) AS last_activity_at
       FROM project_jobs pj
       WHERE pj.project_id = p.id
     ) stats ON TRUE
     WHERE ${clauses.join(' AND ')}
     ORDER BY COALESCE(stats.last_activity_at, p.updated_at) DESC, p.created_at DESC`,
    params
  );

  return result.rows.map(mapProject);
}

export async function createProject(actor, input) {
  requirePermission(actor, 'project.manage');
  normalizeProjectType(input.projectType);
  normalizeProjectStatus(input.status ?? 'draft');
  normalizePriority(input.priority ?? 'normal');
  await assertProjectCustomer(actor, input.customerTenantId, input.projectType);
  if (input.siteId) await assertProjectSite(actor, input.customerTenantId, input.siteId, input.projectType);
  if (input.ownerUserId) await assertAssignableUser(actor, input.ownerUserId);

  return withTransaction(async (client) => {
    const projectResult = await client.query(
      `INSERT INTO projects (
        tenant_id, customer_tenant_id, site_id, owner_user_id, name, project_type, status, priority,
        summary, start_date, due_date, metadata, created_by_user_id, updated_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $13)
      RETURNING *`,
      [
        actor.activeTenant.tenantId,
        input.customerTenantId,
        input.siteId ?? null,
        input.ownerUserId ?? null,
        input.name.trim(),
        input.projectType,
        input.status ?? 'draft',
        input.priority ?? 'normal',
        input.summary?.trim() ?? null,
        input.startDate ?? null,
        input.dueDate ?? null,
        JSON.stringify(input.metadata ?? {}),
        actor.user.id,
      ]
    );

    const project = mapProject(projectResult.rows[0]);
    await seedDefaultBoardColumns(client, project.id, project.projectType);
    return project;
  });
}

export async function updateProject(actor, projectId, input) {
  requirePermission(actor, 'project.manage');
  const existing = await getProjectForActor(actor, projectId, { allowCustomerApprovedOnly: false });
  const nextProjectType = input.projectType ?? existing.projectType;
  const nextStatus = input.status ?? existing.status;
  const nextPriority = input.priority ?? existing.priority;

  normalizeProjectType(nextProjectType);
  normalizeProjectStatus(nextStatus);
  normalizePriority(nextPriority);
  await assertProjectCustomer(actor, input.customerTenantId ?? existing.customerTenantId, nextProjectType);
  if ((input.siteId ?? existing.siteId) && nextProjectType !== 'internal') {
    await assertProjectSite(actor, input.customerTenantId ?? existing.customerTenantId, input.siteId ?? existing.siteId, nextProjectType);
  }
  if (input.ownerUserId) await assertAssignableUser(actor, input.ownerUserId);

  const result = await query(
    `UPDATE projects
     SET customer_tenant_id = $2,
         site_id = $3,
         owner_user_id = $4,
         name = $5,
         project_type = $6,
         summary = $7,
         status = $8,
         priority = $9,
         start_date = $10,
         due_date = $11,
         metadata = $12::jsonb,
         approved_at = CASE WHEN $8 = 'approved' THEN COALESCE(approved_at, NOW()) ELSE approved_at END,
         updated_by_user_id = $13,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      projectId,
      input.customerTenantId ?? existing.customerTenantId,
      nextProjectType === 'internal' ? null : (input.siteId ?? existing.siteId),
      input.ownerUserId ?? existing.ownerUserId,
      input.name?.trim() ?? existing.name,
      nextProjectType,
      input.summary?.trim() ?? existing.summary,
      nextStatus,
      nextPriority,
      input.startDate ?? existing.startDate,
      input.dueDate ?? existing.dueDate,
      JSON.stringify(input.metadata ?? existing.metadata ?? {}),
      actor.user.id,
    ]
  );

  return mapProject(result.rows[0]);
}

export async function getProjectForActor(actor, projectId, options = { allowCustomerApprovedOnly: true }) {
  const result = await query(
    `SELECT p.*, customer.display_name AS customer_name, customer.tenant_key AS customer_tenant_key,
            site.name AS site_name, owner.full_name AS owner_name, owner.email AS owner_email
     FROM projects p
     LEFT JOIN tenants customer ON customer.id = p.customer_tenant_id
     LEFT JOIN customer_sites site ON site.id = p.site_id
     LEFT JOIN users owner ON owner.id = p.owner_user_id
     WHERE p.id = $1`,
    [projectId]
  );
  if (result.rowCount === 0) throw notFound('Project not found');

  const project = mapProject(result.rows[0]);

  if (isCustomer(actor)) {
    if (project.customerTenantId !== actor.activeTenant?.tenantId) throw forbidden('Project does not belong to this customer tenant');
    if (options.allowCustomerApprovedOnly && project.status !== 'approved') throw forbidden('Customers can only view approved project status');
    return project;
  }

  if (project.tenantId !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Project is outside the active tenant');
  }

  return project;
}

export async function getProjectWorkspace(actor, projectId) {
  const project = await getProjectForActor(actor, projectId, { allowCustomerApprovedOnly: !isCustomer(actor) ? false : true });
  const [columnsResult, jobsResult] = await Promise.all([
    query('SELECT * FROM project_board_columns WHERE project_id = $1 ORDER BY position ASC, created_at ASC', [projectId]),
    query(
      `SELECT pj.*, assignee.full_name AS assigned_user_name, assignee.email AS assigned_user_email,
              site.name AS site_name, ticket.ticket_number, ticket.subject AS ticket_subject,
              asset.asset_name, asset.asset_type
       FROM project_jobs pj
       LEFT JOIN users assignee ON assignee.id = pj.assigned_user_id
       LEFT JOIN customer_sites site ON site.id = pj.customer_site_id
       LEFT JOIN tickets ticket ON ticket.id = pj.related_ticket_id
       LEFT JOIN assets asset ON asset.id = pj.related_asset_id
       WHERE pj.project_id = $1
       ORDER BY pj.position ASC NULLS LAST, pj.updated_at DESC`,
      [projectId]
    ),
  ]);

  const profile = getProjectProfile(project.projectType, actor);
  const columns = columnsResult.rows.map(mapBoardColumn);
  const jobs = isCustomer(actor) ? [] : jobsResult.rows.map(mapJob);

  return {
    project,
    profile,
    permissions: buildProjectPermissions(actor, project.projectType),
    dashboard: buildProjectDashboard(project, columns, jobs),
    reports: buildProjectReports(project, columns, jobs, profile),
    columns,
    jobs,
  };
}

export async function listProjectJobs(actor, projectId) {
  const workspace = await getProjectWorkspace(actor, projectId);
  return workspace.jobs;
}

export async function listJobQueue(actor, filters = {}) {
  if (!actor.activeTenant) return [];
  if (isCustomer(actor)) throw forbidden('Customers cannot access operator work queue');

  const params = [actor.activeTenant.tenantId];
  const clauses = ['pj.tenant_id = $1'];
  if (filters.assigned === 'me' && actor.user?.id) {
    params.push(actor.user.id);
    clauses.push(`pj.assigned_user_id = $${params.length}`);
  }
  if (filters.assigned === 'unassigned') {
    clauses.push('pj.assigned_user_id IS NULL');
  }
  if (filters.projectType) {
    params.push(filters.projectType);
    clauses.push(`p.project_type = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`pj.status = $${params.length}`);
  }

  const result = await query(
    `SELECT pj.*, p.name AS project_name, p.project_type, p.status AS project_status,
            customer.display_name AS customer_name,
            assignee.full_name AS assigned_user_name, assignee.email AS assigned_user_email,
            site.name AS site_name, ticket.ticket_number, ticket.subject AS ticket_subject,
            asset.asset_name, asset.asset_type
     FROM project_jobs pj
     JOIN projects p ON p.id = pj.project_id
     LEFT JOIN tenants customer ON customer.id = p.customer_tenant_id
     LEFT JOIN users assignee ON assignee.id = pj.assigned_user_id
     LEFT JOIN customer_sites site ON site.id = pj.customer_site_id
     LEFT JOIN tickets ticket ON ticket.id = pj.related_ticket_id
     LEFT JOIN assets asset ON asset.id = pj.related_asset_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY COALESCE(pj.due_at, pj.updated_at) ASC, pj.updated_at DESC`,
    params
  );

  return result.rows.map((row) => ({ ...mapJob(row), projectName: row.project_name, projectType: row.project_type, projectStatus: row.project_status, customerName: row.customer_name ?? null }));
}

export async function createProjectJob(actor, projectId, input) {
  const project = await getProjectForActor(actor, projectId, { allowCustomerApprovedOnly: false });
  const jobType = input.jobType ?? project.projectType;
  requireJobPermission(actor, jobType);
  normalizeJobStatus(input.status ?? 'queued');
  normalizePriority(input.priority ?? 'normal');
  if (input.assignedUserId) await assertAssignableUser(actor, input.assignedUserId);
  if (input.customerSiteId) await assertProjectSite(actor, project.customerTenantId, input.customerSiteId, project.projectType);
  if (input.relatedAssetId) await assertProjectAsset(actor, project.customerTenantId, input.relatedAssetId, project.projectType);
  if (input.relatedTicketId) await assertProjectTicket(actor, project.tenantId, project.customerTenantId, input.relatedTicketId, project.projectType);

  const column = await resolveBoardColumn(project.id, input.boardColumnKey, project.projectType);
  const position = await nextJobPosition(project.id, column.columnKey);
  const activityHistory = buildActivityHistory(actor, 'created', `${input.title.trim()} created in ${column.name}`);

  const result = await query(
    `INSERT INTO project_jobs (
      project_id, tenant_id, job_type, status, title, details, board_column_key, position, assigned_user_id,
      due_at, priority, labels, customer_site_id, related_ticket_id, related_asset_id,
      checklist, comments, attachments, labor_entries, material_entries, activity_history,
      created_by_user_id, updated_by_user_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11, $12::jsonb, $13, $14, $15,
      $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb,
      $22, $22
    ) RETURNING *`,
    [
      project.id,
      project.tenantId,
      jobType,
      input.status ?? 'queued',
      input.title.trim(),
      input.details?.trim() ?? null,
      column.columnKey,
      position,
      input.assignedUserId ?? null,
      input.dueAt ?? null,
      input.priority ?? 'normal',
      JSON.stringify(asArray(input.labels)),
      input.customerSiteId ?? null,
      input.relatedTicketId ?? null,
      input.relatedAssetId ?? null,
      JSON.stringify(asArray(input.checklist)),
      JSON.stringify(asArray(input.comments)),
      JSON.stringify(asArray(input.attachments)),
      JSON.stringify(asArray(input.laborEntries)),
      JSON.stringify(asArray(input.materialEntries)),
      JSON.stringify(activityHistory),
      actor.user.id,
    ]
  );

  return getJobWithRelations(result.rows[0].id);
}

export async function updateProjectJob(actor, projectId, jobId, input) {
  const project = await getProjectForActor(actor, projectId, { allowCustomerApprovedOnly: false });
  const currentResult = await query('SELECT * FROM project_jobs WHERE id = $1 AND project_id = $2', [jobId, projectId]);
  if (currentResult.rowCount === 0) throw notFound('Project job not found');

  const current = mapJob(currentResult.rows[0]);
  requireJobPermission(actor, current.jobType);
  const nextStatus = input.status ?? current.status;
  const nextPriority = input.priority ?? current.priority;
  normalizeJobStatus(nextStatus);
  normalizePriority(nextPriority);
  if (input.assignedUserId) await assertAssignableUser(actor, input.assignedUserId);
  if (input.customerSiteId ?? current.customerSiteId) await assertProjectSite(actor, project.customerTenantId, input.customerSiteId ?? current.customerSiteId, project.projectType);
  if (input.relatedAssetId ?? current.relatedAssetId) await assertProjectAsset(actor, project.customerTenantId, input.relatedAssetId ?? current.relatedAssetId, project.projectType);
  if (input.relatedTicketId ?? current.relatedTicketId) await assertProjectTicket(actor, project.tenantId, project.customerTenantId, input.relatedTicketId ?? current.relatedTicketId, project.projectType);

  const targetColumn = await resolveBoardColumn(project.id, input.boardColumnKey ?? current.boardColumnKey, current.jobType);
  const comments = applyAppend(current.comments, input.appendComment, buildComment(actor, input.appendComment));
  const attachments = applyAppend(current.attachments, input.appendAttachment, buildAttachment(actor, input.appendAttachment));
  const laborEntries = applyAppend(current.laborEntries, input.appendLaborEntry, buildLaborEntry(actor, input.appendLaborEntry));
  const materialEntries = applyAppend(current.materialEntries, input.appendMaterialEntry, buildMaterialEntry(actor, input.appendMaterialEntry));
  const checklist = applyChecklistPatch(current.checklist, input.checklist, input.appendChecklistItem);
  const activityHistory = nextActivityHistory(current.activityHistory, actor, current, {
    title: input.title,
    status: input.status,
    boardColumnKey: input.boardColumnKey,
    assignedUserId: input.assignedUserId,
    dueAt: input.dueAt,
    appendComment: input.appendComment,
    appendAttachment: input.appendAttachment,
    appendLaborEntry: input.appendLaborEntry,
    appendMaterialEntry: input.appendMaterialEntry,
    checklist: input.checklist,
    appendChecklistItem: input.appendChecklistItem,
  }, targetColumn.name);

  const result = await query(
    `UPDATE project_jobs
     SET title = $3,
         details = $4,
         status = $5,
         board_column_key = $6,
         position = $7,
         assigned_user_id = $8,
         due_at = $9,
         priority = $10,
         labels = $11::jsonb,
         customer_site_id = $12,
         related_ticket_id = $13,
         related_asset_id = $14,
         checklist = $15::jsonb,
         comments = $16::jsonb,
         attachments = $17::jsonb,
         labor_entries = $18::jsonb,
         material_entries = $19::jsonb,
         activity_history = $20::jsonb,
         updated_by_user_id = $21,
         updated_at = NOW()
     WHERE id = $1 AND project_id = $2
     RETURNING *`,
    [
      jobId,
      projectId,
      input.title?.trim() ?? current.title,
      input.details?.trim() ?? current.details,
      nextStatus,
      targetColumn.columnKey,
      input.position ?? current.position,
      input.assignedUserId ?? current.assignedUserId,
      input.dueAt ?? current.dueAt,
      nextPriority,
      JSON.stringify(input.labels ? asArray(input.labels) : current.labels),
      input.customerSiteId ?? current.customerSiteId,
      input.relatedTicketId ?? current.relatedTicketId,
      input.relatedAssetId ?? current.relatedAssetId,
      JSON.stringify(checklist),
      JSON.stringify(comments),
      JSON.stringify(attachments),
      JSON.stringify(laborEntries),
      JSON.stringify(materialEntries),
      JSON.stringify(activityHistory),
      actor.user.id,
    ]
  );

  return getJobWithRelations(result.rows[0].id);
}

async function getJobWithRelations(jobId) {
  const result = await query(
    `SELECT pj.*, assignee.full_name AS assigned_user_name, assignee.email AS assigned_user_email,
            site.name AS site_name, ticket.ticket_number, ticket.subject AS ticket_subject,
            asset.asset_name, asset.asset_type
     FROM project_jobs pj
     LEFT JOIN users assignee ON assignee.id = pj.assigned_user_id
     LEFT JOIN customer_sites site ON site.id = pj.customer_site_id
     LEFT JOIN tickets ticket ON ticket.id = pj.related_ticket_id
     LEFT JOIN assets asset ON asset.id = pj.related_asset_id
     WHERE pj.id = $1`,
    [jobId]
  );
  return mapJob(result.rows[0]);
}

async function seedDefaultBoardColumns(client, projectId, projectType) {
  const defaults = getDefaultColumns(projectType);
  for (let index = 0; index < defaults.length; index += 1) {
    const column = defaults[index];
    await client.query(
      `INSERT INTO project_board_columns (project_id, column_key, name, position, wip_limit, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (project_id, column_key) DO NOTHING`,
      [projectId, column.key, column.name, index + 1, column.wipLimit ?? null, JSON.stringify(column.metadata ?? {})]
    );
  }
}

async function resolveBoardColumn(projectId, boardColumnKey, projectType) {
  const defaults = getDefaultColumns(projectType);
  const desiredKey = boardColumnKey ?? defaults[0].key;
  const result = await query('SELECT * FROM project_board_columns WHERE project_id = $1 AND column_key = $2', [projectId, desiredKey]);
  if (result.rowCount > 0) return mapBoardColumn(result.rows[0]);

  const fallback = await query('SELECT * FROM project_board_columns WHERE project_id = $1 ORDER BY position ASC LIMIT 1', [projectId]);
  if (fallback.rowCount === 0) throw badRequest('Board columns are not initialized for this project');
  return mapBoardColumn(fallback.rows[0]);
}

async function nextJobPosition(projectId, boardColumnKey) {
  const result = await query('SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM project_jobs WHERE project_id = $1 AND board_column_key = $2', [projectId, boardColumnKey]);
  return Number(result.rows[0]?.next_position ?? 1);
}

async function assertProjectCustomer(actor, customerTenantId, projectType) {
  if (projectType === 'internal') return;
  if (!customerTenantId) throw badRequest('customerTenantId is required unless projectType is internal');
  const result = await query('SELECT id, parent_tenant_id FROM tenants WHERE id = $1 AND kind = $2', [customerTenantId, 'customer']);
  if (result.rowCount === 0) throw notFound('Customer tenant not found');
  if (result.rows[0].parent_tenant_id !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Customer tenant is outside the active MSP tenant');
  }
}

async function assertProjectSite(actor, customerTenantId, siteId, projectType) {
  if (projectType === 'internal' || !siteId) return;
  const result = await query('SELECT id, tenant_id, customer_tenant_id FROM customer_sites WHERE id = $1', [siteId]);
  if (result.rowCount === 0) throw notFound('Site not found');
  const site = result.rows[0];
  if (site.customer_tenant_id !== customerTenantId) throw badRequest('Site does not belong to the customer');
  if (site.tenant_id !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') throw forbidden('Site is outside the active MSP tenant');
}

async function assertProjectAsset(actor, customerTenantId, assetId, projectType) {
  if (projectType === 'internal' || !assetId) return;
  const result = await query('SELECT id, tenant_id, customer_tenant_id FROM assets WHERE id = $1', [assetId]);
  if (result.rowCount === 0) throw notFound('Asset not found');
  const asset = result.rows[0];
  if (asset.customer_tenant_id !== customerTenantId) throw badRequest('Asset does not belong to the customer');
  if (asset.tenant_id !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') throw forbidden('Asset is outside the active MSP tenant');
}

async function assertProjectTicket(actor, tenantId, customerTenantId, ticketId, projectType) {
  if (!ticketId) return;
  const result = await query('SELECT id, tenant_id, customer_tenant_id FROM tickets WHERE id = $1', [ticketId]);
  if (result.rowCount === 0) throw notFound('Ticket not found');
  const ticket = result.rows[0];
  if (ticket.tenant_id !== tenantId && actor.user.platformRole !== 'platform_admin') throw forbidden('Ticket is outside the active MSP tenant');
  if (projectType !== 'internal' && ticket.customer_tenant_id !== customerTenantId) throw badRequest('Ticket does not belong to the project customer');
}

async function assertAssignableUser(actor, userId) {
  const result = await query(
    `SELECT tm.user_id
     FROM tenant_memberships tm
     WHERE tm.tenant_id = $1 AND tm.user_id = $2`,
    [actor.activeTenant?.tenantId, userId]
  );
  if (result.rowCount === 0 && actor.user.platformRole !== 'platform_admin') {
    throw badRequest('Assigned user is not a member of the active tenant');
  }
}

function requirePermission(actor, permission) {
  const role = actor.activeTenant?.role ?? actor.user.platformRole;
  if (!roleHasPermission(role, permission)) throw forbidden(`Role ${role} cannot ${permission}`);
}

function requireJobPermission(actor, jobType) {
  const permission = jobType === 'installation' ? 'job.manage.installation' : 'job.manage.service';
  requirePermission(actor, permission);
}

function normalizeProjectType(projectType) {
  if (!PROJECT_TYPES.has(projectType)) throw badRequest('Invalid projectType');
  return projectType;
}
function normalizeProjectStatus(status) {
  if (!PROJECT_STATUSES.has(status)) throw badRequest('Invalid project status');
  return status;
}
function normalizeJobStatus(status) {
  if (!JOB_STATUSES.has(status)) throw badRequest('Invalid job status');
  return status;
}
function normalizePriority(priority) {
  if (!PRIORITIES.has(priority)) throw badRequest('Invalid priority');
  return priority;
}
function isCustomer(actor) { return ['customer_admin', 'customer_user'].includes(actor.activeTenant?.role); }
function asArray(value) { return Array.isArray(value) ? value : []; }

export function getProjectCatalog(actor) {
  return Object.keys(PROJECT_PROFILES).map((projectType) => getProjectProfile(projectType, actor));
}

function getProjectProfile(projectType, actor) {
  const profile = PROJECT_PROFILES[projectType] ?? PROJECT_PROFILES.service;
  return {
    key: profile.key,
    label: profile.label,
    description: profile.description,
    boardColumns: profile.boardColumns,
    projectStatuses: profile.projectStatuses,
    projectStatusLabels: profile.projectStatusLabels,
    cardStatuses: profile.cardStatuses,
    cardStatusLabels: profile.cardStatusLabels,
    templates: profile.templates,
    reports: profile.reports,
    dashboards: profile.dashboards,
    permissions: buildProjectPermissions(actor, projectType),
  };
}

function buildProjectPermissions(actor, projectType) {
  const role = actor?.activeTenant?.role ?? actor?.user?.platformRole;
  const profile = PROJECT_PROFILES[projectType] ?? PROJECT_PROFILES.service;
  return {
    role,
    canManageProject: roleHasPermission(role, 'project.manage'),
    canManageCards: profile.permissions.manageCards.includes(role) || actor?.user?.platformRole === 'platform_admin',
    audienceMatchesDashboard: profile.permissions.dashboardAudience.includes(role) || actor?.user?.platformRole === 'platform_admin',
    recommendedCrew: profile.permissions.manageCards.filter((item) => !['platform_admin', 'msp_admin', 'project_manager'].includes(item)),
  };
}

function buildProjectDashboard(project, columns, jobs) {
  const openJobs = jobs.filter((job) => !['completed', 'cancelled'].includes(job.status));
  const overdueJobs = openJobs.filter((job) => job.dueAt && new Date(job.dueAt).getTime() < Date.now());
  const dueSoonJobs = openJobs.filter((job) => {
    if (!job.dueAt) return false;
    const diff = new Date(job.dueAt).getTime() - Date.now();
    return diff >= 0 && diff <= 1000 * 60 * 60 * 24 * 2;
  });
  const waitingJobs = openJobs.filter((job) => ['blocked'].includes(job.status) || ['waiting'].includes(job.boardColumnKey));
  const assignedJobs = openJobs.filter((job) => job.assignedUserId);
  const unassignedJobs = openJobs.length - assignedJobs.length;
  const byColumn = columns.map((column) => ({
    columnKey: column.columnKey,
    name: column.name,
    count: jobs.filter((job) => job.boardColumnKey === column.columnKey).length,
  }));
  return {
    projectId: project.id,
    projectType: project.projectType,
    openJobs: openJobs.length,
    completedJobs: jobs.filter((job) => job.status === 'completed').length,
    overdueJobs: overdueJobs.length,
    dueSoonJobs: dueSoonJobs.length,
    waitingJobs: waitingJobs.length,
    assignedJobs: assignedJobs.length,
    unassignedJobs,
    byColumn,
  };
}

function buildProjectReports(project, columns, jobs, profile) {
  const openJobs = jobs.filter((job) => !['completed', 'cancelled'].includes(job.status));
  return profile.reports.map((report) => ({
    key: report.key,
    name: report.name,
    description: report.description,
    summary: summarizeReport(project, report.key, columns, jobs, openJobs),
  }));
}

function summarizeReport(project, key, columns, jobs, openJobs) {
  if (project.projectType === 'service') {
    if (key === 'sla') return `${openJobs.filter((job) => job.dueAt).length} card(s) carrying due dates, ${openJobs.filter((job) => job.dueAt && new Date(job.dueAt).getTime() < Date.now()).length} overdue.`;
    if (key === 'dispatch-load') return `${openJobs.filter((job) => job.boardColumnKey === 'dispatch' || job.boardColumnKey === 'onsite').length} dispatched/active card(s), ${openJobs.filter((job) => job.assignedUserId).length} assigned.`;
    if (key === 'monitoring-followup') return `${openJobs.filter((job) => job.relatedTicketId || job.relatedAssetId).length} monitoring-linked or asset-linked service card(s).`;
  }
  if (project.projectType === 'installation') {
    if (key === 'milestones') return `${jobs.filter((job) => ['qa', 'signoff', 'done'].includes(job.boardColumnKey)).length} card(s) in late-stage delivery out of ${jobs.length}.`;
    if (key === 'procurement') return `${jobs.filter((job) => job.boardColumnKey === 'procurement' || /order|material|procure/i.test(job.title || '')).length} card(s) tied to ordering/procurement.`;
    if (key === 'signoff') return `${jobs.filter((job) => ['qa', 'signoff'].includes(job.boardColumnKey)).length} card(s) waiting on QA or customer acceptance.`;
  }
  return `${openJobs.length} open card(s) across ${columns.length} columns.`;
}

function getDefaultColumns(projectType) {
  return (PROJECT_PROFILES[projectType] ?? PROJECT_PROFILES.service).boardColumns;
}

function mapProject(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerTenantId: row.customer_tenant_id,
    customerName: row.customer_name ?? null,
    customerTenantKey: row.customer_tenant_key ?? null,
    siteId: row.site_id ?? null,
    siteName: row.site_name ?? null,
    ownerUserId: row.owner_user_id ?? null,
    ownerName: row.owner_name ?? null,
    ownerEmail: row.owner_email ?? null,
    name: row.name,
    projectType: row.project_type,
    status: row.status,
    priority: row.priority ?? 'normal',
    approvedAt: row.approved_at,
    summary: row.summary,
    startDate: row.start_date,
    dueDate: row.due_date,
    metadata: row.metadata ?? {},
    jobCount: Number(row.job_count ?? 0),
    openJobCount: Number(row.open_job_count ?? 0),
    completedJobCount: Number(row.completed_job_count ?? 0),
    nextDueAt: row.next_due_at ?? null,
    lastActivityAt: row.last_activity_at ?? row.updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBoardColumn(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    columnKey: row.column_key,
    name: row.name,
    position: Number(row.position ?? 0),
    wipLimit: row.wip_limit == null ? null : Number(row.wip_limit),
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function mapJob(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    tenantId: row.tenant_id,
    jobType: row.job_type,
    status: row.status,
    title: row.title,
    details: row.details,
    boardColumnKey: row.board_column_key ?? null,
    position: Number(row.position ?? 0),
    assignedUserId: row.assigned_user_id ?? null,
    assignedUserName: row.assigned_user_name ?? null,
    assignedUserEmail: row.assigned_user_email ?? null,
    dueAt: row.due_at,
    priority: row.priority ?? 'normal',
    labels: row.labels ?? [],
    customerSiteId: row.customer_site_id ?? null,
    siteName: row.site_name ?? null,
    relatedTicketId: row.related_ticket_id ?? null,
    relatedTicketNumber: row.ticket_number ?? null,
    relatedTicketSubject: row.ticket_subject ?? null,
    relatedAssetId: row.related_asset_id ?? null,
    relatedAssetName: row.asset_name ?? null,
    relatedAssetType: row.asset_type ?? null,
    checklist: row.checklist ?? [],
    comments: row.comments ?? [],
    attachments: row.attachments ?? [],
    laborEntries: row.labor_entries ?? [],
    materialEntries: row.material_entries ?? [],
    activityHistory: row.activity_history ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildActivityHistory(actor, type, message) {
  return [{ at: new Date().toISOString(), type, message, userId: actor.user.id, userName: actor.user.fullName ?? actor.user.email }];
}
function nextActivityHistory(current, actor, existing, input, columnName) {
  const history = asArray(current).slice(-24);
  if (input.title && input.title.trim() !== existing.title) history.push(activity(actor, 'title', `Renamed task to ${input.title.trim()}`));
  if (input.status && input.status !== existing.status) history.push(activity(actor, 'status', `Status changed to ${input.status}`));
  if (input.boardColumnKey && input.boardColumnKey !== existing.boardColumnKey) history.push(activity(actor, 'board', `Moved card to ${columnName}`));
  if (Object.prototype.hasOwnProperty.call(input, 'assignedUserId') && input.assignedUserId !== existing.assignedUserId) history.push(activity(actor, 'assignment', input.assignedUserId ? 'Updated assignee' : 'Cleared assignee'));
  if (Object.prototype.hasOwnProperty.call(input, 'dueAt') && input.dueAt !== existing.dueAt) history.push(activity(actor, 'due', input.dueAt ? `Set due date ${input.dueAt}` : 'Cleared due date'));
  if (input.appendComment?.body?.trim()) history.push(activity(actor, 'comment', 'Added comment'));
  if (input.appendAttachment?.name?.trim()) history.push(activity(actor, 'attachment', `Attached ${input.appendAttachment.name.trim()}`));
  if (input.appendLaborEntry?.summary?.trim()) history.push(activity(actor, 'labor', 'Logged labor'));
  if (input.appendMaterialEntry?.name?.trim()) history.push(activity(actor, 'material', `Added material ${input.appendMaterialEntry.name.trim()}`));
  if (input.appendChecklistItem?.label?.trim() || Array.isArray(input.checklist)) history.push(activity(actor, 'checklist', 'Updated checklist'));
  return history.slice(-30);
}
function activity(actor, type, message) { return { at: new Date().toISOString(), type, message, userId: actor.user.id, userName: actor.user.fullName ?? actor.user.email }; }
function applyAppend(current, appendPayload, built) { return built ? [...asArray(current), built] : asArray(current); }
function applyChecklistPatch(current, checklist, appendChecklistItem) {
  if (Array.isArray(checklist)) return checklist;
  if (appendChecklistItem?.label?.trim()) return [...asArray(current), { id: crypto.randomUUID(), label: appendChecklistItem.label.trim(), done: Boolean(appendChecklistItem.done) }];
  return asArray(current);
}
function buildComment(actor, payload) { return payload?.body?.trim() ? { id: crypto.randomUUID(), body: payload.body.trim(), visibility: payload.visibility ?? 'internal', at: new Date().toISOString(), userId: actor.user.id, userName: actor.user.fullName ?? actor.user.email } : null; }
function buildAttachment(actor, payload) { return payload?.name?.trim() ? { id: crypto.randomUUID(), name: payload.name.trim(), url: payload.url?.trim() ?? null, at: new Date().toISOString(), userId: actor.user.id, userName: actor.user.fullName ?? actor.user.email } : null; }
function buildLaborEntry(actor, payload) { return payload?.summary?.trim() ? { id: crypto.randomUUID(), summary: payload.summary.trim(), hours: Number(payload.hours ?? 0), at: new Date().toISOString(), userId: actor.user.id, userName: actor.user.fullName ?? actor.user.email } : null; }
function buildMaterialEntry(actor, payload) { return payload?.name?.trim() ? { id: crypto.randomUUID(), name: payload.name.trim(), quantity: Number(payload.quantity ?? 1), cost: payload.cost == null ? null : Number(payload.cost), at: new Date().toISOString(), userId: actor.user.id, userName: actor.user.fullName ?? actor.user.email } : null; }
