import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { query, withTransaction } from './db.js';

const MANAGE_ROLES = ['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer'];
const CUSTOMER_ROLES = ['customer_admin', 'customer_user'];
const RELATION_TYPES = new Set(['ticket', 'service_job', 'installation_project', 'monitoring_alert']);
const ASSET_TYPES = new Set(['server', 'workstation', 'network', 'printer', 'mobile', 'vm', 'appliance', 'other']);
const ASSET_STATUSES = new Set(['online', 'warning', 'critical', 'offline', 'unknown']);
const LIFECYCLE_STATES = new Set(['active', 'staged', 'retired', 'disposed']);

export async function listAssets(actor, filters = {}) {
  if (isCustomer(actor)) {
    const result = await query(
      `SELECT * FROM asset_health_summary_v
       WHERE customer_tenant_id = $1
       ORDER BY asset_name ASC`,
      [actor.activeTenant.tenantId]
    );
    return result.rows.map(mapAssetSummary);
  }

  assertManageReadable(actor);
  const params = [actor.activeTenant.tenantId];
  const clauses = ['tenant_id = $1'];

  if (filters.customerTenantId) {
    params.push(filters.customerTenantId);
    clauses.push(`customer_tenant_id = $${params.length}`);
  }

  if (filters.siteId) {
    params.push(filters.siteId);
    clauses.push(`site_id = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }

  const result = await query(
    `SELECT * FROM asset_health_summary_v
     WHERE ${clauses.join(' AND ')}
     ORDER BY asset_name ASC`,
    params
  );
  return result.rows.map(mapAssetSummary);
}

export async function createAsset(actor, input) {
  assertManageWritable(actor);
  await assertCustomerInScope(actor, input.customerTenantId);
  if (!input.assetName?.trim()) throw badRequest('assetName is required');
  if (!ASSET_TYPES.has(input.assetType ?? 'other')) throw badRequest('Invalid assetType');
  if (input.status && !ASSET_STATUSES.has(input.status)) throw badRequest('Invalid status');
  if (input.lifecycleState && !LIFECYCLE_STATES.has(input.lifecycleState)) throw badRequest('Invalid lifecycleState');

  if (input.siteId) {
    await assertSiteInScope(actor, input.siteId, input.customerTenantId);
  }

  const result = await query(
    `INSERT INTO assets (
      tenant_id, customer_tenant_id, site_id, asset_name, asset_type,
      manufacturer, model, serial_number, hostname, primary_ip, operating_system,
      warranty_expires_at, status, lifecycle_state, notes, created_by_user_id, updated_by_user_id
    ) VALUES (
      $1, $2, $3, $4, $5::asset_type_enum,
      $6, $7, $8, $9, $10, $11,
      $12, COALESCE($13::asset_status_enum, 'unknown'::asset_status_enum), COALESCE($14, 'active'), $15, $16, $16
    ) RETURNING *`,
    [
      actor.activeTenant.tenantId,
      input.customerTenantId,
      input.siteId ?? null,
      input.assetName.trim(),
      input.assetType ?? 'other',
      input.manufacturer?.trim() ?? null,
      input.model?.trim() ?? null,
      input.serialNumber?.trim() ?? null,
      input.hostname?.trim() ?? null,
      input.primaryIp?.trim() ?? null,
      input.operatingSystem?.trim() ?? null,
      input.warrantyExpiresAt ?? null,
      input.status ?? 'unknown',
      input.lifecycleState ?? 'active',
      input.notes?.trim() ?? null,
      actor.user.id,
    ]
  );

  return mapAsset(result.rows[0]);
}

export async function getAssetDetail(actor, assetId) {
  const asset = await getScopedAsset(actor, assetId);
  const [relationships, history, siteResult] = await Promise.all([
    query('SELECT * FROM asset_relationships WHERE asset_id = $1 ORDER BY created_at DESC', [assetId]),
    query('SELECT * FROM asset_health_snapshots WHERE asset_id = $1 ORDER BY observed_at DESC LIMIT 20', [assetId]),
    asset.siteId ? query('SELECT * FROM customer_sites WHERE id = $1', [asset.siteId]) : Promise.resolve({ rows: [] }),
  ]);

  return {
    asset,
    site: siteResult.rows[0] ? mapSite(siteResult.rows[0]) : null,
    relationships: relationships.rows.map(mapRelationship),
    healthHistory: history.rows.map(mapHealthSnapshot),
  };
}

export async function updateAsset(actor, assetId, input) {
  assertManageWritable(actor);
  const existing = await getScopedAsset(actor, assetId);
  if (Object.prototype.hasOwnProperty.call(input, 'assetName') && !input.assetName?.trim()) throw badRequest('assetName is required');
  if (input.status && !ASSET_STATUSES.has(input.status)) throw badRequest('Invalid status');
  if (input.assetType && !ASSET_TYPES.has(input.assetType)) throw badRequest('Invalid assetType');
  if (input.lifecycleState && !LIFECYCLE_STATES.has(input.lifecycleState)) throw badRequest('Invalid lifecycleState');
  if (input.siteId) {
    await assertSiteInScope(actor, input.siteId, existing.customerTenantId);
  }

  const result = await query(
    `UPDATE assets
     SET site_id = $2,
         asset_name = $3,
         asset_type = $4::asset_type_enum,
         manufacturer = $5,
         model = $6,
         serial_number = $7,
         hostname = $8,
         primary_ip = $9,
         operating_system = $10,
         warranty_expires_at = $11,
         status = $12::asset_status_enum,
         lifecycle_state = $13,
         notes = $14,
         updated_by_user_id = $15,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      assetId,
      input.siteId ?? existing.siteId,
      input.assetName?.trim() ?? existing.assetName,
      input.assetType ?? existing.assetType,
      input.manufacturer?.trim() ?? existing.manufacturer,
      input.model?.trim() ?? existing.model,
      input.serialNumber?.trim() ?? existing.serialNumber,
      input.hostname?.trim() ?? existing.hostname,
      input.primaryIp?.trim() ?? existing.primaryIp,
      input.operatingSystem?.trim() ?? existing.operatingSystem,
      input.warrantyExpiresAt ?? existing.warrantyExpiresAt,
      input.status ?? existing.status,
      input.lifecycleState ?? existing.lifecycleState,
      input.notes?.trim() ?? existing.notes,
      actor.user.id,
    ]
  );

  return mapAsset(result.rows[0]);
}

