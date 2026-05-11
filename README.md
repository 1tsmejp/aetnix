AETNIX

AETNIX is a self-hosted MSP/RMM platform focused on asset monitoring, ticketing, project workflows, and agent-based infrastructure management.

⚠️ This project is still in an early development phase. The current release is functional enough for lab deployments and testing, but APIs, schema, and workflows may change significantly between phases.

Overview

AETNIX currently includes:

Multi-tenant MSP foundations
Customer and asset management
Monitoring and heartbeat ingestion
Lightweight host agent
Ticketing workflows
Project boards and job tracking
Agent enrollment and package generation
SSR frontend shell
PostgreSQL-backed API platform

The platform is designed to evolve into a complete self-hosted MSP operating system combining RMM, ticketing, projects, monitoring, and automation.

Repository Structure
frontend/   Lightweight SSR frontend
backend/    Express API platform
agent/      Monitoring + enrollment agent
database/   Bootstrap schema + manual migrations
docs/       Deployment and publishing documentation
Quick Links
Deployment Guide: docs/deployment.md
GitHub Publishing Checklist: docs/github-publishing-checklist.md
Nginx Example: docs/reverse-proxy/nginx.conf.example
Traefik Example: docs/reverse-proxy/traefik.dynamic.yml.example
Current Platform Features
Monitoring & Agent System
Agent heartbeat ingestion
CPU, RAM, disk, uptime, OS, and network telemetry
Installed software inventory
Service monitoring
Alert generation APIs
Offline asset detection
Asset-bound enrollment packages
One-time enrollment tokens
Linux/Windows-ready agent capability model
Ticketing
Customer and technician ticket workflows
Internal vs customer-visible comments
Ticket lifecycle states:
new
open
pending_customer
pending_vendor
resolved
closed
Ticket conversion tracking
Asset-linked tickets
Projects & Workflows

Project types:

service
installation
internal

Includes:

Kanban board workflows
Technician assignment
Due dates and priorities
Checklists and attachments
Labor/material tracking
Calendar views
Project dashboards
Workflow-specific board templates
Services
Service	Description
frontend/	SSR frontend for customers, assets, monitoring, projects, and tickets
backend/	Express API platform
agent/	Host monitoring and enrollment agent
database/	PostgreSQL bootstrap schema and migrations
Frontend Routes
Route	Description
/	Landing page
/customers	Customer dashboard
/assets	Asset inventory
/assets/:assetId	Asset detail
/monitoring	Monitoring summary
/monitoring/:assetId	Monitoring detail
/alerts	Alert summary
/projects	Project boards
/tickets	Ticket queue

Most authenticated SSR routes currently expect ?accessToken=<bearer> during early development.

API Surface
Public Endpoints
GET    /api/health
GET    /api/v1/platform/meta

GET    /api/v1/auth/bootstrap/status
POST   /api/v1/auth/bootstrap
POST   /api/v1/auth/login

POST   /api/v1/assets/register-agent
POST   /api/v1/assets/enroll-agent
POST   /api/v1/assets/health

POST   /api/v1/monitoring/heartbeat
Protected Endpoints
Authentication
GET    /api/v1/auth/me
POST   /api/v1/auth/logout
Tenants
GET    /api/v1/tenants
POST   /api/v1/tenants

GET    /api/v1/tenants/:tenantId/members
POST   /api/v1/tenants/:tenantId/members

POST   /api/v1/tenants/customer
Customers
GET    /api/v1/customers/dashboard
GET    /api/v1/customers

GET    /api/v1/customers/:customerTenantId
GET    /api/v1/customers/:customerTenantId/sites

POST   /api/v1/customers/:customerTenantId/sites
Assets
GET    /api/v1/assets
POST   /api/v1/assets

GET    /api/v1/assets/:assetId
PATCH  /api/v1/assets/:assetId

GET    /api/v1/assets/:assetId/agent

POST   /api/v1/assets/:assetId/agent-enrollments
POST   /api/v1/assets/:assetId/agent-package
POST   /api/v1/assets/:assetId/relationships
Monitoring
GET    /api/v1/monitoring/assets
GET    /api/v1/monitoring/assets/:assetId

GET    /api/v1/monitoring/alerts
POST   /api/v1/monitoring/heartbeat
Projects
GET    /api/v1/projects
POST   /api/v1/projects

GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId

GET    /api/v1/projects/:projectId/workspace

GET    /api/v1/projects/:projectId/jobs
POST   /api/v1/projects/:projectId/jobs

PATCH  /api/v1/projects/:projectId/jobs/:jobId
Tickets
GET    /api/v1/tickets
POST   /api/v1/tickets

GET    /api/v1/tickets/:ticketId
PATCH  /api/v1/tickets/:ticketId

POST   /api/v1/tickets/:ticketId/comments
POST   /api/v1/tickets/:ticketId/conversions
Local Development
Quick Start
1. Copy Environment Template
cp .env.example .env
2. Start the Stack

For a fresh environment:

docker compose down -v
docker compose up --build
3. Open Services
Service	URL
Frontend	http://localhost:3000

Backend	http://localhost:4000

API Health	http://localhost:4000/api/health

Platform Metadata	http://localhost:4000/api/v1/platform/meta

Agent Health	http://localhost:4100/health

Agent Snapshot	http://localhost:4100/snapshot
Existing Deployment Migration

If upgrading an existing deployment, manually apply migrations before restarting services:

psql "$DATABASE_URL" -f database/migrations/004-phase4-monitoring-agent.sql
psql "$DATABASE_URL" -f database/migrations/005-phase5-ticketing.sql
psql "$DATABASE_URL" -f database/migrations/006-phase6-project-boards.sql
psql "$DATABASE_URL" -f database/migrations/007-phase9-agent-enrollment.sql

docker compose up --build -d
Public Deployment
Included Compose Files
File	Purpose
docker-compose.yml	Local/lab stack
docker-compose.deploy.yml.example	Production deployment example
Deployment Flow
1. Prepare Files
cp .env.example .env
cp docker-compose.deploy.yml.example docker-compose.deploy.yml
2. Configure Environment Variables

Required values:

APP_URL=
CORS_ORIGIN=
JWT_SECRET=
POSTGRES_PASSWORD=
DATABASE_URL=
3. Configure Reverse Proxy

Recommended routing:

/      -> frontend:3000
/api   -> backend:4000

Production frontend API configuration:

VITE_API_BASE_URL=/api
4. Start Deployment
docker compose -f docker-compose.deploy.yml up -d --build
5. Bootstrap Platform

Open:

/bootstrap

Create:

MSP/company name
founding tenant key
initial admin email
admin password
Agent Environment Variables
Variable	Purpose
AGENT_KEY	Direct heartbeat credential
AGENT_ENROLLMENT_TOKEN	One-time enrollment token
AGENT_ENROLLMENT_CONFIG_PATH	Generated config path
AGENT_PLATFORM	Override platform
AGENT_ENROLL_PATH	Enrollment endpoint override
AGENT_HEARTBEAT_PATH	Heartbeat endpoint override
AGENT_HEARTBEAT_INTERVAL_MS	Heartbeat loop interval
AGENT_MONITORED_SERVICES	Comma-separated service list
AGENT_SOFTWARE_LIMIT	Software inventory cap
AGENT_ENABLE_HEARTBEAT	Disable posting if false
Heartbeat Example
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
      "publicIp": "203.0.113.10"
    },
    "patchStatus": "up-to-date",
    "metrics": {
      "cpuPercent": 17.4,
      "memoryPercent": 58.2,
      "diskPercent": 63.1,
      "uptimeSeconds": 482211
    }
  }'
Database Migrations
Migration	Purpose
004-phase4-monitoring-agent.sql	Monitoring + telemetry
005-phase5-ticketing.sql	Ticketing system
006-phase6-project-boards.sql	Project boards
007-phase9-agent-enrollment.sql	Agent enrollment
Development Roadmap
Planned Work
Real migration tooling
Alert acknowledgements
Maintenance windows
Notification delivery
Agent trust hardening
Certificate rotation
Signed enrollment
Remote actions/remediation
Deeper ticket/project automation
Current Status

The monitoring stack, ticketing foundation, project system, and enrollment workflow are now functional enough for lab deployments and iterative development.

The platform is not production-complete yet, but it is far beyond a proof of concept and already supports real heartbeat-driven infrastructure visibility and operational workflows.
