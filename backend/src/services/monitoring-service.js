import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { query, withTransaction } from './db.js';
import { env } from '../config/env.js';

const AGENT_PLATFORMS = new Set(['windows', 'linux', 'macos', 'unknown']);

const MANAGE_ROLES = ['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer'];
const CUSTOMER_ROLES = ['customer_admin', 'customer_user'];
const ASSET_STATUSES = new Set(['online', 'warning', 'critical', 'offline', 'unknown']);
const ALERT_SEVERITIES = { info: 1, warning: 2, critical: 3 };

export async function ingestHeartbeat(input) {
  if (!input.agentKey?.trim()) throw badRequest('agentKey is required');

  const asset = await getAssetByAgentKey(input.agentKey.trim());
  const observedAt = input.observedAt ?? new Date().toISOString();
  const metrics = normalizeMetrics(input.metrics ?? {});
  const services = normalizeServices(input.services ?? []);
  const installedSoftware = normalizeSoftware(input.installedSoftware ?? []);
  const status = deriveStatus(input.status, metrics, services, input.patchStatus);
  const summary = input.summary?.trim() || buildSummary(status, metrics, services, input.patchStatus);
  const network = normalizeNetwork(input.network ?? {});
  const identity = normalizeIdentity(input.identity ?? {}, input, network);
  const capabilities = normalizeCapabilities(input.capabilities ?? {}, input, services, installedSoftware, identity);
  const platform = normalizePlatform(input.platform ?? identity.platform ?? input.os?.platform ?? 'unknown');

  const snapshot = await withTransaction(async (client) => {
    const snapshotResult = await client.query(
      `INSERT INTO asset_health_snapshots (
        asset_id, tenant_id, status, cpu_percent, memory_percent, disk_percent,
        uptime_seconds, load_one, load_five, load_fifteen,
        agent_version, summary, os_name, os_version, os_release, kernel_version,
        architecture, public_ip, patch_status, metrics, network, observed_at, identity, capabilities
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20::jsonb, $21::jsonb, $22, $23::jsonb, $24::jsonb
      ) RETURNING *`,
      [
        asset.id,
        asset.tenantId,
        status,
        metrics.cpuPercent,
        metrics.memoryPercent,
        metrics.diskPercent,
        metrics.uptimeSeconds,
        metrics.loadOne,
        metrics.loadFive,
        metrics.loadFifteen,
        input.agentVersion?.trim() ?? null,
        summary,
        input.os?.name?.trim() ?? asset.operatingSystem ?? null,
        input.os?.version?.trim() ?? null,
        input.os?.release?.trim() ?? null,
        input.os?.kernelVersion?.trim() ?? null,
        input.os?.architecture?.trim() ?? null,
        network.publicIp ?? null,
        input.patchStatus?.trim() ?? null,
        JSON.stringify(metrics.extra),
        JSON.stringify(network),
        observedAt,
        JSON.stringify(identity),
        JSON.stringify(capabilities),
      ]
    );

    await client.query(
      `INSERT INTO asset_agents (asset_id, tenant_id, customer_tenant_id, agent_version, last_seen_at, registration_metadata, platform, platform_release, architecture, capabilities, identity, last_reported_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb), $7::agent_platform_enum, $8, $9, $10::jsonb, $11::jsonb, $5)
       ON CONFLICT (asset_id)
       DO UPDATE SET agent_version = COALESCE(EXCLUDED.agent_version, asset_agents.agent_version),
                     last_seen_at = EXCLUDED.last_seen_at,
                     registration_metadata = asset_agents.registration_metadata || EXCLUDED.registration_metadata,
                     platform = EXCLUDED.platform,
                     platform_release = COALESCE(EXCLUDED.platform_release, asset_agents.platform_release),
                     architecture = COALESCE(EXCLUDED.architecture, asset_agents.architecture),
                     capabilities = EXCLUDED.capabilities,
                     identity = EXCLUDED.identity,
                     last_reported_at = EXCLUDED.last_reported_at`,
      [asset.id, asset.tenantId, asset.customerTenantId, input.agentVersion?.trim() ?? null, observedAt, JSON.stringify(input.registrationMetadata ?? {}), platform, identity.osVersion ?? input.os?.version?.trim() ?? null, identity.architecture ?? input.os?.architecture?.trim() ?? null, JSON.stringify(capabilities), JSON.stringify(identity)]
    );

    await client.query(
      `UPDATE assets
       SET status = $2,
           hostname = COALESCE($3, hostname),
           primary_ip = COALESCE($4, primary_ip),
           operating_system = COALESCE($5, operating_system),
           updated_at = NOW()
       WHERE id = $1`,
      [asset.id, status, input.hostname?.trim() ?? null, network.primaryIp ?? null, input.os?.name?.trim() ?? null]
    );

    if (services.length > 0) {
      for (const service of services) {
        await client.query(
          `INSERT INTO asset_services (asset_id, tenant_id, service_name, display_name, status, startup_type, metadata, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
           ON CONFLICT (asset_id, service_name)
           DO UPDATE SET display_name = EXCLUDED.display_name,
                         status = EXCLUDED.status,
                         startup_type = EXCLUDED.startup_type,
                         metadata = EXCLUDED.metadata,
                         observed_at = EXCLUDED.observed_at`,
          [asset.id, asset.tenantId, service.serviceName, service.displayName, service.status, service.startupType, JSON.stringify(service.metadata), observedAt]
        );
      }
    }

    if (installedSoftware.length > 0) {
      for (const software of installedSoftware) {
        await client.query(
          `INSERT INTO asset_software_inventory (asset_id, tenant_id, package_name, package_version, vendor, install_source, installed_at, metadata, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
           ON CONFLICT (asset_id, package_name)
           DO UPDATE SET package_version = EXCLUDED.package_version,
                         vendor = EXCLUDED.vendor,
                         install_source = EXCLUDED.install_source,
                         installed_at = EXCLUDED.installed_at,
                         metadata = EXCLUDED.metadata,
                         observed_at = EXCLUDED.observed_at`,
          [asset.id, asset.tenantId, software.packageName, software.packageVersion, software.vendor, software.installSource, software.installedAt, JSON.stringify(software.metadata), observedAt]
        );
      }
    }

    return snapshotResult.rows[0];
  });

  await evaluateAlertsForAsset(asset.id);

  return {
    asset,
    status,
    snapshot: mapHealthSnapshot(snapshot),
  };
}

