ALTER TABLE asset_health_snapshots
  ADD COLUMN IF NOT EXISTS uptime_seconds BIGINT,
  ADD COLUMN IF NOT EXISTS load_one NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS load_five NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS load_fifteen NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS os_name TEXT,
  ADD COLUMN IF NOT EXISTS os_version TEXT,
  ADD COLUMN IF NOT EXISTS os_release TEXT,
  ADD COLUMN IF NOT EXISTS kernel_version TEXT,
  ADD COLUMN IF NOT EXISTS architecture TEXT,
  ADD COLUMN IF NOT EXISTS public_ip TEXT,
  ADD COLUMN IF NOT EXISTS patch_status TEXT,
  ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS network JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS asset_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  startup_type TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (asset_id, service_name)
);

CREATE INDEX IF NOT EXISTS asset_services_asset_idx ON asset_services(asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS asset_services_tenant_status_idx ON asset_services(tenant_id, status, observed_at DESC);

CREATE TABLE IF NOT EXISTS asset_software_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  package_version TEXT,
  vendor TEXT,
  install_source TEXT,
  installed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (asset_id, package_name)
);

CREATE INDEX IF NOT EXISTS asset_software_inventory_asset_idx ON asset_software_inventory(asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS asset_software_inventory_tenant_idx ON asset_software_inventory(tenant_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  message TEXT,
  alert_key TEXT NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, alert_key)
);

CREATE INDEX IF NOT EXISTS monitoring_alerts_asset_idx ON monitoring_alerts(asset_id, state, triggered_at DESC);
CREATE INDEX IF NOT EXISTS monitoring_alerts_tenant_state_idx ON monitoring_alerts(tenant_id, state, severity, triggered_at DESC);

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
  hs.summary,
  hs.agent_version,
  hs.observed_at AS latest_health_at,
  ag.last_seen_at,
  ag.registered_at,
  ag.agent_version AS registered_agent_version,
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
