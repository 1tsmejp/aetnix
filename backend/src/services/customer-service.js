import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { query } from './db.js';
import { listTenantMembers } from './tenant-service.js';

export async function getCustomerDashboard(actor) {
  assertMspReadable(actor);

  const result = await query(
    `SELECT *
     FROM customer_dashboard_v
     WHERE tenant_id = $1
     ORDER BY display_name ASC`,
    [actor.activeTenant.tenantId]
  );

  return result.rows.map(mapDashboardRow);
}

export async function listCustomers(actor) {
  if (isCustomer(actor)) {
    const result = await query('SELECT * FROM tenants WHERE id = $1', [actor.activeTenant.tenantId]);
    return result.rows.map(mapCustomer);
  }

  assertMspReadable(actor);
  const result = await query(
    `SELECT *
     FROM tenants
     WHERE kind = 'customer' AND parent_tenant_id = $1
     ORDER BY display_name ASC`,
    [actor.activeTenant.tenantId]
  );
  return result.rows.map(mapCustomer);
}

export async function getCustomerDetail(actor, customerTenantId) {
  const customer = await getScopedCustomer(actor, customerTenantId);
  const [sitesResult, assetsResult, dashboardResult, members] = await Promise.all([
    query('SELECT * FROM customer_sites WHERE customer_tenant_id = $1 ORDER BY name ASC', [customerTenantId]),
    query('SELECT * FROM asset_health_summary_v WHERE customer_tenant_id = $1 ORDER BY asset_name ASC', [customerTenantId]),
    query('SELECT * FROM customer_dashboard_v WHERE customer_tenant_id = $1', [customerTenantId]),
    listTenantMembers(actor, customerTenantId),
  ]);

  return {
    customer,
    dashboard: dashboardResult.rows[0] ? mapDashboardRow(dashboardResult.rows[0]) : null,
    sites: sitesResult.rows.map(mapSite),
    assets: assetsResult.rows.map(mapAssetSummary),
    members,
  };
}

export async function createCustomerSite(actor, customerTenantId, input) {
  assertMspManage(actor);
  await getScopedCustomer(actor, customerTenantId);

  if (!input.name?.trim()) {
    throw badRequest('Site name is required');
  }

  const result = await query(
    `INSERT INTO customer_sites (
      tenant_id, customer_tenant_id, name, site_code,
      address_line1, address_line2, city, state_region, postal_code, country_code,
      timezone, primary_contact_name, primary_contact_email, primary_contact_phone,
      notes, created_by_user_id, updated_by_user_id
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14,
      $15, $16, $16
    ) RETURNING *`,
    [
      actor.activeTenant.tenantId,
      customerTenantId,
      input.name.trim(),
      input.siteCode?.trim() ?? null,
      input.addressLine1?.trim() ?? null,
      input.addressLine2?.trim() ?? null,
      input.city?.trim() ?? null,
      input.stateRegion?.trim() ?? null,
      input.postalCode?.trim() ?? null,
      input.countryCode?.trim()?.toUpperCase() ?? null,
      input.timezone?.trim() ?? null,
      input.primaryContactName?.trim() ?? null,
      input.primaryContactEmail?.trim()?.toLowerCase() ?? null,
      input.primaryContactPhone?.trim() ?? null,
      input.notes?.trim() ?? null,
      actor.user.id,
    ]
  );

  return mapSite(result.rows[0]);
}

export async function listCustomerSites(actor, customerTenantId) {
  await getScopedCustomer(actor, customerTenantId);
  const result = await query(
    'SELECT * FROM customer_sites WHERE customer_tenant_id = $1 ORDER BY name ASC',
    [customerTenantId]
  );
  return result.rows.map(mapSite);
}

export async function getSiteById(actor, siteId) {
  const result = await query('SELECT * FROM customer_sites WHERE id = $1', [siteId]);
  if (result.rowCount === 0) {
    throw notFound('Site not found');
  }

  const site = mapSite(result.rows[0]);
  await getScopedCustomer(actor, site.customerTenantId);
  return site;
}

async function getScopedCustomer(actor, customerTenantId) {
  const result = await query('SELECT * FROM tenants WHERE id = $1 AND kind = $2', [customerTenantId, 'customer']);
  if (result.rowCount === 0) {
    throw notFound('Customer tenant not found');
  }

  const customer = mapCustomer(result.rows[0]);

  if (isCustomer(actor)) {
    if (actor.activeTenant?.tenantId !== customer.id) {
      throw forbidden('Customer is outside the active tenant');
    }
    return customer;
  }

  assertMspReadable(actor);
  if (customer.parentTenantId !== actor.activeTenant.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Customer is outside the active MSP tenant');
  }

  return customer;
}

function assertMspReadable(actor) {
  const role = actor.activeTenant?.role ?? actor.user.platformRole;
  if (!['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer'].includes(role) && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Role cannot read customer operations');
  }
  if (!actor.activeTenant && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('No active tenant');
  }
}

function assertMspManage(actor) {
  const role = actor.activeTenant?.role ?? actor.user.platformRole;
  if (!['platform_admin', 'msp_admin', 'project_manager'].includes(role) && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Role cannot manage customer operations');
  }
}

function isCustomer(actor) {
  return ['customer_admin', 'customer_user'].includes(actor.activeTenant?.role);
}

function mapCustomer(row) {
  return {
    id: row.id,
    tenantKey: row.tenant_key,
    displayName: row.display_name,
    kind: row.kind,
    parentTenantId: row.parent_tenant_id,
    status: row.status,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

function mapSite(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerTenantId: row.customer_tenant_id,
    name: row.name,
    siteCode: row.site_code,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    stateRegion: row.state_region,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    timezone: row.timezone,
    primaryContactName: row.primary_contact_name,
    primaryContactEmail: row.primary_contact_email,
    primaryContactPhone: row.primary_contact_phone,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDashboardRow(row) {
  return {
    customerTenantId: row.customer_tenant_id,
    tenantId: row.tenant_id,
    tenantKey: row.tenant_key,
    displayName: row.display_name,
    status: row.status,
    approvedAt: row.approved_at,
    siteCount: Number(row.site_count ?? 0),
    assetCount: Number(row.asset_count ?? 0),
    onlineAssetCount: Number(row.online_asset_count ?? 0),
    warningAssetCount: Number(row.warning_asset_count ?? 0),
    criticalAssetCount: Number(row.critical_asset_count ?? 0),
    offlineAssetCount: Number(row.offline_asset_count ?? 0),
    latestHealthAt: row.latest_health_at,
  };
}

function mapAssetSummary(row) {
  return {
    assetId: row.asset_id,
    tenantId: row.tenant_id,
    customerTenantId: row.customer_tenant_id,
    siteId: row.site_id,
    assetName: row.asset_name,
    assetType: row.asset_type,
    lifecycleState: row.lifecycle_state,
    status: row.status,
    hostname: row.hostname,
    primaryIp: row.primary_ip,
    cpuPercent: row.cpu_percent,
    memoryPercent: row.memory_percent,
    diskPercent: row.disk_percent,
    summary: row.summary,
    latestHealthAt: row.latest_health_at,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
    registeredAgentVersion: row.registered_agent_version,
  };
}
