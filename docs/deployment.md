# Deployment Guide

This guide is for self-hosting AETNIX in a way that is safe to publish in a public GitHub repository.

## Goals

- keep private installation details out of the repo
- provide a reproducible Docker Compose deployment path
- support clean first-run bootstrap
- keep frontend and backend on the same public origin when possible

## Recommended architecture

Production-friendly layout:

- public URL: `https://app.example.com`
- reverse proxy terminates TLS
- frontend container serves the UI on port `3000`
- backend container serves the API on port `4000`
- reverse proxy routes `/api` to the backend
- Postgres stays private to the Docker network

Why this is preferred:

- avoids frontend/backend origin mismatch
- simplifies CORS
- keeps the public app URL stable
- works well with `VITE_API_BASE_URL=/api`

## Files to start from

- `.env.example`
- `docker-compose.deploy.yml.example`

Copy them:

```bash
cp .env.example .env
cp docker-compose.deploy.yml.example docker-compose.deploy.yml
```

The distributed compose example is branded with:

```yaml
name: aetnix
```

So the public stack presents as `aetnix` instead of an internal repo/worktree name.

## Required `.env` values

At minimum, replace these before exposing the app publicly:

```env
APP_URL=https://app.example.com
CORS_ORIGIN=https://app.example.com
DATABASE_URL=postgresql://msp_user:change-me@postgres:5432/msp_platform
POSTGRES_PASSWORD=change-me
JWT_SECRET=replace-with-a-long-random-secret
JWT_ISSUER=aetnix
PLATFORM_NAME=AETNIX
```

## First deployment

Start the stack:

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

Check bootstrap status:

```bash
curl http://localhost:4000/api/v1/auth/bootstrap/status
```

Expected initial response should show the platform is not yet bootstrapped.

Then:

1. open the frontend in your browser
2. visit `/bootstrap`
3. create the founding admin account
4. sign in and continue setup from the UI

## Upgrading an existing deployment

This repo still uses manual SQL migration files for deployed databases.

Apply all outstanding migrations before or during upgrade:

```bash
psql "$DATABASE_URL" -f database/migrations/004-phase4-monitoring-agent.sql
psql "$DATABASE_URL" -f database/migrations/005-phase5-ticketing.sql
psql "$DATABASE_URL" -f database/migrations/006-phase6-project-boards.sql
psql "$DATABASE_URL" -f database/migrations/007-phase9-agent-enrollment.sql
```

Then restart or rebuild:

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

## Reverse proxy notes

Use one public origin and route:

- `/` -> frontend
- `/api` -> backend

Examples are included in:

- `docs/reverse-proxy/nginx.conf.example`
- `docs/reverse-proxy/traefik.dynamic.yml.example`

## Database exposure

Recommended default: do **not** publish Postgres to the host.

Only expose it if you need external admin access, and prefer binding it to localhost:

```yaml
ports:
  - "127.0.0.1:5432:5432"
```

## Agent container note

The `agent-test` service is for lab/demo use.

In production examples it is intentionally placed behind the `lab` profile and heartbeat is disabled by default.

Run it only when needed:

```bash
docker compose -f docker-compose.deploy.yml --profile lab up -d agent-test
```

## Publish-safety checklist

Before pushing the repo to GitHub, check:

- `.env` is not committed
- `.env.local` is not committed
- no real domains or internal IPs are present in example files
- no real JWT secrets are present
- no real agent keys or enrollment tokens are present
- no customer seed data is present
- README and examples use `app.example.com` or similar placeholders

## Practical recommendation

Treat this repository as:

- **public code**
- **private environment values**
- **private deployment state**

That split is what keeps the project reusable without leaking your installation details.
