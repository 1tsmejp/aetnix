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