export async function addAssetRelationship(actor, assetId, input) {
  assertManageWritable(actor);
  await getScopedAsset(actor, assetId);
  if (!RELATION_TYPES.has(input.relationType)) throw badRequest('Invalid relationType');
  if (!input.externalRef?.trim()) throw badRequest('externalRef is required');

  const metadata = sanitizeRelationshipMetadata(input.metadata);

  const result = await query(
    `INSERT INTO asset_relationships (asset_id, tenant_id, relation_type, external_ref, label, metadata)
     VALUES ($1, $2, $3::asset_relation_type_enum, $4, $5, $6::jsonb)
     ON CONFLICT (asset_id, relation_type, external_ref)
     DO UPDATE SET label = EXCLUDED.label, metadata = EXCLUDED.metadata
     RETURNING *`,
    [assetId, actor.activeTenant.tenantId, input.relationType, input.externalRef.trim(), input.label?.trim() ?? null, JSON.stringify(metadata)]
  );

  return mapRelationship(result.rows[0]);
}

export async function registerAgent(input) {
  if (!input.agentKey?.trim()) throw badRequest('agentKey is required');
  const assetResult = await query('SELECT * FROM assets WHERE agent_key = $1', [input.agentKey.trim()]);
  if (assetResult.rowCount === 0) throw unauthorized('Invalid agent key');
  const asset = mapAsset(assetResult.rows[0]);

  const result = await withTransaction(async (client) => {
    const agentResult = await client.query(
      `INSERT INTO asset_agents (asset_id, tenant_id, customer_tenant_id, agent_version, last_seen_at, registration_metadata)
       VALUES ($1, $2, $3, $4, NOW(), $5::jsonb)
       ON CONFLICT (asset_id)
       DO UPDATE SET agent_version = EXCLUDED.agent_version,
                     last_seen_at = NOW(),
                     registration_metadata = EXCLUDED.registration_metadata
       RETURNING *`,
      [asset.id, asset.tenantId, asset.customerTenantId, input.agentVersion?.trim() ?? null, JSON.stringify(input.metadata ?? {})]
    );

    await client.query(
      `INSERT INTO asset_health_snapshots (asset_id, tenant_id, status, cpu_percent, memory_percent, disk_percent, agent_version, summary)
       VALUES ($1, $2, COALESCE($3::asset_status_enum, 'online'::asset_status_enum), $4, $5, $6, $7, $8)`,
      [asset.id, asset.tenantId, input.status ?? 'online', input.cpuPercent ?? null, input.memoryPercent ?? null, input.diskPercent ?? null, input.agentVersion?.trim() ?? null, input.summary?.trim() ?? 'Agent registered']
    );

    await client.query(
      `UPDATE assets
       SET status = COALESCE($2::asset_status_enum, 'online'::asset_status_enum), updated_at = NOW()
       WHERE id = $1`,
      [asset.id, input.status ?? 'online']
    );

    return agentResult.rows[0];
  });

  return {
    asset,
    registration: mapAgent(result),
  };
}