export async function listMonitoringAssets(actor) {
  const scoped = await queryScopedMonitoring(actor);
  return scoped.rows.map(mapMonitoringAsset);
}

export async function getMonitoringAssetDetail(actor, assetId) {
  const asset = await getScopedMonitoringAsset(actor, assetId);
  const [history, alerts] = await Promise.all([
    query('SELECT * FROM asset_health_snapshots WHERE asset_id = $1 ORDER BY observed_at DESC LIMIT 20', [assetId]),
    query('SELECT * FROM monitoring_alerts WHERE asset_id = $1 ORDER BY triggered_at DESC LIMIT 20', [assetId]),
  ]);

  return {
    asset,
    healthHistory: history.rows.map(mapHealthSnapshot),
    alerts: alerts.rows.map(mapAlert),
  };
}

export async function listMonitoringAlerts(actor, filters = {}) {
  assertManageReadable(actor);
  const params = [actor.activeTenant.tenantId];
  const clauses = ['tenant_id = $1'];

  if (filters.state) {
    params.push(filters.state);
    clauses.push(`state = $${params.length}`);
  }

  if (filters.severity) {
    params.push(filters.severity);
    clauses.push(`severity = $${params.length}`);
  }

  const result = await query(
    `SELECT * FROM monitoring_alerts
     WHERE ${clauses.join(' AND ')}
     ORDER BY state ASC, severity DESC, triggered_at DESC`,
    params
  );

  return result.rows.map(mapAlert);
}

export async function runOfflineSweep() {
  const result = await query(
    `SELECT a.id
     FROM assets a
     JOIN asset_agents ag ON ag.asset_id = a.id
     WHERE ag.last_seen_at IS NOT NULL`
  );

  for (const row of result.rows) {
    await evaluateAlertsForAsset(row.id);
  }

  return { checkedAssets: result.rowCount };
}

