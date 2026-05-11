DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'asset_agent_enrollment_status_enum'
  ) THEN
    CREATE TYPE asset_agent_enrollment_status_enum AS ENUM ('ready', 'used', 'expired', 'revoked');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'agent_platform_enum'
  ) THEN
    CREATE TYPE agent_platform_enum AS ENUM ('windows', 'linux', 'macos', 'unknown');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS asset_agent_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID REFERENCES customer_sites(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES users(id),
  enrollment_token_hash TEXT NOT NULL,
  enrollment_token_hint TEXT,
  label TEXT,
  platform agent_platform_enum NOT NULL DEFAULT 'unknown',
  package_kind TEXT NOT NULL DEFAULT 'config',
  status asset_agent_enrollment_status_enum NOT NULL DEFAULT 'ready',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_hostname TEXT,
  used_by_ip TEXT,
  last_previewed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asset_agent_enrollments_asset_idx ON asset_agent_enrollments(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS asset_agent_enrollments_tenant_idx ON asset_agent_enrollments(tenant_id, status, expires_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS asset_agent_enrollments_token_hash_idx ON asset_agent_enrollments(enrollment_token_hash);

ALTER TABLE asset_agents
  ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES asset_agent_enrollments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS platform agent_platform_enum NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS platform_release TEXT,
  ADD COLUMN IF NOT EXISTS architecture TEXT,
  ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS identity JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_reported_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS asset_agents_platform_idx ON asset_agents(tenant_id, platform, last_seen_at DESC);

ALTER TABLE asset_health_snapshots
  ADD COLUMN IF NOT EXISTS identity JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE VIEW asset_health_summary_v AS
SELECT
  a.id AS asset_id,
  a.tenant_id,
  a.customer_tenant_id,
  a.site_id,
  a.asset_name,
  a.asset_type,
  a.lifecycle_state,
  a.status,
  a.hostname,
  a.primary_ip,
  h.cpu_percent,
  h.memory_percent,
  h.disk_percent,
  h.agent_version,
  h.summary,
  h.observed_at AS latest_health_at,
  ag.registered_at,
  ag.last_seen_at,
  ag.agent_version AS registered_agent_version,
  ag.platform AS agent_platform,
  ag.platform_release AS agent_platform_release,
  ag.architecture AS agent_architecture,
  ag.capabilities AS agent_capabilities,
  ag.identity AS agent_identity,
  ag.last_reported_at,
  ae.id AS latest_enrollment_id,
  ae.status AS latest_enrollment_status,
  ae.platform AS latest_enrollment_platform,
  ae.package_kind AS latest_enrollment_package_kind,
  ae.expires_at AS latest_enrollment_expires_at,
  ae.used_at AS latest_enrollment_used_at,
  ae.created_at AS latest_enrollment_created_at
FROM assets a
LEFT JOIN LATERAL (
  SELECT *
  FROM asset_health_snapshots hs
  WHERE hs.asset_id = a.id
  ORDER BY hs.observed_at DESC
  LIMIT 1
) h ON TRUE
LEFT JOIN asset_agents ag ON ag.asset_id = a.id
LEFT JOIN LATERAL (
  SELECT *
  FROM asset_agent_enrollments ae
  WHERE ae.asset_id = a.id
  ORDER BY ae.created_at DESC
  LIMIT 1
) ae ON TRUE;

CREATE OR REPLACE VIEW monitoring_asset_status_v AS
SELECT
  a.id AS asset_id,
  a.tenant_id,
  a.customer_tenant_id,
  a.site_id,
  a.asset_name,
  a.asset_type,
  a.status,
  a.hostname,
  a.primary_ip,
  a.operating_system,
  hs.cpu_percent,
  hs.memory_percent,
  hs.disk_percent,
  hs.uptime_seconds,
  hs.load_one,
  hs.load_five,
  hs.load_fifteen,
  hs.os_name,
  hs.os_version,
  hs.os_release,
  hs.kernel_version,
  hs.architecture,
  hs.public_ip,
  hs.patch_status,
  hs.metrics,
  hs.network,
  hs.identity,
  hs.capabilities,
  hs.summary,
  hs.agent_version,
  hs.observed_at AS latest_health_at,
  ag.last_seen_at,
  ag.registered_at,
  ag.agent_version AS registered_agent_version,
  ag.platform AS agent_platform,
  ag.platform_release AS agent_platform_release,
  ag.architecture AS agent_architecture,
  ag.capabilities AS agent_capabilities,
  ag.identity AS agent_identity,
  ag.last_reported_at,
  COALESCE((SELECT COUNT(*) FROM monitoring_alerts ma WHERE ma.asset_id = a.id AND ma.state = 'open'), 0) AS open_alert_count,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'serviceName', s.service_name,
    'displayName', s.display_name,
    'status', s.status,
    'startupType', s.startup_type,
    'metadata', s.metadata,
    'observedAt', s.observed_at
  ) ORDER BY s.service_name) FROM asset_services s WHERE s.asset_id = a.id), '[]'::jsonb) AS services,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'packageName', sw.package_name,
    'packageVersion', sw.package_version,
    'vendor', sw.vendor,
    'installSource', sw.install_source,
    'installedAt', sw.installed_at,
    'metadata', sw.metadata,
    'observedAt', sw.observed_at
  ) ORDER BY sw.package_name) FROM asset_software_inventory sw WHERE sw.asset_id = a.id), '[]'::jsonb) AS installed_software
FROM assets a
LEFT JOIN LATERAL (
  SELECT *
  FROM asset_health_snapshots hs
  WHERE hs.asset_id = a.id
  ORDER BY hs.observed_at DESC
  LIMIT 1
) hs ON TRUE
LEFT JOIN asset_agents ag ON ag.asset_id = a.id;