export async function recordAssetHealth(input) {
  if (!input.agentKey?.trim()) throw badRequest('agentKey is required');
  if (!ASSET_STATUSES.has(input.status)) throw badRequest('Invalid status');

  const assetResult = await query('SELECT * FROM assets WHERE agent_key = $1', [input.agentKey.trim()]);
  if (assetResult.rowCount === 0) throw unauthorized('Invalid agent key');
  const asset = mapAsset(assetResult.rows[0]);

  const result = await withTransaction(async (client) => {
    const snapshot = await client.query(
      `INSERT INTO asset_health_snapshots (asset_id, tenant_id, status, cpu_percent, memory_percent, disk_percent, agent_version, summary)
       VALUES ($1, $2, $3::asset_status_enum, $4, $5, $6, $7, $8)
       RETURNING *`,
      [asset.id, asset.tenantId, input.status, input.cpuPercent ?? null, input.memoryPercent ?? null, input.diskPercent ?? null, input.agentVersion?.trim() ?? null, input.summary?.trim() ?? null]
    );

    await client.query(
      `INSERT INTO asset_agents (asset_id, tenant_id, customer_tenant_id, agent_version, last_seen_at, registration_metadata)
       VALUES ($1, $2, $3, $4, NOW(), '{}'::jsonb)
       ON CONFLICT (asset_id)
       DO UPDATE SET agent_version = COALESCE(EXCLUDED.agent_version, asset_agents.agent_version),
                     last_seen_at = NOW()`,
      [asset.id, asset.tenantId, asset.customerTenantId, input.agentVersion?.trim() ?? null]
    );

    await client.query('UPDATE assets SET status = $2::asset_status_enum, updated_at = NOW() WHERE id = $1', [asset.id, input.status]);

    return snapshot.rows[0];
  });

  return {
    asset,
    snapshot: mapHealthSnapshot(result),
  };
}

async function getScopedAsset(actor, assetId) {
  const result = await query('SELECT * FROM assets WHERE id = $1', [assetId]);
  if (result.rowCount === 0) throw notFound('Asset not found');
  const baseAsset = mapAsset(result.rows[0]);

  if (isCustomer(actor)) {
    if (baseAsset.customerTenantId !== actor.activeTenant?.tenantId) throw forbidden('Asset is outside the active customer tenant');
    return await hydrateAsset(baseAsset);
  }

  assertManageReadable(actor);
  if (baseAsset.tenantId !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Asset is outside the active MSP tenant');
  }
  return await hydrateAsset(baseAsset);
}

async function hydrateAsset(baseAsset) {
  const summary = await hydrateAssetSummary(baseAsset.id);
  return { ...baseAsset, ...(summary ?? {}) };
}

async function hydrateAssetSummary(assetId) {
  const result = await query('SELECT * FROM asset_health_summary_v WHERE asset_id = $1', [assetId]);
  return result.rowCount ? mapAssetSummary(result.rows[0]) : null;
}

async function assertCustomerInScope(actor, customerTenantId) {
  const result = await query('SELECT id, parent_tenant_id FROM tenants WHERE id = $1 AND kind = $2', [customerTenantId, 'customer']);
  if (result.rowCount === 0) throw notFound('Customer tenant not found');
  if (result.rows[0].parent_tenant_id !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Customer tenant is outside the active MSP tenant');
  }
}