async function evaluateAlertsForAsset(assetId) {
  const result = await query('SELECT * FROM monitoring_asset_status_v WHERE asset_id = $1', [assetId]);
  if (result.rowCount === 0) return;

  const asset = mapMonitoringAsset(result.rows[0]);
  const openRules = [];
  const nowIso = new Date().toISOString();
  const lastSeenMs = asset.lastSeenAt ? new Date(asset.lastSeenAt).getTime() : null;
  const offlineThresholdMs = env.monitoringOfflineThresholdMs;

  if (!lastSeenMs || (Date.now() - lastSeenMs) > offlineThresholdMs) {
    openRules.push({
      key: `offline:${asset.assetId}`,
      alertType: 'offline',
      severity: 'critical',
      title: `${asset.assetName} is offline`,
      message: `No heartbeat received within ${Math.round(offlineThresholdMs / 60000)} minutes.`,
      metadata: { lastSeenAt: asset.lastSeenAt, thresholdMs: offlineThresholdMs },
    });
  }

  if (asset.cpuPercent != null && Number(asset.cpuPercent) >= env.monitoringCpuWarningPercent) {
    openRules.push({
      key: `cpu:${asset.assetId}`,
      alertType: 'resource',
      severity: Number(asset.cpuPercent) >= env.monitoringCpuCriticalPercent ? 'critical' : 'warning',
      title: `${asset.assetName} CPU usage high`,
      message: `CPU usage at ${asset.cpuPercent}%`,
      metadata: { cpuPercent: asset.cpuPercent },
    });
  }

  if (asset.memoryPercent != null && Number(asset.memoryPercent) >= env.monitoringMemoryWarningPercent) {
    openRules.push({
      key: `memory:${asset.assetId}`,
      alertType: 'resource',
      severity: Number(asset.memoryPercent) >= env.monitoringMemoryCriticalPercent ? 'critical' : 'warning',
      title: `${asset.assetName} memory usage high`,
      message: `Memory usage at ${asset.memoryPercent}%`,
      metadata: { memoryPercent: asset.memoryPercent },
    });
  }

  if (asset.diskPercent != null && Number(asset.diskPercent) >= env.monitoringDiskWarningPercent) {
    openRules.push({
      key: `disk:${asset.assetId}`,
      alertType: 'resource',
      severity: Number(asset.diskPercent) >= env.monitoringDiskCriticalPercent ? 'critical' : 'warning',
      title: `${asset.assetName} disk usage high`,
      message: `Disk usage at ${asset.diskPercent}%`,
      metadata: { diskPercent: asset.diskPercent },
    });
  }

  if (asset.patchStatus && !['up-to-date', 'current', 'ok'].includes(asset.patchStatus)) {
    openRules.push({
      key: `patch:${asset.assetId}`,
      alertType: 'patch',
      severity: ['outdated', 'security-updates-available'].includes(asset.patchStatus) ? 'warning' : 'info',
      title: `${asset.assetName} patch status needs attention`,
      message: `Patch status reported as ${asset.patchStatus}`,
      metadata: { patchStatus: asset.patchStatus },
    });
  }

  const failingServices = (asset.services ?? []).filter((service) => !['running', 'active', 'ok'].includes(service.status));
  if (failingServices.length > 0) {
    openRules.push({
      key: `services:${asset.assetId}`,
      alertType: 'service',
      severity: 'warning',
      title: `${asset.assetName} has service issues`,
      message: `${failingServices.length} monitored services not running normally.`,
      metadata: { services: failingServices.map((service) => ({ serviceName: service.serviceName, status: service.status })) },
    });
  }

  const existing = await query('SELECT * FROM monitoring_alerts WHERE asset_id = $1 AND state = $2', [assetId, 'open']);
  const desiredKeys = new Set(openRules.map((rule) => rule.key));

  for (const rule of openRules) {
    await upsertAlert(asset, rule, nowIso);
  }

  for (const row of existing.rows) {
    if (!desiredKeys.has(row.alert_key)) {
      await query(
        `UPDATE monitoring_alerts
         SET state = 'resolved', resolved_at = $2, last_observed_at = $2
         WHERE id = $1`,
        [row.id, nowIso]
      );
    }
  }
}

async function upsertAlert(asset, rule, observedAt) {
  const result = await query('SELECT * FROM monitoring_alerts WHERE tenant_id = $1 AND alert_key = $2', [asset.tenantId, rule.key]);
  if (result.rowCount === 0) {
    await query(
      `INSERT INTO monitoring_alerts (asset_id, tenant_id, alert_type, severity, state, title, message, alert_key, triggered_at, last_observed_at, metadata)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8, $8, $9::jsonb)`,
      [asset.assetId, asset.tenantId, rule.alertType, rule.severity, rule.title, rule.message, rule.key, observedAt, JSON.stringify(rule.metadata ?? {})]
    );
    return;
  }

  const existing = result.rows[0];
  const nextSeverity = ALERT_SEVERITIES[rule.severity] > ALERT_SEVERITIES[existing.severity] ? rule.severity : existing.severity;
  await query(
    `UPDATE monitoring_alerts
     SET asset_id = $2,
         severity = $3,
         state = 'open',
         title = $4,
         message = $5,
         resolved_at = NULL,
         last_observed_at = $6,
         metadata = $7::jsonb
     WHERE id = $1`,
    [existing.id, asset.assetId, nextSeverity, rule.title, rule.message, observedAt, JSON.stringify(rule.metadata ?? {})]
  );
}

