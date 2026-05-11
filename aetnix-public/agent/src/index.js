import express from 'express';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const app = express();
const port = Number(process.env.PORT ?? 4100);
const apiBaseUrl = process.env.AGENT_API_BASE_URL ?? 'http://backend:4000/api';
const heartbeatInterval = Number(process.env.AGENT_HEARTBEAT_INTERVAL_MS ?? 30000);
const configuredAgentKey = process.env.AGENT_KEY ?? '';
const agentVersion = process.env.AGENT_VERSION ?? '0.5.0';
const enrollmentToken = process.env.AGENT_ENROLLMENT_TOKEN ?? '';
const enrollmentConfigPath = process.env.AGENT_ENROLLMENT_CONFIG_PATH ?? path.resolve(process.cwd(), 'aetnix-agent-config.json');
const platformOverride = process.env.AGENT_PLATFORM ?? '';
const heartbeatPath = process.env.AGENT_HEARTBEAT_PATH ?? '/v1/monitoring/heartbeat';
const enrollPath = process.env.AGENT_ENROLL_PATH ?? '/v1/assets/enroll-agent';
const monitoredServices = String(process.env.AGENT_MONITORED_SERVICES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const softwareLimit = Number(process.env.AGENT_SOFTWARE_LIMIT ?? 100);
const enableHeartbeat = process.env.AGENT_ENABLE_HEARTBEAT !== 'false';

let lastCpuSample = snapshotCpuTimes();
let lastHeartbeat = null;
let lastError = null;
let runtimeApiBaseUrl = apiBaseUrl;
let runtimeCredential = { agentKey: configuredAgentKey || '', enrollment: null };

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'agent-test',
    targetApi: runtimeApiBaseUrl,
    heartbeatInterval,
    agentKeyConfigured: Boolean(runtimeCredential.agentKey),
    lastHeartbeat,
    lastError,
    timestamp: new Date().toISOString(),
  });
});

