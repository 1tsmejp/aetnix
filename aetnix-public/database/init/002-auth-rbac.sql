CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'project_type_enum'
  ) THEN
    CREATE TYPE project_type_enum AS ENUM ('service', 'installation');
  END IF;
END $$;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'msp',
  ADD COLUMN IF NOT EXISTS parent_tenant_id UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id),
  CONSTRAINT tenant_memberships_role_check CHECK (
    role IN (
      'platform_admin',
      'msp_admin',
      'project_manager',
      'technician',
      'installer',
      'customer_admin',
      'customer_user'
    )
  )
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_hash_idx ON auth_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_role_idx ON tenant_memberships(tenant_id, role);
CREATE INDEX IF NOT EXISTS tenants_parent_tenant_idx ON tenants(parent_tenant_id);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  project_type project_type_enum NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_at TIMESTAMPTZ,
  summary TEXT,
  created_by_user_id UUID REFERENCES users(id),
  updated_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT projects_status_check CHECK (
    status IN ('draft', 'planned', 'active', 'approved', 'completed', 'archived')
  )
);

CREATE INDEX IF NOT EXISTS projects_tenant_idx ON projects(tenant_id, customer_tenant_id, status);

CREATE TABLE IF NOT EXISTS project_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_type project_type_enum NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  title TEXT NOT NULL,
  details TEXT,
  created_by_user_id UUID REFERENCES users(id),
  updated_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_jobs_status_check CHECK (
    status IN ('queued', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS project_jobs_project_idx ON project_jobs(project_id, tenant_id, job_type, status);