async function getAssetByAgentKey(agentKey) {
  const result = await query('SELECT * FROM assets WHERE agent_key = $1', [agentKey]);
  if (result.rowCount === 0) throw unauthorized('Invalid agent key');
  return mapAsset(result.rows[0]);
}

async function queryScopedMonitoring(actor) {
  if (isCustomer(actor)) {
    return query(
      `SELECT * FROM monitoring_asset_status_v
       WHERE customer_tenant_id = $1
       ORDER BY asset_name ASC`,
      [actor.activeTenant.tenantId]
    );
  }

  assertManageReadable(actor);
  return query(
    `SELECT * FROM monitoring_asset_status_v
     WHERE tenant_id = $1
     ORDER BY open_alert_count DESC, asset_name ASC`,
    [actor.activeTenant.tenantId]
  );
}

async function getScopedMonitoringAsset(actor, assetId) {
  const result = await query('SELECT * FROM monitoring_asset_status_v WHERE asset_id = $1', [assetId]);
  if (result.rowCount === 0) throw notFound('Monitored asset not found');
  const asset = mapMonitoringAsset(result.rows[0]);

  if (isCustomer(actor)) {
    if (asset.customerTenantId !== actor.activeTenant?.tenantId) throw forbidden('Asset is outside the active customer tenant');
    return asset;
  }

  assertManageReadable(actor);
  if (asset.tenantId !== actor.activeTenant?.tenantId && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Asset is outside the active MSP tenant');
  }
  return asset;
}

function assertManageReadable(actor) {
  const role = actor.activeTenant?.role ?? actor.user.platformRole;
  if (!MANAGE_ROLES.includes(role) && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Role cannot read monitoring operations');
  }
}

function isCustomer(actor) {
  return CUSTOMER_ROLES.includes(actor.activeTenant?.role);
}

function normalizeMetrics(metrics) {
  const cpuPercent = toNullableNumber(metrics.cpuPercent);
  const memoryPercent = toNullableNumber(metrics.memoryPercent);
  const diskPercent = toNullableNumber(metrics.diskPercent ?? metrics.disk?.usedPercent);
  return {
    cpuPercent,
    memoryPercent,
    diskPercent,
    uptimeSeconds: toNullableInteger(metrics.uptimeSeconds),
    loadOne: toNullableNumber(metrics.loadOne),
    loadFive: toNullableNumber(metrics.loadFive),
    loadFifteen: toNullableNumber(metrics.loadFifteen),
    extra: {
      cpuCores: toNullableInteger(metrics.cpuCores),
      totalMemoryBytes: toNullableInteger(metrics.totalMemoryBytes),
      freeMemoryBytes: toNullableInteger(metrics.freeMemoryBytes),
      totalDiskBytes: toNullableInteger(metrics.totalDiskBytes),
      freeDiskBytes: toNullableInteger(metrics.freeDiskBytes),
      diskMount: metrics.diskMount ?? '/',
      macAddresses: Array.isArray(metrics.macAddresses) ? metrics.macAddresses : [],
    },
  };
}

function normalizeServices(services) {
  return services
    .filter((service) => service?.serviceName || service?.name)
    .slice(0, 100)
    .map((service) => ({
      serviceName: String(service.serviceName ?? service.name).trim(),
      displayName: service.displayName ? String(service.displayName).trim() : null,
      status: String(service.status ?? 'unknown').trim().toLowerCase(),
      startupType: service.startupType ? String(service.startupType).trim().toLowerCase() : null,
      metadata: service.metadata ?? {},
    }));
}

function normalizeSoftware(software) {
  return software
    .filter((entry) => entry?.packageName || entry?.name)
    .slice(0, 250)
    .map((entry) => ({
      packageName: String(entry.packageName ?? entry.name).trim(),
      packageVersion: entry.packageVersion ? String(entry.packageVersion).trim() : null,
      vendor: entry.vendor ? String(entry.vendor).trim() : null,
      installSource: entry.installSource ? String(entry.installSource).trim() : null,
      installedAt: entry.installedAt ?? null,
      metadata: entry.metadata ?? {},
    }));
}