app.get('/snapshot', async (_req, res) => {
  try {
    const snapshot = await collectSnapshot();
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, async () => {
  console.log(`Agent test service listening on port ${port}`);
  console.log(`Configured backend target: ${apiBaseUrl}`);
  console.log(`Heartbeat interval: ${heartbeatInterval}ms`);
  await bootstrapAgentCredential();
  if (enableHeartbeat && runtimeCredential.agentKey) {
    scheduleHeartbeat();
  } else {
    console.log('Heartbeat loop disabled or agent credential missing');
  }
});

function scheduleHeartbeat() {
  sendHeartbeat().catch((error) => {
    lastError = error.message;
    console.error('Initial heartbeat failed', error.message);
  });

  const timer = setInterval(() => {
    sendHeartbeat().catch((error) => {
      lastError = error.message;
      console.error('Heartbeat failed', error.message);
    });
  }, heartbeatInterval);

  timer.unref?.();
}

async function sendHeartbeat() {
  const snapshot = await collectSnapshot();
  const response = await fetch(`${runtimeApiBaseUrl}${heartbeatPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentKey: runtimeCredential.agentKey,
      agentVersion,
      observedAt: new Date().toISOString(),
      ...snapshot,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `Heartbeat failed with status ${response.status}`);
  }

  lastHeartbeat = {
    at: new Date().toISOString(),
    status: payload.status,
    assetId: payload.asset?.id ?? payload.asset?.assetId ?? null,
  };
  lastError = null;
  return payload;
}

async function collectSnapshot() {
  const [disk, patchStatus, publicIp, software, services, networkDetails, identity] = await Promise.all([
    getDiskUsage(),
    getPatchStatus(),
    getPublicIp(),
    getInstalledSoftware(),
    getServices(),
    getNetworkDetails(),
    collectIdentity(),
  ]);

  const cpuPercent = readCpuPercent();
  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = os.freemem();
  const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;
  const memoryPercent = totalMemoryBytes > 0 ? round((usedMemoryBytes / totalMemoryBytes) * 100) : null;
  const primaryIp = identity.primaryIp || networkDetails.primaryIp || findPrimaryIp();
  const macAddresses = [...new Set([...(networkDetails.macAddresses ?? []), ...findMacAddresses()])];
  const load = os.loadavg();
  const capabilities = collectCapabilities(identity.platform);

  return {
    hostname: os.hostname(),
    platform: identity.platform,
    identity,
    capabilities,
    os: {
      name: `${os.type()} ${os.platform()}`,
      version: os.version?.() ?? null,
      release: os.release(),
      kernelVersion: os.release(),
      architecture: os.arch(),
      platform: identity.platform,
    },
    network: {
      primaryIp,
      publicIp,
      interfaces: networkDetails.interfaces,
      defaultGateway: networkDetails.defaultGateway,
      dnsServers: networkDetails.dnsServers,
      routes: networkDetails.routes,
    },
    patchStatus,
    metrics: {
      cpuPercent,
      cpuCores: os.cpus().length,
      memoryPercent,
      totalMemoryBytes,
      freeMemoryBytes,
      diskPercent: disk.usedPercent,
      totalDiskBytes: disk.totalBytes,
      freeDiskBytes: disk.freeBytes,
      diskMount: disk.mount,
      uptimeSeconds: Math.floor(os.uptime()),
      loadOne: round(load[0]),
      loadFive: round(load[1]),
      loadFifteen: round(load[2]),
      macAddresses,
    },
    services,
    installedSoftware: software,
    summary: buildSummary({ cpuPercent, memoryPercent, diskPercent: disk.usedPercent, patchStatus, services }),
  };
}

function snapshotCpuTimes() {
  const cpus = os.cpus();
  return cpus.reduce((acc, cpu) => {
    acc.idle += cpu.times.idle;
    acc.total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return acc;
  }, { idle: 0, total: 0 });
}

function readCpuPercent() {
  const current = snapshotCpuTimes();
  const idleDiff = current.idle - lastCpuSample.idle;
  const totalDiff = current.total - lastCpuSample.total;
  lastCpuSample = current;
  if (totalDiff <= 0) return 0;
  return round((1 - (idleDiff / totalDiff)) * 100);
}

async function getDiskUsage() {
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', '/']);
    const lines = stdout.trim().split('\n');
    const parts = lines[lines.length - 1].split(/\s+/);
    const totalKb = Number(parts[1] ?? 0);
    const usedKb = Number(parts[2] ?? 0);
    const freeKb = Number(parts[3] ?? 0);
    return {
      mount: parts[5] ?? '/',
      totalBytes: totalKb * 1024,
      freeBytes: freeKb * 1024,
      usedPercent: totalKb > 0 ? round((usedKb / totalKb) * 100) : null,
    };
  } catch {
    return { mount: '/', totalBytes: null, freeBytes: null, usedPercent: null };
  }
}

async function getPatchStatus() {
  try {
    if (detectPlatform() === 'windows') {
      const payload = await runPowerShellJson(`
        $hotfixes = @(Get-CimInstance Win32_QuickFixEngineering -ErrorAction SilentlyContinue)
        $latest = $hotfixes | Sort-Object InstalledOn -Descending | Select-Object -First 1
        [pscustomobject]@{
          hotfixCount = $hotfixes.Count
          latestHotfix = if ($latest) { $latest.HotFixID } else { $null }
          latestInstalledOn = if ($latest) { $latest.InstalledOn } else { $null }
        } | ConvertTo-Json -Depth 4
      `);
      return payload?.hotfixCount > 0 ? 'up-to-date' : 'unknown';
    }

    if (await exists('/usr/bin/apt')) {
      const { stdout } = await execFileAsync('bash', ['-lc', "apt list --upgradable 2>/dev/null | tail -n +2 | wc -l"]);
      const count = Number.parseInt(stdout.trim(), 10) || 0;
      return count > 0 ? 'outdated' : 'up-to-date';
    }

    if (await exists('/sbin/apk') || await exists('/usr/sbin/apk')) {
      const { stdout } = await execFileAsync('sh', ['-lc', 'apk version 2>/dev/null | grep -c "<" || true']);
      const count = Number.parseInt(stdout.trim(), 10) || 0;
      return count > 0 ? 'outdated' : 'up-to-date';
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

async function getInstalledSoftware() {
  try {
    if (detectPlatform() === 'windows') {
      const installed = await runPowerShellJson(`
        $roots = @(
          'HKLM:\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
          'HKLM:\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
          'HKCU:\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
        )
        $items = foreach ($root in $roots) {
          Get-ItemProperty $root -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName } |
            Select-Object @{n='packageName';e={$_.DisplayName}}, @{n='packageVersion';e={$_.DisplayVersion}}, @{n='vendor';e={$_.Publisher}}, @{n='installSource';e={'registry'}}, @{n='installedAt';e={$_.InstallDate}}, @{n='metadata';e=@{ uninstallString = $_.UninstallString }}
        }
        $items | Sort-Object packageName -Unique | Select-Object -First ${softwareLimit} | ConvertTo-Json -Depth 6
      `, []);
      const chocolatey = await runPowerShellJson(`
        if (Get-Command choco -ErrorAction SilentlyContinue) {
          choco list --local-only --limit-output 2>$null |
            Where-Object { $_ } |
            ForEach-Object {
              $parts = $_ -split '\\|', 2
              [pscustomobject]@{ packageName = $parts[0]; packageVersion = $parts[1]; vendor = 'Chocolatey'; installSource = 'chocolatey'; metadata = @{} }
            } | Select-Object -First ${softwareLimit} | ConvertTo-Json -Depth 4
        }
      `, []);
      return mergeSoftwareInventory(installed, chocolatey, softwareLimit);
    }

    if (await exists('/usr/bin/dpkg-query')) {
      const { stdout } = await execFileAsync('bash', ['-lc', `dpkg-query -W -f='${'${Package}'}\t${'${Version}'}\n' | head -n ${softwareLimit}`]);
      return stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [packageName, packageVersion] = line.split('\t');
        return { packageName, packageVersion, installSource: 'dpkg', metadata: {} };
      });
    }

    if (await exists('/usr/bin/rpm')) {
      const { stdout } = await execFileAsync('bash', ['-lc', `rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\n' | head -n ${softwareLimit}`]);
      return stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [packageName, packageVersion, vendor] = line.split('\t');
        return { packageName, packageVersion, vendor: vendor || null, installSource: 'rpm', metadata: {} };
      });
    }

    if (await exists('/sbin/apk') || await exists('/usr/sbin/apk')) {
      const { stdout } = await execFileAsync('sh', ['-lc', `apk info -vv 2>/dev/null | head -n ${softwareLimit}`]);
      return stdout.trim().split('\n').filter(Boolean).map((line) => ({ packageName: line, packageVersion: null, installSource: 'apk', metadata: {} }));
    }
  } catch {
    return [];
  }

  return [];
}

