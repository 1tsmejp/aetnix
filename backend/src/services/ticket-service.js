import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { query, withTransaction } from './db.js';

const CUSTOMER_ROLES = ['customer_admin', 'customer_user'];
const MANAGE_ROLES = ['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer'];
const TICKET_STATUSES = new Set(['new', 'open', 'pending_customer', 'pending_vendor', 'resolved', 'closed']);
const TICKET_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const CONVERSION_TYPES = new Set(['service_job', 'installation_project', 'internal_project_task']);
const CONVERSION_STATUSES = new Set(['planned', 'queued', 'created', 'cancelled']);

export async function getTicketDashboard(actor) {
  if (!actor.activeTenant) return { counts: {}, queues: [] };

  const params = [];
  const scopeClause = isCustomer(actor)
    ? `customer_tenant_id = $1`
    : `tenant_id = $1`;
  params.push(actor.activeTenant.tenantId);
  if (!isCustomer(actor)) assertTechnicianReadable(actor);

  const countsResult = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open,
       COUNT(*) FILTER (WHERE assigned_user_id IS NULL AND status NOT IN ('resolved', 'closed'))::int AS unassigned,
       COUNT(*) FILTER (WHERE assigned_user_id = $2 AND status NOT IN ('resolved', 'closed'))::int AS assigned_to_me,
       COUNT(*) FILTER (WHERE status = 'pending_customer')::int AS pending_customer,
       COUNT(*) FILTER (WHERE status = 'pending_vendor')::int AS pending_vendor,
       COUNT(*) FILTER (WHERE priority IN ('high', 'urgent') AND status NOT IN ('resolved', 'closed'))::int AS high_priority,
       COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '24 hours' AND status NOT IN ('resolved', 'closed'))::int AS stale
     FROM tickets
     WHERE ${scopeClause}`,
    [params[0], actor.user?.id ?? null]
  );

  const queuesResult = await query(
    `SELECT status, COUNT(*)::int AS count
     FROM tickets
     WHERE ${scopeClause}
     GROUP BY status
     ORDER BY status ASC`,
    params
  );

  return {
    counts: countsResult.rows[0] ?? {},
    queues: queuesResult.rows.map((row) => ({ status: row.status, count: Number(row.count ?? 0) })),
  };
}

export async function listTickets(actor, filters = {}) {
  if (!actor.activeTenant) return [];

  const params = [];
  const clauses = [];

  if (isCustomer(actor)) {
    params.push(actor.activeTenant.tenantId);
    clauses.push(`customer_tenant_id = $${params.length}`);
  } else {
    assertTechnicianReadable(actor);
    params.push(actor.activeTenant.tenantId);
    clauses.push(`tenant_id = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }

  if (filters.priority) {
    params.push(filters.priority);
    clauses.push(`priority = $${params.length}`);
  }

  if (filters.customerTenantId && !isCustomer(actor)) {
    params.push(filters.customerTenantId);
    clauses.push(`customer_tenant_id = $${params.length}`);
  }

  if (filters.assetId) {
    params.push(filters.assetId);
    clauses.push(`asset_id = $${params.length}`);
  }

  if (filters.assigned === 'me' && actor.user?.id) {
    params.push(actor.user.id);
    clauses.push(`assigned_user_id = $${params.length}`);
  }

  if (filters.assigned === 'unassigned') {
    clauses.push('assigned_user_id IS NULL');
  }

  const result = await query(
    `SELECT * FROM ticket_portal_v
     WHERE ${clauses.join(' AND ')}
     ORDER BY updated_at DESC, created_at DESC`,
    params
  );

  return result.rows.map(mapTicketPortalRow);
}

