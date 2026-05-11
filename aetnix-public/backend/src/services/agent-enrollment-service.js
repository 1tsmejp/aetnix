import crypto from 'crypto';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { env } from '../config/env.js';
import { query, withTransaction } from './db.js';

const MANAGE_ROLES = ['platform_admin', 'msp_admin', 'project_manager', 'technician', 'installer'];
const CUSTOMER_ROLES = ['customer_admin', 'customer_user'];
const ENROLLMENT_PLATFORMS = new Set(['windows', 'linux', 'macos', 'unknown']);
const PACKAGE_KINDS = new Set(['config', 'powershell-bootstrap', 'bash-bootstrap']);

export async function getAssetAgentDetail(actor, assetId) {
  const asset = await getScopedAsset(actor, assetId);
  const [agentResult, enrollmentsResult, actionsResult] = await Promise.all([
    query('SELECT * FROM asset_agents WHERE asset_id = $1', [assetId]),
    query('SELECT * FROM asset_agent_enrollments WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 10', [assetId]),
    query("SELECT * FROM monitoring_alerts WHERE asset_id = $1 ORDER BY triggered_at DESC LIMIT 5", [assetId]),
  ]);

  return {
    asset,
    agent: agentResult.rows[0] ? mapAgent(agentResult.rows[0]) : null,
    enrollments: enrollmentsResult.rows.map(mapEnrollment),
    recentAlerts: actionsResult.rows.map(mapAlert),
  };
}

export async function createAssetEnrollment(actor, assetId, input = {}) {
  assertManageWritable(actor);
  const asset = await getScopedAsset(actor, assetId);
  const platform = normalizePlatform(input.platform ?? 'unknown');
  const packageKind = normalizePackageKind(input.packageKind ?? inferPackageKind(platform));
  const expiresInMinutes = clampNumber(input.expiresInMinutes, 10, 24 * 60, 120);
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashEnrollmentToken(token);
  const tokenHint = `${token.slice(0, 6)}…${token.slice(-4)}`;
  const metadata = sanitizeMetadata(input.metadata);

  const result = await query(
    `INSERT INTO asset_agent_enrollments (
      asset_id, tenant_id, customer_tenant_id, site_id, created_by_user_id,
      enrollment_token_hash, enrollment_token_hint, label, platform, package_kind,
      expires_at, metadata
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9::agent_platform_enum, $10,
      $11, $12::jsonb
    ) RETURNING *`,
    [
      asset.id,
      asset.tenantId,
      asset.customerTenantId,
      asset.siteId,
      actor.user.id,
      tokenHash,
      tokenHint,
      input.label?.trim() || null,
      platform,
      packageKind,
      expiresAt,
      JSON.stringify(metadata),
    ]
  );

  const enrollment = mapEnrollment(result.rows[0]);
  return {
    enrollment,
    token,
    package: buildEnrollmentPackage(asset, enrollment, token, input.apiBaseUrl),
  };
}

export async function getAssetEnrollmentPackage(actor, assetId, input = {}) {
  assertManageWritable(actor);
  const created = await createAssetEnrollment(actor, assetId, input);
  await query('UPDATE asset_agent_enrollments SET last_previewed_at = NOW(), updated_at = NOW() WHERE id = $1', [created.enrollment.id]);
  return created;
}

