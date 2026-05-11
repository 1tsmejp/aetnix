# AETNIX

## GitHub-ready deployment quick links

- Public deployment guide: `docs/deployment.md`
- Nginx reverse-proxy example: `docs/reverse-proxy/nginx.conf.example`
- Traefik reverse-proxy example: `docs/reverse-proxy/traefik.dynamic.yml.example`
- Publishing checklist: `docs/github-publishing-checklist.md`

Phase 9 starts the concrete agent enrollment vertical slice. The platform now has asset-bound enrollment tokens/packages, asset-side UI entry points for package generation, and richer agent identity/capability plumbing for Windows/Linux growth, while keeping the prior service-vs-installation workflow separation from Phase 8.

## Phase 9 Deliverables

- Asset-bound one-time enrollment records with expiry, status, token hashing, platform targeting, and package metadata
- New asset agent APIs for package generation, enrollment token minting, asset agent detail, and agent enrollment exchange
- Asset detail UI now exposes an Agent enrollment card plus a Generate agent package flow from the Assets side
- Agent foundation now supports enrollment config bootstrap, richer identity reporting, platform/capability reporting, and a Windows/Linux-ready collector/action declaration model
- Monitoring persistence now stores identity/capability payloads alongside snapshots and registered agent state
- Database migration `007-phase9-agent-enrollment.sql` adds the new schema/view fields needed for this slice

## Phase 8 Deliverables

- Service workflow profile tuned for break/fix, troubleshooting, recurring maintenance, monitoring response, SLA/due-date pressure, and technician dispatch
- Installation workflow profile tuned for scoping, procurement, multi-day field work, QA/punch lists, milestones, and customer sign-off
- Dedicated project catalog API powering per-type board columns, status labels, templates, dashboard copy, report cards, and crew-fit guidance
- Project detail workspace now returns workflow profile metadata, lightweight reports, permissions guidance, and board/dashboard summaries in one call
- Project list board views now surface type-specific dashboards instead of acting like plain filtered lists
- Create-project and create-card flows now use explicit selects/templates and auto-refresh the workspace after saves instead of demanding a manual refresh

## Phase 7 Deliverables

## Phase 7 Deliverables

- Full Projects module with views for All Projects, Service Board, Installation Board, Internal Projects, My Tasks, Calendar View, and Project Detail
- Project types now include `service`, `installation`, and `internal`
- Board columns seeded per project type for service/install/internal workflows
- Board cards backed by expanded project jobs with assignment, due dates, priority, labels, customer/site tags, related ticket/asset links, checklists, comments, attachments, labor, materials, and activity history
- Tenant/member lookup endpoint to support board assignment in the UI
- New project workspace API returning board columns plus card detail in one request

## Phase 5 Deliverables

- Ticket schema for customer-facing and technician-facing workflows
- Ticket list/detail APIs with tenant-aware access control
- Threaded comments with customer-visible vs internal technician notes
- Status-driven ticket lifecycle: `new`, `open`, `pending_customer`, `pending_vendor`, `resolved`, `closed`
- Conceptual conversion records for service jobs, installation projects, and internal project tasks
- Frontend shell views for ticket portal intake, queue, detail, replies, and conversions

## Phase 4 Deliverables

- Agent heartbeat endpoint for recurring check-ins
- Host telemetry snapshots covering CPU, RAM, disk, uptime, OS, network identity, and patch status
- Service inventory storage for monitored services
- Installed software inventory storage
- Monitoring views and alert APIs
- Offline detection sweep inside the backend
- Docker-friendly sample agent that can collect and post host data automatically

## Services

- `frontend/` - lightweight SSR shell with `/customers`, `/assets`, `/monitoring`, `/monitoring/:assetId`, `/alerts`, `/projects`, and `/tickets`
- `backend/` - Express API with auth, tenant, project, customer, asset, monitoring, and agent enrollment routes
- `agent/` - lightweight host agent with enrollment bootstrap, local snapshot endpoint, and recurring heartbeat loop
- `database/` - PostgreSQL bootstrap SQL for platform, auth/RBAC, projects, customers, assets, monitoring, and ticketing

