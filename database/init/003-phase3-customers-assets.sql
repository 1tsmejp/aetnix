DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'asset_type_enum'
  ) THEN
    CREATE TYPE asset_type_enum AS ENUM ('server', 'workstation', 'network', 'printer', 'mobile', 'vm', 'appliance', 'other');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'asset_status_enum'
  ) THEN
    CREATE TYPE asset_status_enum AS ENUM ('online', 'warning', 'critical', 'offline', 'unknown');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'asset_relation_type_enum'
  ) THEN
    CREATE TYPE asset_relation_type_enum AS ENUM ('ticket', 'service_job', 'installation_project', 'monitoring_alert');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS customer_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  site_code TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state_region TEXT,
  postal_code TEXT,
  country_code TEXT,
  timezone TEXT,
  primary_contact_name TEXT,
  primary_contact_email TEXT,
  primary_contact_phone TEXT,
  notes TEXT,
  created_by_user_id UUID REFERENCES users(id),
  updated_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_tenant_id, name)
);

CREATE INDEX IF NOT EXISTS customer_sites_customer_idx ON customer_sites(customer_tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_sites_tenant_idx ON customer_sites(tenant_id, customer_tenant_id);

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID REFERENCES customer_sites(id) ON DELETE SET NULL,
  asset_name TEXT NOT NULL,
  asset_type asset_type_enum NOT NULL DEFAULT 'other',
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  hostname TEXT,
  primary_ip TEXT,
  operating_system TEXT,
  warranty_expires_at TIMESTAMPTZ,
  status asset_status_enum NOT NULL DEFAULT 'unknown',
  lifecycle_state TEXT NOT NULL DEFAULT 'active',
  agent_key TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  notes TEXT,
  created_by_user_id UUID REFERENCES users(id),
  updated_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, agent_key),
  CONSTRAINT assets_lifecycle_state_check CHECK (lifecycle_state IN ('active', 'staged', 'retired', 'disposed'))
);

CREATE INDEX IF NOT EXISTS assets_customer_idx ON assets(customer_tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS assets_tenant_site_idx ON assets(tenant_id, site_id);
CREATE INDEX IF NOT EXISTS assets_serial_idx ON assets(serial_number);
CREATE INDEX IF NOT EXISTS assets_hostname_idx ON assets(hostname);

CREATE TABLE IF NOT EXISTS asset_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_version TEXT,
  last_seen_at TIMESTAMPTZ,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registration_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (asset_id)
);

CREATE INDEX IF NOT EXISTS asset_agents_last_seen_idx ON asset_agents(tenant_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS asset_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status asset_status_enum NOT NULL,
  cpu_percent NUMERIC(5,2),
  memory_percent NUMERIC(5,2),
  disk_percent NUMERIC(5,2),
  agent_version TEXT,
  summary TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asset_health_snapshots_asset_idx ON asset_health_snapshots(asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS asset_health_snapshots_tenant_idx ON asset_health_snapshots(tenant_id, status, observed_at DESC);

CREATE TABLE IF NOT EXISTS asset_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  relation_type asset_relation_type_enum NOT NULL,
  external_ref TEXT NOT NULL,
  label TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (asset_id, relation_type, external_ref)
);

CREATE INDEX IF NOT EXISTS asset_relationships_asset_idx ON asset_relationships(asset_id, relation_type, created_at DESC);

CREATE OR REPLACE VIEW customer_dashboard_v AS
SELECT
  c.id AS customer_tenant_id,
  c.parent_tenant_id AS tenant_id,
  c.tenant_key,
  c.display_name,
  c.status,
  c.approved_at,
  COUNT(DISTINCT s.id) AS site_count,
  COUNT(DISTINCT a.id) AS asset_count,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'online') AS online_asset_count,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'warning') AS warning_asset_count,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'critical') AS critical_asset_count,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'offline') AS offline_asset_count,
  MAX(h.observed_at) AS latest_health_at
FROM tenants c
LEFT JOIN customer_sites s ON s.customer_tenant_id = c.id
LEFT JOIN assets a ON a.customer_tenant_id = c.id
LEFT JOIN LATERAL (
  SELECT observed_at
  FROM asset_health_snapshots hs
  WHERE hs.asset_id = a.id
  ORDER BY observed_at DESC
  LIMIT 1
) h ON TRUE
WHERE c.kind = 'customer'
GROUP BY c.id, c.parent_tenant_id, c.tenant_key, c.display_name, c.status, c.approved_at;

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
  ag.agent_version AS registered_agent_version
FROM assets a
LEFT JOIN LATERAL (
  SELECT *
  FROM asset_health_snapshots hs
  WHERE hs.asset_id = a.id
  ORDER BY hs.observed_at DESC
  LIMIT 1
) h ON TRUE
LEFT JOIN asset_agents ag ON ag.asset_id = a.id;