export async function enrollAgent(input = {}) {
  if (!input.enrollmentToken?.trim()) throw badRequest('enrollmentToken is required');
  const tokenHash = hashEnrollmentToken(input.enrollmentToken.trim());
  const enrollmentResult = await query(
    `SELECT *
     FROM asset_agent_enrollments
     WHERE enrollment_token_hash = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [tokenHash]
  );

  if (enrollmentResult.rowCount === 0) throw unauthorized('Invalid enrollment token');
  const enrollment = enrollmentResult.rows[0];
  if (enrollment.status !== 'ready') throw unauthorized('Enrollment token is no longer active');
  if (new Date(enrollment.expires_at).getTime() < Date.now()) {
    await query("UPDATE asset_agent_enrollments SET status = 'expired', updated_at = NOW() WHERE id = $1", [enrollment.id]);
    throw unauthorized('Enrollment token has expired');
  }

  const assetResult = await query('SELECT * FROM assets WHERE id = $1', [enrollment.asset_id]);
  if (assetResult.rowCount === 0) throw notFound('Asset not found for enrollment');
  const asset = mapAsset(assetResult.rows[0]);
  const platform = normalizePlatform(input.platform ?? enrollment.platform ?? 'unknown');
  const identity = normalizeIdentity(input.identity ?? {}, input.hostname);
  const capabilities = normalizeCapabilities(input.capabilities ?? {}, platform);
  const agentKey = crypto.randomBytes(18).toString('hex');
  const metadata = sanitizeMetadata(input.metadata);
  const observedAt = input.observedAt ? new Date(input.observedAt).toISOString() : new Date().toISOString();

  const registration = await withTransaction(async (client) => {
    await client.query('UPDATE assets SET agent_key = $2, hostname = COALESCE($3, hostname), primary_ip = COALESCE($4, primary_ip), updated_at = NOW() WHERE id = $1', [asset.id, agentKey, identity.hostname ?? null, identity.primaryIp ?? null]);

    const agentResult = await client.query(
      `INSERT INTO asset_agents (
        asset_id, tenant_id, customer_tenant_id, enrollment_id,
        agent_version, last_seen_at, registered_at, registration_metadata,
        platform, platform_release, architecture, capabilities, identity, last_reported_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, NOW(), $7::jsonb,
        $8::agent_platform_enum, $9, $10, $11::jsonb, $12::jsonb, $6
      )
      ON CONFLICT (asset_id)
      DO UPDATE SET enrollment_id = EXCLUDED.enrollment_id,
                    agent_version = COALESCE(EXCLUDED.agent_version, asset_agents.agent_version),
                    last_seen_at = EXCLUDED.last_seen_at,
                    registration_metadata = asset_agents.registration_metadata || EXCLUDED.registration_metadata,
                    platform = EXCLUDED.platform,
                    platform_release = COALESCE(EXCLUDED.platform_release, asset_agents.platform_release),
                    architecture = COALESCE(EXCLUDED.architecture, asset_agents.architecture),
                    capabilities = EXCLUDED.capabilities,
                    identity = EXCLUDED.identity,
                    last_reported_at = EXCLUDED.last_reported_at
      RETURNING *`,
      [
        asset.id,
        asset.tenantId,
        asset.customerTenantId,
        enrollment.id,
        input.agentVersion?.trim() ?? null,
        observedAt,
        JSON.stringify(metadata),
        platform,
        identity.osVersion ?? input.platformRelease ?? null,
        identity.architecture ?? input.architecture ?? null,
        JSON.stringify(capabilities),
        JSON.stringify(identity),
      ]
    );

    await client.query(
      `UPDATE asset_agent_enrollments
       SET status = 'used', used_at = $2, used_by_hostname = $3, used_by_ip = $4, updated_at = NOW()
       WHERE id = $1`,
      [enrollment.id, observedAt, identity.hostname ?? null, identity.primaryIp ?? null]
    );

    await client.query(
      `INSERT INTO asset_health_snapshots (
        asset_id, tenant_id, status, agent_version, summary, observed_at, identity, capabilities
      ) VALUES (
        $1, $2, 'online'::asset_status_enum, $3, $4, $5, $6::jsonb, $7::jsonb
      )`,
      [asset.id, asset.tenantId, input.agentVersion?.trim() ?? null, 'Agent enrolled', observedAt, JSON.stringify(identity), JSON.stringify(capabilities)]
    );

    return agentResult.rows[0];
  });

  return {
    asset: { ...asset, agentKey },
    enrollment: mapEnrollment({ ...enrollment, status: 'used', used_at: observedAt }),
    registration: mapAgent(registration),
    credential: {
      agentKey,
      apiBaseUrl: input.apiBaseUrl?.trim() || inferApiBaseUrl(),
      heartbeatPath: '/v1/monitoring/heartbeat',
      enrollPath: '/v1/assets/enroll-agent',
    },
  };
}

function buildEnrollmentPackage(asset, enrollment, token, explicitApiBaseUrl) {
  const apiBaseUrl = explicitApiBaseUrl?.trim() || inferApiBaseUrl();
  const platform = enrollment.platform;
  const assetSlug = sanitizeFileComponent(asset.assetName) || asset.id;
  const configFileName = 'aetnix-agent-config.json';
  const config = {
    version: 1,
    issuedAt: enrollment.createdAt,
    enrollmentToken: token,
    apiBaseUrl,
    tenant: {
      tenantId: asset.tenantId,
      customerTenantId: asset.customerTenantId,
      siteId: asset.siteId,
    },
    asset: {
      assetId: asset.id,
      assetName: asset.assetName,
      assetType: asset.assetType,
      hostname: asset.hostname,
      primaryIp: asset.primaryIp,
    },
    enrollment: {
      id: enrollment.id,
      platform,
      packageKind: enrollment.packageKind,
      expiresAt: enrollment.expiresAt,
      status: enrollment.status,
    },
  };

  const bootstrap = buildBootstrapScript(platform, config);
  const readme = buildArtifactReadme({ asset, enrollment, configFileName, bootstrapFileName: bootstrap?.fileName, apiBaseUrl });
  const artifacts = buildArtifacts({ assetSlug, platform, config, configFileName, bootstrap, readme });

  return {
    fileName: `aetnix-agent-${assetSlug}-${platform}.json`,
    mediaType: 'application/json',
    config,
    bootstrap,
    artifacts,
  };
}

function buildBootstrapScript(platform, config) {
  const serialized = JSON.stringify(config, null, 2);
  if (platform === 'windows') {
    return {
      fileName: 'install-aetnix-agent.ps1',
      content: `$config = @'\n${serialized}\n'@\n$config | Set-Content -Path .\\aetnix-agent-config.json\nWrite-Host \"Saved enrollment config to aetnix-agent-config.json\"\nWrite-Host \"Next: run the packaged agent with this config to enroll.\"`,
    };
  }

  return {
    fileName: 'install-aetnix-agent.sh',
    content: `cat > ./aetnix-agent-config.json <<'EOF'\n${serialized}\nEOF\necho \"Saved enrollment config to ./aetnix-agent-config.json\"\necho \"Next: run the packaged agent with this config to enroll.\"`,
  };
}

