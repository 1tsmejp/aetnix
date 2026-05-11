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


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'ticket_status_enum'
  ) THEN
    CREATE TYPE ticket_status_enum AS ENUM ('new', 'open', 'pending_customer', 'pending_vendor', 'resolved', 'closed');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'ticket_conversion_type_enum'
  ) THEN
    CREATE TYPE ticket_conversion_type_enum AS ENUM ('service_job', 'installation_project', 'internal_project_task');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number BIGSERIAL UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID REFERENCES customer_sites(id) ON DELETE SET NULL,
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  status ticket_status_enum NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'portal',
  category TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  requester_name TEXT,
  requester_email TEXT,
  requester_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  last_customer_reply_at TIMESTAMPTZ,
  last_technician_reply_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tickets_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);

CREATE INDEX IF NOT EXISTS tickets_tenant_status_idx ON tickets(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS tickets_customer_status_idx ON tickets(customer_tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS tickets_asset_idx ON tickets(asset_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS tickets_assigned_idx ON tickets(assigned_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_role TEXT,
  is_customer_visible BOOLEAN NOT NULL DEFAULT TRUE,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ticket_comments_ticket_idx ON ticket_comments(ticket_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ticket_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversion_type ticket_conversion_type_enum NOT NULL,
  target_ref TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ticket_conversions_status_check CHECK (status IN ('planned', 'queued', 'created', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS ticket_conversions_ticket_idx ON ticket_conversions(ticket_id, created_at DESC);

CREATE OR REPLACE VIEW ticket_portal_v AS
SELECT
  t.id,
  t.ticket_number,
  t.tenant_id,
  t.customer_tenant_id,
  t.site_id,
  t.asset_id,
  t.status,
  t.priority,
  t.source,
  t.category,
  t.subject,
  t.description,
  t.requester_name,
  t.requester_email,
  t.requester_user_id,
  t.assigned_user_id,
  assignee.full_name AS assigned_user_name,
  assignee.email AS assigned_user_email,
  t.last_customer_reply_at,
  t.last_technician_reply_at,
  t.resolved_at,
  t.closed_at,
  t.metadata,
  t.created_by_user_id,
  t.updated_by_user_id,
  t.created_at,
  t.updated_at,
  customer.display_name AS customer_name,
  customer.tenant_key AS customer_tenant_key,
  s.name AS site_name,
  a.asset_name,
  a.asset_type,
  a.primary_ip,
  COALESCE((SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id = t.id), 0) AS comment_count,
  COALESCE((SELECT COUNT(*) FROM ticket_conversions tc WHERE tc.ticket_id = t.id), 0) AS conversion_count
FROM tickets t
LEFT JOIN tenants customer ON customer.id = t.customer_tenant_id
LEFT JOIN customer_sites s ON s.id = t.site_id
LEFT JOIN assets a ON a.id = t.asset_id
LEFT JOIN users assignee ON assignee.id = t.assigned_user_id;