function normalizeNetwork(network) {
  return {
    primaryIp: network.primaryIp ? String(network.primaryIp).trim() : null,
    publicIp: network.publicIp ? String(network.publicIp).trim() : null,
    interfaces: Array.isArray(network.interfaces) ? network.interfaces.slice(0, 25) : [],
    defaultGateway: network.defaultGateway ? String(network.defaultGateway).trim() : null,
    dnsServers: Array.isArray(network.dnsServers) ? network.dnsServers.slice(0, 12).map((value) => String(value).trim()).filter(Boolean) : [],
    routes: Array.isArray(network.routes) ? network.routes.slice(0, 25) : [],
  };
}

function normalizeIdentity(identity, input, network) {
  return {
    platform: normalizePlatform(identity.platform ?? input.platform ?? input.os?.platform ?? 'unknown'),
    hostname: input.hostname ? String(input.hostname).trim() : null,
    fqdn: identity.fqdn ? String(identity.fqdn).trim() : null,
    primaryIp: identity.primaryIp ? String(identity.primaryIp).trim() : network.primaryIp,
    serialNumber: identity.serialNumber ? String(identity.serialNumber).trim() : null,
    machineGuid: identity.machineGuid ? String(identity.machineGuid).trim() : null,
    architecture: identity.architecture ? String(identity.architecture).trim() : input.os?.architecture?.trim() ?? null,
    osName: identity.osName ? String(identity.osName).trim() : input.os?.name?.trim() ?? null,
    osVersion: identity.osVersion ? String(identity.osVersion).trim() : input.os?.version?.trim() ?? null,
    osBuild: identity.osBuild ? String(identity.osBuild).trim() : input.os?.release?.trim() ?? null,
    vendor: identity.vendor ? String(identity.vendor).trim() : null,
    model: identity.model ? String(identity.model).trim() : null,
    domainOrWorkgroup: identity.domainOrWorkgroup ? String(identity.domainOrWorkgroup).trim() : null,
    timezone: identity.timezone ? String(identity.timezone).trim() : null,
    interfaces: Array.isArray(identity.interfaces) ? identity.interfaces.slice(0, 25) : network.interfaces,
    serialSource: identity.serialSource ? String(identity.serialSource).trim() : null,
    cpuModel: identity.cpuModel ? String(identity.cpuModel).trim() : null,
    dnsServers: Array.isArray(identity.dnsServers) ? identity.dnsServers.slice(0, 12).map((value) => String(value).trim()).filter(Boolean) : network.dnsServers,
    defaultGateway: identity.defaultGateway ? String(identity.defaultGateway).trim() : network.defaultGateway,
  };
}

function normalizeCapabilities(capabilities, input, services, installedSoftware, identity) {
  const platform = normalizePlatform(capabilities.platform ?? input.platform ?? identity.platform ?? 'unknown');
  const supportedActions = Array.isArray(capabilities.supportedActions) ? capabilities.supportedActions.slice(0, 50) : [];
  const supportedCollectors = Array.isArray(capabilities.supportedCollectors) ? capabilities.supportedCollectors.slice(0, 50) : [];
  return {
    platform,
    supportsWmi: capabilities.supportsWmi == null ? platform === 'windows' : Boolean(capabilities.supportsWmi),
    supportsCim: capabilities.supportsCim == null ? platform === 'windows' : Boolean(capabilities.supportsCim),
    supportsPowerShell: capabilities.supportsPowerShell == null ? platform === 'windows' : Boolean(capabilities.supportsPowerShell),
    supportsChocolatey: capabilities.supportsChocolatey == null ? platform === 'windows' : Boolean(capabilities.supportsChocolatey),
    supportsBash: capabilities.supportsBash == null ? platform === 'linux' || platform === 'macos' : Boolean(capabilities.supportsBash),
    supportsSystemctl: capabilities.supportsSystemctl == null ? services.length > 0 && platform === 'linux' : Boolean(capabilities.supportsSystemctl),
    supportsPackageManager: capabilities.supportsPackageManager == null ? installedSoftware.length > 0 : Boolean(capabilities.supportsPackageManager),
    supportedActions,
    supportedCollectors,
  };
}

