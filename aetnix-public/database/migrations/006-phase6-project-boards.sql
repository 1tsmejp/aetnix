ALTER TYPE project_type_enum ADD VALUE IF NOT EXISTS 'internal';

ALTER TABLE projects
  ALTER COLUMN customer_tenant_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES customer_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN ('draft', 'planned', 'active', 'approved', 'completed', 'archived'));
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_priority_check;
ALTER TABLE projects ADD CONSTRAINT projects_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

CREATE TABLE IF NOT EXISTS project_board_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  column_key TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 1,
  wip_limit INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, column_key)
);

CREATE INDEX IF NOT EXISTS project_board_columns_project_idx ON project_board_columns(project_id, position);

ALTER TABLE project_jobs
  ADD COLUMN IF NOT EXISTS board_column_key TEXT,
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS customer_site_id UUID REFERENCES customer_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS comments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS labor_entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS material_entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS activity_history JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE project_jobs DROP CONSTRAINT IF EXISTS project_jobs_status_check;
ALTER TABLE project_jobs ADD CONSTRAINT project_jobs_status_check CHECK (status IN ('queued', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled'));
ALTER TABLE project_jobs DROP CONSTRAINT IF EXISTS project_jobs_priority_check;
ALTER TABLE project_jobs ADD CONSTRAINT project_jobs_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS project_jobs_board_idx ON project_jobs(project_id, board_column_key, position, updated_at DESC);
CREATE INDEX IF NOT EXISTS project_jobs_assigned_idx ON project_jobs(tenant_id, assigned_user_id, due_at);
CREATE INDEX IF NOT EXISTS project_jobs_due_idx ON project_jobs(tenant_id, due_at);