function buildArtifactReadme({ asset, enrollment, configFileName, bootstrapFileName, apiBaseUrl }) {
  const lines = [
    'AETNIX agent enrollment package',
    '',
    `Asset: ${asset.assetName} (${asset.assetType})`,
    `Platform: ${enrollment.platform}`,
    `Token expires: ${enrollment.expiresAt}`,
    `API base URL: ${apiBaseUrl}`,
    '',
    'Included files:',
    `- ${configFileName} (enrollment config)`,
  ];

  if (bootstrapFileName) lines.push(`- ${bootstrapFileName} (bootstrap helper)`);

  lines.push(
    '',
    'Recommended flow:',
    `1. Extract this archive onto the target ${enrollment.platform} system.`,
    `2. Review ${configFileName}.`,
    bootstrapFileName ? `3. Run ${bootstrapFileName} to stage the config for the agent runtime.` : '3. Use the config file with the agent runtime.',
    '4. Start the packaged AETNIX agent runtime to exchange the one-time token for an agent key.',
    '',
    'This enrollment token is one-time use and time-limited.',
  );

  return {
    fileName: 'README.txt',
    content: `${lines.join('\n')}\n`,
  };
}

function buildArtifacts({ assetSlug, platform, config, configFileName, bootstrap, readme }) {
  const configContent = JSON.stringify(config, null, 2);
  const files = [
    { fileName: configFileName, content: configContent, mediaType: 'application/json' },
    { fileName: readme.fileName, content: readme.content, mediaType: 'text/plain;charset=utf-8' },
  ];

  if (bootstrap?.content) {
    files.push({ fileName: bootstrap.fileName, content: bootstrap.content, mediaType: 'text/plain;charset=utf-8' });
  }

  const bundleBuffer = buildZipArchive(files.map((file) => ({ fileName: file.fileName, content: Buffer.from(file.content, 'utf8') })));

  return [
    {
      kind: 'bundle',
      fileName: `aetnix-agent-${assetSlug}-${platform}.zip`,
      mediaType: 'application/zip',
      encoding: 'base64',
      contentBase64: bundleBuffer.toString('base64'),
      entryCount: files.length,
    },
    ...files.map((file) => ({
      kind: file.fileName === configFileName ? 'config' : file.fileName === bootstrap?.fileName ? 'bootstrap' : 'readme',
      fileName: file.fileName,
      mediaType: file.mediaType,
      encoding: 'utf8',
      content: file.content,
    })),
  ];
}