## Database Additions in Phase 4

New / expanded schema:

- `asset_health_snapshots` now stores uptime, load, OS, public IP, patch status, metrics JSON, and network JSON
- `asset_services` - latest observed service state per asset/service
- `asset_software_inventory` - latest observed installed software inventory per asset/package
- `monitoring_alerts` - open/resolved monitoring alerts keyed by rule + asset
- `monitoring_asset_status_v` - joined monitoring view for latest metrics, services, software, and alert counts

For existing deployments, a copy of the Phase 4 SQL is also provided at:

- `database/migrations/004-phase4-monitoring-agent.sql`

That file should be applied manually to an already-initialized database, because this repo still uses first-boot SQL rather than a true migration runner.

## Database Additions in Phase 5

- `tickets` - tenant/customer scoped ticket records with requester, assignee, site, and asset linkage
- `ticket_comments` - threaded updates with customer-visibility control
- `ticket_conversions` - conceptual downstream conversion records for service jobs, installation projects, and internal project tasks
- `ticket_portal_v` - joined ticket view for customer, asset, site, assignee, and counts

For existing deployments, apply:

- `database/migrations/005-phase5-ticketing.sql`
- `database/migrations/006-phase6-project-boards.sql`
- `database/migrations/007-phase9-agent-enrollment.sql`

## API Surface

### Public

- `GET /api/health`
- `GET /api/v1/platform/meta`
- `GET /api/v1/auth/bootstrap/status`
- `POST /api/v1/auth/bootstrap`
- `POST /api/v1/auth/login`
- `POST /api/v1/assets/register-agent`
- `POST /api/v1/assets/enroll-agent`
- `POST /api/v1/assets/health`
- `POST /api/v1/monitoring/heartbeat`

### Protected

- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `GET /api/v1/tenants`
- `POST /api/v1/tenants`
- `POST /api/v1/tenants/customer`
- `GET /api/v1/tenants/:tenantId/members`
- `POST /api/v1/tenants/:tenantId/members`
- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/:projectId`
- `GET /api/v1/projects/:projectId/workspace`
- `PATCH /api/v1/projects/:projectId`
- `GET /api/v1/projects/:projectId/jobs`
- `POST /api/v1/projects/:projectId/jobs`
- `PATCH /api/v1/projects/:projectId/jobs/:jobId`
- `GET /api/v1/customers/dashboard`
- `GET /api/v1/customers`
- `GET /api/v1/customers/:customerTenantId`
- `GET /api/v1/customers/:customerTenantId/sites`
- `POST /api/v1/customers/:customerTenantId/sites`
- `GET /api/v1/assets`
- `POST /api/v1/assets`
- `GET /api/v1/assets/:assetId`
- `PATCH /api/v1/assets/:assetId`
- `GET /api/v1/assets/:assetId/agent`
- `POST /api/v1/assets/:assetId/agent-enrollments`
- `POST /api/v1/assets/:assetId/agent-package`
- `POST /api/v1/assets/:assetId/relationships`
- `GET /api/v1/monitoring/assets`
- `GET /api/v1/monitoring/assets/:assetId`
- `GET /api/v1/monitoring/alerts`
- `GET /api/v1/tickets`
- `POST /api/v1/tickets`
- `GET /api/v1/tickets/:ticketId`
- `PATCH /api/v1/tickets/:ticketId`
- `POST /api/v1/tickets/:ticketId/comments`
- `POST /api/v1/tickets/:ticketId/conversions`

## Heartbeat Example

```bash
curl -X POST http://localhost:4000/api/v1/monitoring/heartbeat \
  -H 'content-type: application/json' \
  -d '{
    "agentKey": "asset-agent-key",
    "agentVersion": "0.4.0",
    "hostname": "srv-01",
    "os": {
      "name": "Linux",
      "version": "Debian 12",
      "release": "6.8.12"
    },
    "network": {
      "primaryIp": "10.0.10.12",
      "publicIp": "203.0.113.10",
      "interfaces": [{"name":"eth0","address":"10.0.10.12","mac":"aa:bb:cc:dd:ee:ff"}]
    },
    "patchStatus": "up-to-date",
    "metrics": {
      "cpuPercent": 17.4,
      "memoryPercent": 58.2,
      "diskPercent": 63.1,
      "uptimeSeconds": 482211,
      "loadOne": 0.31,
      "loadFive": 0.40,
      "loadFifteen": 0.51,
      "macAddresses": ["aa:bb:cc:dd:ee:ff"]
    },
    "services": [
      {"serviceName": "docker", "status": "running", "startupType": "enabled"},
      {"serviceName": "ssh", "status": "running", "startupType": "enabled"}
    ],
    "installedSoftware": [
      {"packageName": "docker-ce", "packageVersion": "26.1.3", "installSource": "dpkg"}
    ]
  }'