async function getServices() {
  if (detectPlatform() === 'windows') {
    const monitored = monitoredServices.length > 0 ? monitoredServices : ['WinRM', 'wuauserv', 'LanmanServer'];
    const rows = await runPowerShellJson(`
      param([string[]]$Names)
      Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
        Where-Object { $Names.Count -eq 0 -or $Names -contains $_.Name } |
        Select-Object @{n='serviceName';e={$_.Name}}, @{n='displayName';e={$_.DisplayName}}, @{n='status';e={$_.State}}, @{n='startupType';e={$_.StartMode}}, @{n='metadata';e=@{ startName = $_.StartName; processId = $_.ProcessId }} |
        Select-Object -First 40 | ConvertTo-Json -Depth 6
    `, monitored);
    return Array.isArray(rows) ? rows : rows ? [rows] : [];
  }

  if (monitoredServices.length === 0 && (await exists('/bin/systemctl') || await exists('/usr/bin/systemctl'))) {
    try {
      const { stdout } = await execFileAsync('bash', ['-lc', "systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | head -n 20 | awk '{print $1}'"]);
      const discovered = stdout.trim().split('\n').filter(Boolean).slice(0, 20);
      return Promise.all(discovered.map((serviceName) => inspectService(serviceName)));
    } catch {
      return [];
    }
  }

  if (monitoredServices.length === 0) return [];

  const serviceRows = [];
  for (const serviceName of monitoredServices) {
    serviceRows.push(await inspectService(serviceName));
  }
  return serviceRows;
}

