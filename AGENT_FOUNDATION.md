# Aetnix Monitoring Agent Foundation

## Goal
Create deployable Windows and Linux reporting agents that bind to an Aetnix asset/customer/site/tenant from the Assets page, report useful system state, and later support controlled package/script actions.

## Product shape
- Generate an installer/package from an Asset detail page.
- The generated package embeds or bootstraps:
  - tenant/customer/site/asset identity
  - agent enrollment key or one-time registration token
  - API base URL
  - environment/role metadata
- Installed agent registers itself to the target asset and begins heartbeat + inventory reporting.

## Core capabilities
### Initial reporting
- Host identity
  - hostname
  - fqdn
  - OS name/version/build
  - architecture
  - uptime
  - serial/model/vendor where available
  - domain/workgroup
  - local timezone
- Network
  - primary IPs
  - MAC addresses
  - default gateway
  - DNS servers
  - active interfaces
  - public IP if allowed
- Hardware
  - CPU model / cores / load
  - RAM total / used
  - disk volumes with size/free
- Software / service state
  - installed software inventory
  - selected service status
  - patch/update summary where practical

### Windows-specific
- WMI / CIM collection for:
  - Win32_OperatingSystem
  - Win32_ComputerSystem
  - Win32_BIOS
  - Win32_Processor
  - Win32_LogicalDisk
  - Win32_NetworkAdapterConfiguration
  - Win32_Service
  - Win32_QuickFixEngineering
- PowerShell execution channel
- Chocolatey package actions:
  - install
  - upgrade
  - uninstall
  - inventory of installed choco packages

### Linux-specific
- `/etc/os-release`, `uname`, uptime, df, ip addr/route, systemctl, package manager queries
- Bash execution channel
- Package actions later via apt/dnf/yum/zypper abstraction

## Security model
- Agents should not ship with long-lived broad secrets in plaintext installers.
- Prefer one-time enrollment tokens minted per asset.
- On first successful registration, exchange for agent key / refreshable credentials.
- Action execution should be opt-in and auditable.
- Every remote command/package action should create:
  - who initiated it
  - tenant/customer/site/asset target
  - command/package payload
  - started/finished timestamps
  - result / exit code / excerpted logs

## Recommended architecture
### Agent runtime
- Node-based agent is the fastest path because the current sample agent already exists.
- For Windows service quality, consider packaging Node runtime with the installer in phase 1.
- Keep collector/action adapters modular:
  - `collectors/base/*`
  - `collectors/windows/*`
  - `collectors/linux/*`
  - `actions/windows/*`
  - `actions/linux/*`

### Enrollment flow
1. User opens Asset page.
2. Clicks `Generate agent`.
3. Backend mints one-time enrollment token bound to:
   - asset_id
   - tenant_id
   - customer/site context
   - expiration
4. Backend returns downloadable package config.
5. Agent installs, calls enrollment endpoint, stores issued agent credential, starts reporting.

### Packaging targets
- Windows:
  - MSI later
  - first pass: signed/unsigned ZIP or self-extracting package with install PowerShell
- Linux:
  - tarball + install shell script first
  - later native deb/rpm packages

## Data model additions
### Suggested tables
#### `asset_agent_enrollments`
- id
- asset_id
- tenant_id
- site_id nullable
- enrollment_token_hash
- expires_at
- used_at
- created_by_user_id
- created_at

#### `asset_agent_capabilities`
- asset_id
- platform
- supports_wmi
- supports_powershell
- supports_bash
- supports_chocolatey
- supports_package_manager
- supports_service_control
- last_reported_at

#### `agent_action_runs`
- id
- asset_id
- tenant_id
- action_type (`script`, `package_install`, `package_upgrade`, `package_uninstall`)
- platform
- payload jsonb
- status
- requested_by_user_id
- requested_at
- started_at
- finished_at
- exit_code
- output_excerpt

## API additions
### Enrollment / generation
- `POST /api/v1/assets/:assetId/agent-package`
  - returns package metadata or download artifact
- `POST /api/v1/assets/:assetId/agent-enrollments`
  - mint one-time enrollment token
- `POST /api/v1/agents/enroll`
  - agent exchanges token for credential

### Reporting
- extend current heartbeat payloads with richer platform-specific identity/capability fields
- keep payload compact enough to avoid giant auth/header problems

### Actions
- `POST /api/v1/assets/:assetId/agent-actions/script`
- `POST /api/v1/assets/:assetId/agent-actions/package`
- `GET /api/v1/assets/:assetId/agent-actions`

## UI additions
### Asset detail page
Add an `Agent` card with:
- enrollment status
- last heartbeat
- platform/capabilities
- generate package button
- rotate enrollment token button
- recent agent actions

### Admin / monitoring views later
- fleet rollout status
- stale/offline agents
- pending/failed actions

## Best next implementation steps
1. Add schema for enrollment tokens and action runs.
2. Add backend enrollment endpoints.
3. Extend current sample agent to support enrollment token exchange.
4. Add Asset detail UI for `Generate agent`.
5. Generate a config artifact first (ZIP/tarball) before full MSI/deb/rpm work.
6. Add Windows collectors using PowerShell/WMI adapters.
7. Add audited remote script execution.
8. Add Chocolatey package action support.

## Practical recommendation
Ship phase 1 as:
- Node agent
- one-time enrollment token
- asset-bound generated config package
- reporting for Windows + Linux
- no arbitrary remote execution until enrollment/audit/action records are in place

Then add:
- PowerShell/bash actions
- Chocolatey/package management
- richer fleet controls