async function assertSiteInScope(actor, siteId, customerTenantId) {
  const result = await query('SELECT id, customer_tenant_id, tenant_id FROM customer_sites WHERE id = $1', [siteId]);
  if (result.rowCount === 0) throw notFound('Site not found');
  const row = result.rows[0];
  if (row.customer_tenant_id !== customerTenantId) throw badRequest('Site does not belong to the customer');
  if (row.tenant_id !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Site is outside the active MSP tenant');
  }
}

function assertManageReadable(actor) {
  const role = actor.activeTenant?.role ?? actor.user.platformRole;
  if (!MANAGE_ROLES.includes(role) && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Role cannot read asset operations');
  }
}

function assertManageWritable(actor) {
  const role = actor.activeTenant?.role ?? actor.user.platformRole;
  if (!['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer'].includes(role) && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Role cannot manage assets');
  }
}

function isCustomer(actor) {
  return CUSTOMER_ROLES.includes(actor.activeTenant?.role);
}

function mapAsset(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerTenantId: row.customer_tenant_id,
    siteId: row.site_id,
    assetName: row.asset_name,
    assetType: row.asset_type,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serial_number,
    hostname: row.hostname,
    primaryIp: row.primary_ip,
    operatingSystem: row.operating_system,
    warrantyExpiresAt: row.warranty_expires_at,
    status: row.status,
    lifecycleState: row.lifecycle_state,
    agentKey: row.agent_key,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    agentVersion: row.agent_version,
    summary: row.summary,
    latestHealthAt: row.latest_health_at,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
    registeredAgentVersion: row.registered_agent_version,
    agentPlatform: row.agent_platform,
    agentPlatformRelease: row.agent_platform_release,
    agentArchitecture: row.agent_architecture,
    agentCapabilities: row.agent_capabilities,
    agentIdentity: row.agent_identity,
    agentLastReportedAt: row.last_reported_at,
    latestEnrollmentId: row.latest_enrollment_id,
    latestEnrollmentStatus: row.latest_enrollment_status,
    latestEnrollmentPlatform: row.latest_enrollment_platform,
    latestEnrollmentPackageKind: row.latest_enrollment_package_kind,
    latestEnrollmentExpiresAt: row.latest_enrollment_expires_at,
    latestEnrollmentUsedAt: row.latest_enrollment_used_at,
    latestEnrollmentCreatedAt: row.latest_enrollment_created_at,
  };
}

function mapRelationship(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    tenantId: row.tenant_id,
    relationType: row.relation_type,
    externalRef: row.external_ref,
    label: row.label,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function mapHealthSnapshot(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    tenantId: row.tenant_id,
    status: row.status,
    cpuPercent: row.cpu_percent,
    memoryPercent: row.memory_percent,
    diskPercent: row.disk_percent,
    agentVersion: row.agent_version,
    summary: row.summary,
    observedAt: row.observed_at,
  };
}

function mapAgent(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    tenantId: row.tenant_id,
    customerTenantId: row.customer_tenant_id,
    agentVersion: row.agent_version,
    lastSeenAt: row.last_seen_at,
    registeredAt: row.registered_at,
    registrationMetadata: row.registration_metadata,
  };
}

function mapSite(row) {
  return {
    id: row.id,
    customerTenantId: row.customer_tenant_id,
    name: row.name,
    city: row.city,
    stateRegion: row.state_region,
    countryCode: row.country_code,
  };
}

function sanitizeRelationshipMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .filter(([key]) => typeof key === 'string' && key.trim())
    .map(([key, entryValue]) => [key.trim(), sanitizeJsonValue(entryValue)])
    .filter(([, entryValue]) => entryValue !== undefined);
  return Object.fromEntries(entries);
}

function sanitizeJsonValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(sanitizeJsonValue).filter((item) => item !== undefined);
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, entryValue]) => [key, sanitizeJsonValue(entryValue)])
      .filter(([, entryValue]) => entryValue !== undefined);
    return Object.fromEntries(entries);
  }
  return undefined;
}