async function inspectService(serviceName) {
  try {
    if (await exists('/bin/systemctl') || await exists('/usr/bin/systemctl')) {
      const { stdout: isActive } = await execFileAsync('systemctl', ['is-active', serviceName]);
      const { stdout: enabled } = await execFileAsync('systemctl', ['is-enabled', serviceName]).catch(() => ({ stdout: 'unknown' }));
      return {
        serviceName,
        displayName: serviceName,
        status: isActive.trim().toLowerCase(),
        startupType: enabled.trim().toLowerCase(),
        metadata: { manager: 'systemd' },
      };
    }
  } catch {
    return {
      serviceName,
      displayName: serviceName,
      status: 'unknown',
      startupType: null,
      metadata: { manager: 'unknown' },
    };
  }

  return {
    serviceName,
    displayName: serviceName,
    status: 'unknown',
    startupType: null,
    metadata: { manager: 'unsupported' },
  };
}

function summarizeInterfaces() {
  const interfaces = os.networkInterfaces();
  return Object.entries(interfaces).flatMap(([name, rows]) =>
    (rows ?? [])
      .filter((row) => !row.internal)
      .map((row) => ({ name, family: row.family, address: row.address, mac: row.mac, cidr: row.cidr }))
  );
}

function findPrimaryIp() {
  return summarizeInterfaces().find((row) => row.family === 'IPv4')?.address ?? null;
}

function findMacAddresses() {
  return [...new Set(summarizeInterfaces().map((row) => row.mac).filter(Boolean))];
}

async function getPublicIp() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.ip ?? null;
  } catch {
    return null;
  }
}

function buildSummary({ cpuPercent, memoryPercent, diskPercent, patchStatus, services }) {
  const failingServices = services.filter((service) => !['running', 'active', 'ok'].includes(service.status));
  const parts = [];
  if (cpuPercent != null) parts.push(`cpu ${cpuPercent}%`);
  if (memoryPercent != null) parts.push(`ram ${memoryPercent}%`);
  if (diskPercent != null) parts.push(`disk ${diskPercent}%`);
  if (patchStatus) parts.push(`patch ${patchStatus}`);
  if (failingServices.length > 0) parts.push(`${failingServices.length} service issue(s)`);
  return parts.join(' · ');
}