function normalizePlatform(value) {
  const normalized = String(value ?? 'unknown').trim().toLowerCase();
  return AGENT_PLATFORMS.has(normalized) ? normalized : 'unknown';
}

function deriveStatus(explicitStatus, metrics, services, patchStatus) {
  if (explicitStatus) {
    if (!ASSET_STATUSES.has(explicitStatus)) throw badRequest('Invalid status');
    return explicitStatus;
  }

  const hasFailedService = services.some((service) => !['running', 'active', 'ok'].includes(service.status));
  if ((metrics.cpuPercent ?? 0) >= env.monitoringCpuCriticalPercent || (metrics.memoryPercent ?? 0) >= env.monitoringMemoryCriticalPercent || (metrics.diskPercent ?? 0) >= env.monitoringDiskCriticalPercent) {
    return 'critical';
  }
  if (hasFailedService || (metrics.cpuPercent ?? 0) >= env.monitoringCpuWarningPercent || (metrics.memoryPercent ?? 0) >= env.monitoringMemoryWarningPercent || (metrics.diskPercent ?? 0) >= env.monitoringDiskWarningPercent || ['outdated', 'security-updates-available'].includes(patchStatus)) {
    return 'warning';
  }
  return 'online';
}

function buildSummary(status, metrics, services, patchStatus) {
  const parts = [status];
  if (metrics.cpuPercent != null) parts.push(`cpu ${metrics.cpuPercent}%`);
  if (metrics.memoryPercent != null) parts.push(`ram ${metrics.memoryPercent}%`);
  if (metrics.diskPercent != null) parts.push(`disk ${metrics.diskPercent}%`);
  const failingServices = services.filter((service) => !['running', 'active', 'ok'].includes(service.status));
  if (failingServices.length > 0) parts.push(`${failingServices.length} service issue(s)`);
  if (patchStatus) parts.push(`patch ${patchStatus}`);
  return parts.join(' · ');
}

function mapAsset(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerTenantId: row.customer_tenant_id,
    assetName: row.asset_name,
    hostname: row.hostname,
    primaryIp: row.primary_ip,
    operatingSystem: row.operating_system,
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
    uptimeSeconds: row.uptime_seconds,
    loadOne: row.load_one,
    loadFive: row.load_five,
    loadFifteen: row.load_fifteen,
    osName: row.os_name,
    osVersion: row.os_version,
    osRelease: row.os_release,
    kernelVersion: row.kernel_version,
    architecture: row.architecture,
    publicIp: row.public_ip,
    patchStatus: row.patch_status,
    metrics: row.metrics,
    network: row.network,
    agentVersion: row.agent_version,
    summary: row.summary,
    observedAt: row.observed_at,
  };
}

function mapMonitoringAsset(row) {
  return {
    assetId: row.asset_id,
    tenantId: row.tenant_id,
    customerTenantId: row.customer_tenant_id,
    siteId: row.site_id,
    assetName: row.asset_name,
    assetType: row.asset_type,
    status: row.status,
    hostname: row.hostname,
    primaryIp: row.primary_ip,
    operatingSystem: row.operating_system,
    cpuPercent: row.cpu_percent,
    memoryPercent: row.memory_percent,
    diskPercent: row.disk_percent,
    uptimeSeconds: row.uptime_seconds,
    loadOne: row.load_one,
    loadFive: row.load_five,
    loadFifteen: row.load_fifteen,
    osName: row.os_name,
    osVersion: row.os_version,
    osRelease: row.os_release,
    kernelVersion: row.kernel_version,
    architecture: row.architecture,
    publicIp: row.public_ip,
    patchStatus: row.patch_status,
    metrics: row.metrics,
    network: row.network,
    summary: row.summary,
    latestHealthAt: row.latest_health_at,
    lastSeenAt: row.last_seen_at,
    registeredAt: row.registered_at,
    registeredAgentVersion: row.registered_agent_version,
    openAlertCount: Number(row.open_alert_count ?? 0),
    services: row.services ?? [],
    installedSoftware: row.installed_software ?? [],
  };
}

function mapAlert(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    tenantId: row.tenant_id,
    alertType: row.alert_type,
    severity: row.severity,
    state: row.state,
    title: row.title,
    message: row.message,
    alertKey: row.alert_key,
    triggeredAt: row.triggered_at,
    resolvedAt: row.resolved_at,
    lastObservedAt: row.last_observed_at,
    metadata: row.metadata,
  };
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