function buildZipArchive(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const fileNameBuffer = Buffer.from(file.fileName.replace(/\\/g, '/'), 'utf8');
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content ?? '', 'utf8');
    const crc32 = computeCrc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc32 >>> 0, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(fileNameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, fileNameBuffer, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc32 >>> 0, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(fileNameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, fileNameBuffer);
    offset += localHeader.length + fileNameBuffer.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function computeCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sanitizeFileComponent(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferApiBaseUrl() {
  const prefix = env.apiPrefix.startsWith('/') ? env.apiPrefix : `/${env.apiPrefix}`;
  return `http://localhost:${env.port}${prefix}`;
}

function hashEnrollmentToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizePlatform(value) {
  const normalized = String(value ?? 'unknown').trim().toLowerCase();
  if (!ENROLLMENT_PLATFORMS.has(normalized)) throw badRequest('Invalid platform');
  return normalized;
}

function normalizePackageKind(value) {
  const normalized = String(value ?? 'config').trim().toLowerCase();
  if (!PACKAGE_KINDS.has(normalized)) throw badRequest('Invalid packageKind');
  return normalized;
}

function inferPackageKind(platform) {
  if (platform === 'windows') return 'powershell-bootstrap';
  if (platform === 'linux') return 'bash-bootstrap';
  return 'config';
}

function normalizeIdentity(identity, hostname) {
  const next = {
    hostname: normalizeOptionalText(identity.hostname ?? hostname),
    fqdn: normalizeOptionalText(identity.fqdn),
    primaryIp: normalizeOptionalText(identity.primaryIp),
    serialNumber: normalizeOptionalText(identity.serialNumber),
    machineGuid: normalizeOptionalText(identity.machineGuid),
    architecture: normalizeOptionalText(identity.architecture),
    osName: normalizeOptionalText(identity.osName),
    osVersion: normalizeOptionalText(identity.osVersion),
    osBuild: normalizeOptionalText(identity.osBuild),
    vendor: normalizeOptionalText(identity.vendor),
    model: normalizeOptionalText(identity.model),
    domainOrWorkgroup: normalizeOptionalText(identity.domainOrWorkgroup),
    timezone: normalizeOptionalText(identity.timezone),
    interfaces: Array.isArray(identity.interfaces) ? identity.interfaces.slice(0, 20) : [],
  };
  return next;
}

function normalizeCapabilities(capabilities, platform) {
  const bool = (value, fallback = false) => value == null ? fallback : Boolean(value);
  return {
    platform,
    supportsWmi: bool(capabilities.supportsWmi, platform === 'windows'),
    supportsCim: bool(capabilities.supportsCim, platform === 'windows'),
    supportsPowerShell: bool(capabilities.supportsPowerShell, platform === 'windows'),
    supportsChocolatey: bool(capabilities.supportsChocolatey, platform === 'windows'),
    supportsBash: bool(capabilities.supportsBash, platform === 'linux' || platform === 'macos'),
    supportsSystemctl: bool(capabilities.supportsSystemctl, platform === 'linux'),
    supportsPackageManager: bool(capabilities.supportsPackageManager, platform === 'linux' || platform === 'windows'),
    supportedCollectors: Array.isArray(capabilities.supportedCollectors) ? capabilities.supportedCollectors.slice(0, 50) : [],
    supportedActions: Array.isArray(capabilities.supportedActions) ? capabilities.supportedActions.slice(0, 50) : [],
  };
}

async function getScopedAsset(actor, assetId) {
  const result = await query('SELECT * FROM assets WHERE id = $1', [assetId]);
  if (result.rowCount === 0) throw notFound('Asset not found');
  const asset = mapAsset(result.rows[0]);

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
    throw forbidden('Role cannot read agent operations');
  }
}

function assertManageWritable(actor) {
  const role = actor.activeTenant?.role ?? actor.user.platformRole;
  if (!MANAGE_ROLES.includes(role) && actor.user.platformRole !== 'platform_admin') {
    throw forbidden('Role cannot manage agent operations');
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
    hostname: row.hostname,
    primaryIp: row.primary_ip,
  };
}

function mapEnrollment(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    tenantId: row.tenant_id,
    customerTenantId: row.customer_tenant_id,
    siteId: row.site_id,
    createdByUserId: row.created_by_user_id,
    tokenHint: row.enrollment_token_hint,
    label: row.label,
    platform: row.platform,
    packageKind: row.package_kind,
    status: row.status,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedByHostname: row.used_by_hostname,
    usedByIp: row.used_by_ip,
    lastPreviewedAt: row.last_previewed_at,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgent(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    tenantId: row.tenant_id,
    customerTenantId: row.customer_tenant_id,
    enrollmentId: row.enrollment_id,
    agentVersion: row.agent_version,
    lastSeenAt: row.last_seen_at,
    registeredAt: row.registered_at,
    registrationMetadata: row.registration_metadata,
    platform: row.platform,
    platformRelease: row.platform_release,
    architecture: row.architecture,
    capabilities: row.capabilities,
    identity: row.identity,
    lastReportedAt: row.last_reported_at,
  };
}

function mapAlert(row) {
  return {
    id: row.id,
    severity: row.severity,
    state: row.state,
    title: row.title,
    triggeredAt: row.triggered_at,
  };
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeOptionalText(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}