export async function createTicket(actor, input) {
  if (isCustomer(actor)) {
    if (!input.subject?.trim() || !input.description?.trim()) {
      throw badRequest('subject and description are required');
    }

    const customerTenantId = actor.activeTenant.tenantId;
    const scope = await resolveCustomerScope(actor, customerTenantId, input.siteId, input.assetId);
    const result = await query(
      `INSERT INTO tickets (
        tenant_id, customer_tenant_id, site_id, asset_id, status, priority, source, category,
        subject, description, requester_name, requester_email, requester_user_id,
        metadata, created_by_user_id, updated_by_user_id
      ) VALUES (
        $1, $2, $3, $4, 'new', $5, COALESCE($6, 'portal'), $7,
        $8, $9, $10, $11, $12,
        $13::jsonb, $12, $12
      ) RETURNING *`,
      [
        scope.tenantId,
        customerTenantId,
        input.siteId ?? null,
        input.assetId ?? null,
        normalizePriority(input.priority),
        input.source ?? 'portal',
        input.category?.trim() ?? null,
        input.subject.trim(),
        input.description.trim(),
        input.requesterName?.trim() ?? actor.user.fullName ?? null,
        input.requesterEmail?.trim() ?? actor.user.email ?? null,
        actor.user.id,
        JSON.stringify(input.metadata ?? {}),
      ]
    );
    return mapTicket(result.rows[0]);
  }

  assertTechnicianWritable(actor);
  if (!input.customerTenantId || !input.subject?.trim() || !input.description?.trim()) {
    throw badRequest('customerTenantId, subject, and description are required');
  }

  await assertCustomerInScope(actor, input.customerTenantId);
  if (input.siteId) await assertSiteInScope(actor, input.siteId, input.customerTenantId);
  if (input.assetId) await assertAssetInScope(actor, input.assetId, input.customerTenantId);
  if (input.status && !TICKET_STATUSES.has(input.status)) throw badRequest('Invalid status');

  const result = await query(
    `INSERT INTO tickets (
      tenant_id, customer_tenant_id, site_id, asset_id, status, priority, source, category,
      subject, description, requester_name, requester_email, requester_user_id, assigned_user_id,
      metadata, created_by_user_id, updated_by_user_id
    ) VALUES (
      $1, $2, $3, $4, COALESCE($5, 'new'), $6, COALESCE($7, 'portal'), $8,
      $9, $10, $11, $12, $13, $14,
      $15::jsonb, $16, $16
    ) RETURNING *`,
    [
      actor.activeTenant.tenantId,
      input.customerTenantId,
      input.siteId ?? null,
      input.assetId ?? null,
      input.status ?? 'new',
      normalizePriority(input.priority),
      input.source ?? 'portal',
      input.category?.trim() ?? null,
      input.subject.trim(),
      input.description.trim(),
      input.requesterName?.trim() ?? null,
      input.requesterEmail?.trim() ?? null,
      input.requesterUserId ?? null,
      input.assignedUserId ?? null,
      JSON.stringify(input.metadata ?? {}),
      actor.user.id,
    ]
  );

  return mapTicket(result.rows[0]);
}

export async function getTicketDetail(actor, ticketId) {
  const ticket = await getScopedTicket(actor, ticketId);
  const [commentsResult, conversionsResult] = await Promise.all([
    query(
      `SELECT c.*, u.full_name AS author_name, u.email AS author_email
       FROM ticket_comments c
       LEFT JOIN users u ON u.id = c.author_user_id
       WHERE c.ticket_id = $1 ${isCustomer(actor) ? 'AND c.is_customer_visible = TRUE' : ''}
       ORDER BY c.created_at ASC`,
      [ticketId]
    ),
    query('SELECT * FROM ticket_conversions WHERE ticket_id = $1 ORDER BY created_at DESC', [ticketId]),
  ]);

  return {
    ticket,
    comments: commentsResult.rows.map(mapTicketComment),
    conversions: conversionsResult.rows.map(mapTicketConversion),
  };
}

export async function updateTicket(actor, ticketId, input) {
  const existing = await getScopedTicket(actor, ticketId);

  if (isCustomer(actor)) {
    const allowedKeys = ['subject', 'description'];
    const hasDisallowed = Object.keys(input).some((key) => !allowedKeys.includes(key));
    if (hasDisallowed) throw forbidden('Customers can only update ticket subject/description');

    const result = await query(
      `UPDATE tickets
       SET subject = $2,
           description = $3,
           updated_by_user_id = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [ticketId, input.subject?.trim() ?? existing.subject, input.description?.trim() ?? existing.description, actor.user.id]
    );
    return mapTicket(result.rows[0]);
  }

  assertTechnicianWritable(actor);
  if (input.status && !TICKET_STATUSES.has(input.status)) throw badRequest('Invalid status');
  if (input.priority && !TICKET_PRIORITIES.has(input.priority)) throw badRequest('Invalid priority');
  if (input.siteId) await assertSiteInScope(actor, input.siteId, existing.customerTenantId);
  if (input.assetId) await assertAssetInScope(actor, input.assetId, existing.customerTenantId);

  const nextStatus = input.status ?? existing.status;
  const result = await query(
    `UPDATE tickets
     SET status = $2,
         priority = $3,
         category = $4,
         subject = $5,
         description = $6,
         site_id = $7,
         asset_id = $8,
         assigned_user_id = $9,
         requester_name = $10,
         requester_email = $11,
         metadata = $12::jsonb,
         resolved_at = CASE WHEN $2 = 'resolved' THEN COALESCE(resolved_at, NOW()) WHEN $2 <> 'resolved' THEN NULL ELSE resolved_at END,
         closed_at = CASE WHEN $2 = 'closed' THEN COALESCE(closed_at, NOW()) WHEN $2 <> 'closed' THEN NULL ELSE closed_at END,
         updated_by_user_id = $13,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      ticketId,
      nextStatus,
      normalizePriority(input.priority ?? existing.priority),
      input.category?.trim() ?? existing.category,
      input.subject?.trim() ?? existing.subject,
      input.description?.trim() ?? existing.description,
      input.siteId ?? existing.siteId,
      input.assetId ?? existing.assetId,
      input.assignedUserId ?? existing.assignedUserId,
      input.requesterName?.trim() ?? existing.requesterName,
      input.requesterEmail?.trim() ?? existing.requesterEmail,
      JSON.stringify(input.metadata ?? existing.metadata ?? {}),
      actor.user.id,
    ]
  );

  return mapTicket(result.rows[0]);
}