```

## Agent Service Environment

- `AGENT_KEY` - direct heartbeat credential if you want to bypass enrollment during development
- `AGENT_ENROLLMENT_TOKEN` - one-time token used for first enrollment
- `AGENT_ENROLLMENT_CONFIG_PATH` - path to generated JSON config package content
- `AGENT_PLATFORM` - optional override (`windows`, `linux`, `macos`)
- `AGENT_ENROLL_PATH` - enrollment endpoint path override (defaults to `/v1/assets/enroll-agent`)
- `AGENT_HEARTBEAT_PATH` - heartbeat endpoint path override (defaults to `/v1/monitoring/heartbeat`)
- `AGENT_HEARTBEAT_INTERVAL_MS` - loop interval
- `AGENT_MONITORED_SERVICES` - comma-separated systemd service names, e.g. `docker,ssh`
- `AGENT_SOFTWARE_LIMIT` - cap software inventory payload size
- `AGENT_ENABLE_HEARTBEAT` - set to `false` to disable posting and use `/snapshot` only

## Frontend Views

- `/` - Phase 4 landing page and API map
- `/customers?accessToken=<bearer>` - customer dashboard SSR view
- `/assets?accessToken=<bearer>` - asset inventory SSR view
- `/assets/:assetId?accessToken=<bearer>` - asset + relationship detail SSR view
- `/monitoring?accessToken=<bearer>` - monitoring summary SSR view
- `/monitoring/:assetId?accessToken=<bearer>` - monitoring detail SSR view
- `/alerts?accessToken=<bearer>` - alert summary SSR view

## How to Run

### Local / lab quick start

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
2. For a fresh environment:
   ```bash
   docker compose down -v
   docker compose up --build
   ```
3. For an existing database volume, apply the manual SQL before restarting services:
   ```bash
   psql "$DATABASE_URL" -f database/migrations/004-phase4-monitoring-agent.sql
   psql "$DATABASE_URL" -f database/migrations/005-phase5-ticketing.sql
   psql "$DATABASE_URL" -f database/migrations/006-phase6-project-boards.sql
   psql "$DATABASE_URL" -f database/migrations/007-phase9-agent-enrollment.sql
   docker compose up --build
   ```
4. Open the services:
   - Frontend: <http://localhost:3000>
   - Backend root: <http://localhost:4000>
   - Backend health: <http://localhost:4000/api/health>
   - Backend metadata: <http://localhost:4000/api/v1/platform/meta>
   - Agent local health: <http://localhost:4100/health>
   - Agent local snapshot: <http://localhost:4100/snapshot>

### Existing deployment migration step

If you are upgrading an already-initialized stack, apply all manual SQL before restarting:

```bash
psql "$DATABASE_URL" -f database/migrations/004-phase4-monitoring-agent.sql
psql "$DATABASE_URL" -f database/migrations/005-phase5-ticketing.sql
psql "$DATABASE_URL" -f database/migrations/006-phase6-project-boards.sql
psql "$DATABASE_URL" -f database/migrations/007-phase9-agent-enrollment.sql
docker compose up --build -d
```

## Deployment for a public GitHub repo

This repo now includes two deployment entry points:

- `docker-compose.yml` — simple local/lab development stack
- `docker-compose.deploy.yml.example` — sanitized production-style example for public use

The distributed compose example is branded as `aetnix` at the compose-project level so exported/public deployments do not present themselves as an internal repo/worktree name.

Recommended publishable deployment flow:

1. Copy the production example files:
   ```bash
   cp .env.example .env
   cp docker-compose.deploy.yml.example docker-compose.deploy.yml
   ```
2. Edit `.env` and replace all placeholder values:
   - `APP_URL`
   - `CORS_ORIGIN`
   - `JWT_SECRET`
   - `POSTGRES_PASSWORD`
   - `DATABASE_URL`
3. Put a reverse proxy in front of the app and route:
   - `/` -> frontend on port `3000`
   - `/api` -> backend on port `4000`
4. Start the stack:
   ```bash
   docker compose -f docker-compose.deploy.yml up -d --build
   ```
5. On first login, open `/bootstrap` in the UI and create the founding admin account.

For a cleaner walkthrough, see `docs/deployment.md`.

### Suggested reverse-proxy shape

In production, prefer same-origin frontend/backend hosting:

- public app origin: `https://app.example.com`
- frontend container: `http://frontend:3000`
- backend container: `http://backend:4000`
- proxied API path: `https://app.example.com/api`