async function bootstrapAgentCredential() {
  if (runtimeCredential.agentKey) return runtimeCredential;

  const enrollment = await readEnrollmentConfig();
  if (!enrollment?.enrollmentToken && !enrollmentToken) {
    return runtimeCredential;
  }

  const token = enrollmentToken || enrollment?.enrollmentToken;
  const targetApiBaseUrl = enrollment?.apiBaseUrl || apiBaseUrl;
  runtimeApiBaseUrl = targetApiBaseUrl;
  try {
    const response = await fetch(`${targetApiBaseUrl}${enrollPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enrollmentToken: token,
        agentVersion,
        platform: detectPlatform(),
        identity: await collectIdentity(),
        capabilities: collectCapabilities(detectPlatform()),
        observedAt: new Date().toISOString(),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `Enrollment failed with status ${response.status}`);
    runtimeApiBaseUrl = payload.credential?.apiBaseUrl || targetApiBaseUrl;
    runtimeCredential = { agentKey: payload.credential?.agentKey ?? '', enrollment: payload };
    lastError = null;
    return runtimeCredential;
  } catch (error) {
    lastError = error.message;
    console.error('Agent enrollment failed', error.message);
    return runtimeCredential;
  }
}

async function readEnrollmentConfig() {
  try {
    const content = await fs.readFile(enrollmentConfigPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function collectIdentity() {
  const platform = detectPlatform();
  const networkDetails = await getNetworkDetails();
  const interfaces = networkDetails.interfaces;
  const identity = {
    platform,
    hostname: os.hostname(),
    fqdn: process.env.COMPUTER_FQDN ?? null,
    primaryIp: networkDetails.primaryIp || findPrimaryIp(),
    serialNumber: null,
    machineGuid: null,
    architecture: os.arch(),
    osName: `${os.type()} ${os.platform()}`,
    osVersion: os.version?.() ?? null,
    osBuild: os.release(),
    vendor: null,
    model: null,
    domainOrWorkgroup: process.env.USERDOMAIN ?? process.env.DOMAIN ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    serialSource: null,
    cpuModel: os.cpus()?.[0]?.model ?? null,
    dnsServers: networkDetails.dnsServers,
    defaultGateway: networkDetails.defaultGateway,
    interfaces,
  };

  if (platform === 'windows') {
    const windowsIdentity = await runPowerShellJson(`
      $osInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
      $system = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
      $bios = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
      $computer = Get-ItemProperty 'HKLM:\Software\\Microsoft\\Cryptography' -ErrorAction SilentlyContinue
      [pscustomobject]@{
        fqdn = if ($env:USERDNSDOMAIN) { "$env:COMPUTERNAME.$env:USERDNSDOMAIN" } else { $env:COMPUTERNAME }
        serialNumber = $bios.SerialNumber
        machineGuid = $computer.MachineGuid
        vendor = $system.Manufacturer
        model = $system.Model
        domainOrWorkgroup = $system.Domain
        osName = $osInfo.Caption
        osVersion = $osInfo.Version
        osBuild = $osInfo.BuildNumber
        architecture = $osInfo.OSArchitecture
      } | ConvertTo-Json -Depth 5
    `);
    Object.assign(identity, compactObject(windowsIdentity), { serialSource: windowsIdentity?.serialNumber ? 'Win32_BIOS' : null });
    return identity;
  }

  if (platform === 'linux') {
    try {
      const osRelease = await fs.readFile('/etc/os-release', 'utf8');
      identity.osName = extractOsReleaseValue(osRelease, 'PRETTY_NAME') ?? identity.osName;
      identity.osVersion = extractOsReleaseValue(osRelease, 'VERSION_ID') ?? identity.osVersion;
      identity.vendor = extractOsReleaseValue(osRelease, 'ID') ?? identity.vendor;
    } catch {}

    try {
      identity.fqdn = (await execText('hostname', ['-f'])).trim() || identity.fqdn;
    } catch {}
    try {
      identity.serialNumber = (await fs.readFile('/sys/class/dmi/id/product_serial', 'utf8')).trim() || null;
      identity.serialSource = identity.serialNumber ? '/sys/class/dmi/id/product_serial' : null;
    } catch {}
    try {
      identity.vendor = (await fs.readFile('/sys/class/dmi/id/sys_vendor', 'utf8')).trim() || identity.vendor;
    } catch {}
    try {
      identity.model = (await fs.readFile('/sys/class/dmi/id/product_name', 'utf8')).trim() || identity.model;
    } catch {}
  }

  return identity;
}

function collectCapabilities(platform) {
  const normalized = platform || detectPlatform();
  return {
    platform: normalized,
    supportsWmi: normalized === 'windows',
    supportsCim: normalized === 'windows',
    supportsPowerShell: normalized === 'windows',
    supportsChocolatey: normalized === 'windows',
    supportsBash: normalized === 'linux' || normalized === 'macos',
    supportsSystemctl: normalized === 'linux',
    supportsPackageManager: true,
    supportedCollectors: normalized === 'windows'
      ? ['identity/base', 'windows/wmi-foundation', 'windows/cim-os', 'windows/services', 'windows/software', 'windows/network']
      : ['identity/base', 'linux/os-release', 'linux/systemctl', 'linux/software', 'linux/network', 'linux/dmi'],
    supportedActions: normalized === 'windows'
      ? ['powershell', 'chocolatey']
      : ['bash', 'package-manager'],
  };
}

async function getNetworkDetails() {
  const platform = detectPlatform();
  const interfaces = summarizeInterfaces();
  const details = {
    interfaces,
    primaryIp: interfaces.find((row) => row.family === 'IPv4')?.address ?? null,
    macAddresses: [...new Set(interfaces.map((row) => row.mac).filter(Boolean))],
    defaultGateway: null,
    dnsServers: [],
    routes: [],
  };

  if (platform === 'windows') {
    const payload = await runPowerShellJson(`
      $ip = Get-NetIPConfiguration -Detailed -ErrorAction SilentlyContinue
      $routes = Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' -or $_.DestinationPrefix -like '10.*' } |
        Select-Object -First 20 DestinationPrefix, NextHop, InterfaceAlias, RouteMetric
      [pscustomobject]@{
        defaultGateway = ($ip | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1 -ExpandProperty IPv4DefaultGateway | Select-Object -ExpandProperty NextHop)
        dnsServers = @($ip | ForEach-Object { $_.DNSServer.ServerAddresses } | Where-Object { $_ })
        routes = @($routes)
      } | ConvertTo-Json -Depth 6
    `);
    return {
      ...details,
      defaultGateway: payload?.defaultGateway ?? null,
      dnsServers: Array.isArray(payload?.dnsServers) ? payload.dnsServers : [],
      routes: Array.isArray(payload?.routes) ? payload.routes : payload?.routes ? [payload.routes] : [],
    };
  }

  if (platform === 'linux' || platform === 'macos') {
    try {
      const routeStdout = await execText('bash', ['-lc', 'ip route 2>/dev/null || route -n 2>/dev/null || true']);
      const routes = routeStdout.split('\n').filter(Boolean).slice(0, 25).map((line) => ({ raw: line }));
      details.routes = routes;
      const defaultRoute = routes.find((entry) => entry.raw.startsWith('default '))?.raw ?? null;
      details.defaultGateway = defaultRoute?.split(/\s+/)[2] ?? null;
    } catch {}

    try {
      const resolv = await fs.readFile('/etc/resolv.conf', 'utf8');
      details.dnsServers = resolv.split('\n').filter((line) => line.startsWith('nameserver ')).map((line) => line.split(/\s+/)[1]).filter(Boolean).slice(0, 12);
    } catch {}
  }

  return details;
}

async function execText(command, args = []) {
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 8 });
  return stdout ?? '';
}

async function runPowerShellJson(script, parameters = []) {
  if (detectPlatform() !== 'windows') return null;
  const shell = await getPowerShellExecutable();
  if (!shell) return null;

  try {
    const { stdout } = await execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-Command', script, ...parameters], { maxBuffer: 1024 * 1024 * 8 });
    return parseJsonMaybe(stdout);
  } catch {
    return null;
  }
}

async function getPowerShellExecutable() {
  if (await exists('C:\\Program Files\\PowerShell\\7\\pwsh.exe')) return 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  if (await exists('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')) return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  return 'powershell.exe';
}

function parseJsonMaybe(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mergeSoftwareInventory(...groups) {
  const seen = new Map();
  for (const group of groups) {
    const rows = Array.isArray(group) ? group : group ? [group] : [];
    for (const entry of rows) {
      const packageName = String(entry?.packageName ?? '').trim();
      if (!packageName || seen.has(packageName)) continue;
      seen.set(packageName, {
        packageName,
        packageVersion: entry?.packageVersion ?? null,
        vendor: entry?.vendor ?? null,
        installSource: entry?.installSource ?? null,
        installedAt: entry?.installedAt ?? null,
        metadata: entry?.metadata ?? {},
      });
    }
  }
  return [...seen.values()].slice(0, softwareLimit);
}

function compactObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null && entry !== ''));
}

function detectPlatform() {
  if (platformOverride) return String(platformOverride).trim().toLowerCase();
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') return 'linux';
  return 'unknown';
}

function extractOsReleaseValue(content, key) {
  const line = content.split('\n').find((entry) => entry.startsWith(`${key}=`));
  if (!line) return null;
  return line.split('=').slice(1).join('=').replace(/^"|"$/g, '');
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function round(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(Number(value) * 100) / 100;
}