export async function addTicketComment(actor, ticketId, input) {
  if (!input.body?.trim()) throw badRequest('body is required');
  const ticket = await getScopedTicket(actor, ticketId);

  const isVisible = isCustomer(actor) ? true : input.isCustomerVisible !== false;
  const role = actor.activeTenant?.role ?? actor.user.platformRole;

  return withTransaction(async (client) => {
    const commentResult = await client.query(
      `INSERT INTO ticket_comments (ticket_id, tenant_id, author_user_id, author_role, is_customer_visible, body, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING *`,
      [ticket.id, ticket.tenantId, actor.user.id, role, isVisible, input.body.trim(), JSON.stringify(input.metadata ?? {})]
    );

    const status = isCustomer(actor)
      ? (ticket.status === 'resolved' || ticket.status === 'closed' ? 'open' : 'open')
      : (input.status && TICKET_STATUSES.has(input.status) ? input.status : ticket.status === 'new' ? 'open' : ticket.status);

    await client.query(
      `UPDATE tickets
       SET status = $2,
           last_customer_reply_at = CASE WHEN $3 THEN NOW() ELSE last_customer_reply_at END,
           last_technician_reply_at = CASE WHEN $3 THEN last_technician_reply_at ELSE NOW() END,
           updated_by_user_id = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [ticket.id, status, isCustomer(actor), actor.user.id]
    );

    return mapTicketComment(commentResult.rows[0]);
  });
}

export async function createTicketConversion(actor, ticketId, input) {
  assertTechnicianWritable(actor);
  const ticket = await getScopedTicket(actor, ticketId);
  if (!CONVERSION_TYPES.has(input.conversionType)) throw badRequest('Invalid conversionType');
  if (input.status && !CONVERSION_STATUSES.has(input.status)) throw badRequest('Invalid conversion status');

  const result = await query(
    `INSERT INTO ticket_conversions (ticket_id, tenant_id, conversion_type, target_ref, summary, status, metadata, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'planned'), $7::jsonb, $8)
     RETURNING *`,
    [
      ticket.id,
      ticket.tenantId,
      input.conversionType,
      input.targetRef?.trim() ?? null,
      input.summary?.trim() ?? null,
      input.status ?? 'planned',
      JSON.stringify(input.metadata ?? {}),
      actor.user.id,
    ]
  );

  return mapTicketConversion(result.rows[0]);
}

async function getScopedTicket(actor, ticketId) {
  const result = await query('SELECT * FROM ticket_portal_v WHERE id = $1', [ticketId]);
  if (result.rowCount === 0) throw notFound('Ticket not found');
  const ticket = mapTicketPortalRow(result.rows[0]);

  if (isCustomer(actor)) {
    if (ticket.customerTenantId !== actor.activeTenant?.tenantId) throw forbidden('Ticket is outside the active customer tenant');
    return ticket;
  }

  assertTechnicianReadable(actor);
  if (ticket.tenantId !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Ticket is outside the active MSP tenant');
  }
  return ticket;
}

async function resolveCustomerScope(actor, customerTenantId, siteId, assetId) {
  const customerResult = await query('SELECT id, parent_tenant_id FROM tenants WHERE id = $1 AND kind = $2', [customerTenantId, 'customer']);
  if (customerResult.rowCount === 0) throw notFound('Customer tenant not found');
  const tenantId = customerResult.rows[0].parent_tenant_id;
  if (siteId) await assertCustomerSiteBelongs(customerTenantId, siteId);
  if (assetId) await assertCustomerAssetBelongs(customerTenantId, assetId);
  return { tenantId };
}

async function assertCustomerInScope(actor, customerTenantId) {
  const result = await query('SELECT id, parent_tenant_id FROM tenants WHERE id = $1 AND kind = $2', [customerTenantId, 'customer']);
  if (result.rowCount === 0) throw notFound('Customer tenant not found');
  if (result.rows[0].parent_tenant_id !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Customer tenant is outside the active MSP tenant');
  }
}

async function assertSiteInScope(actor, siteId, customerTenantId) {
  const result = await query('SELECT id, tenant_id, customer_tenant_id FROM customer_sites WHERE id = $1', [siteId]);
  if (result.rowCount === 0) throw notFound('Site not found');
  const row = result.rows[0];
  if (row.customer_tenant_id !== customerTenantId) throw badRequest('Site does not belong to the customer');
  if (row.tenant_id !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Site is outside the active MSP tenant');
  }
}

async function assertAssetInScope(actor, assetId, customerTenantId) {
  const result = await query('SELECT id, tenant_id, customer_tenant_id FROM assets WHERE id = $1', [assetId]);
  if (result.rowCount === 0) throw notFound('Asset not found');
  const row = result.rows[0];
  if (row.customer_tenant_id !== customerTenantId) throw badRequest('Asset does not belong to the customer');
  if (row.tenant_id !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Asset is outside the active MSP tenant');
  }
}

async function assertCustomerSiteBelongs(customerTenantId, siteId) {
  const result = await query('SELECT id FROM customer_sites WHERE id = $1 AND customer_tenant_id = $2', [siteId, customerTenantId]);
  if (result.rowCount === 0) throw badRequest('Site does not belong to the active customer tenant');
}

async function assertCustomerAssetBelongs(customerTenantId, assetId) {
  const result = await query('SELECT id FROM assets WHERE id = $1 AND customer_tenant_id = $2', [assetId, customerTenantId]);
  if (result.rowCount === 0) throw badRequest('Asset does not belong to the active customer tenant');
}

function assertTechnicianReadable(actor) {
  const role = actor.activeTenant?.role ?? actor.user.platformRole;
  if (!MANAGE_ROLES.includes(role) && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Role cannot read tickets');
  }
}

function assertTechnicianWritable(actor) {
  const role = actor.activeTenant?.role ?? actor.user.platformRole;
  if (!['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer'].includes(role) && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Role cannot manage tickets');
  }
}

function isCustomer(actor) {
  return CUSTOMER_ROLES.includes(actor.activeTenant?.role);
}

function normalizePriority(priority) {
  const value = priority ?? 'normal';
  if (!TICKET_PRIORITIES.has(value)) throw badRequest('Invalid priority');
  return value;
}

function mapTicket(row) {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    tenantId: row.tenant_id,
    customerTenantId: row.customer_tenant_id,
    siteId: row.site_id,
    assetId: row.asset_id,
    status: row.status,
    priority: row.priority,
    source: row.source,
    category: row.category,
    subject: row.subject,
    description: row.description,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    requesterUserId: row.requester_user_id,
    assignedUserId: row.assigned_user_id,
    lastCustomerReplyAt: row.last_customer_reply_at,
    lastTechnicianReplyAt: row.last_technician_reply_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTicketPortalRow(row) {
  return {
    ...mapTicket(row),
    customerName: row.customer_name,
    customerTenantKey: row.customer_tenant_key,
    siteName: row.site_name,
    assetName: row.asset_name,
    assetType: row.asset_type,
    primaryIp: row.primary_ip,
    assignedUserName: row.assigned_user_name,
    assignedUserEmail: row.assigned_user_email,
    commentCount: Number(row.comment_count ?? 0),
    conversionCount: Number(row.conversion_count ?? 0),
  };
}

function mapTicketComment(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    tenantId: row.tenant_id,
    authorUserId: row.author_user_id,
    authorRole: row.author_role,
    authorName: row.author_name ?? null,
    authorEmail: row.author_email ?? null,
    isCustomerVisible: row.is_customer_visible,
    body: row.body,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function mapTicketConversion(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    tenantId: row.tenant_id,
    conversionType: row.conversion_type,
    targetRef: row.target_ref,
    summary: row.summary,
    status: row.status,
    metadata: row.metadata,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}