That is why the default production-friendly frontend setting is:

```env
VITE_API_BASE_URL=/api
```

## First-run setup phase

For a clean first deployment, the intended setup sequence is:

1. Start Postgres, backend, and frontend.
2. Verify `GET /api/v1/auth/bootstrap/status` returns a bootstrapped count of `0`.
3. Visit `/bootstrap` in the frontend.
4. Create:
   - company / MSP name
   - founding tenant key
   - initial platform admin email
   - strong admin password
5. Sign in and continue normal setup from the UI.

This gives the project a usable install phase without shipping anyone's real credentials, hostnames, or seeded private tenant data.

## Recommended `.env` settings to keep user-specific

These are the values each installer should expect to customize locally:

- `APP_URL`
- `CORS_ORIGIN`
- `DATABASE_URL`
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `PLATFORM_NAME`
- `JWT_ISSUER`
- optional monitoring thresholds
- optional `AGENT_*` values if using the lab agent container

## Before putting this on GitHub

Good hygiene checklist:

- keep `.env` and `.env.local` out of git
- do not commit deployment-specific hostnames, public domains, or internal IPs into example files
- keep `VITE_API_BASE_URL=/api` in public examples unless a repo consumer has a reason not to
- avoid shipping active agent keys or enrollment tokens
- avoid shipping customer/tenant seed data
- keep Postgres unexposed by default in production examples unless explicitly needed

Use `docs/github-publishing-checklist.md` as the final pre-publication pass.

## What Became Real in Phase 4

- Heartbeats now create rich monitoring snapshots and keep `asset_agents.last_seen_at` fresh
- The backend now tracks stale agents and opens/resolves monitoring alerts automatically
- Service and software inventory now hang directly off assets instead of living in notes or wishful thinking
- Monitoring is still intentionally simple: threshold-based alerts, latest-state inventory, and no command-and-control yet

## What Still Comes Later

1. Real migration tooling instead of bootstrap/manual SQL
2. Alert acknowledgements, maintenance windows, and notification delivery
3. Agent trust hardening (certs, rotation, signed enrollment)
4. Remote actions, remediation jobs, and ticket/project integration beyond conceptual links

## Notes

This is still not the whole product. But the monitoring loop is now real enough to deploy in a lab, attach to an asset, and start getting heartbeat-driven visibility without jumping ahead into ticketing or RMM command execution.


## What Became Real in Phase 5

- Customers can now open tickets directly in the portal against their tenant and optionally tie them to an asset
- Technicians can work a proper queue, add replies, update lifecycle state, and record conceptual downstream conversions
- Ticket history is now visible in-thread instead of living in email or good intentions
- Conversion is intentionally scoped: you can record the handoff target and status now, while full job/project creation stays for later phases
