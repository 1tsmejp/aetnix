export const roleCards = [
  {
    role: 'platform_admin',
    scope: 'platform',
    capabilities: ['bootstrap the platform', 'create MSP tenants', 'see every tenant and session boundary'],
  },
  {
    role: 'msp_admin',
    scope: 'msp tenant',
    capabilities: ['manage customer tenants and sites', 'manage projects', 'manage asset inventory, agents, and health'],
  },
  {
    role: 'project_manager',
    scope: 'msp tenant',
    capabilities: ['create projects', 'update project status', 'coordinate customer-facing delivery', 'maintain customer and asset records'],
  },
  {
    role: 'technician',
    scope: 'msp tenant',
    capabilities: ['manage service jobs only', 'update service-side asset health context'],
  },
  {
    role: 'installer',
    scope: 'msp tenant',
    capabilities: ['manage installation jobs only', 'register deployed assets during installs'],
  },
  {
    role: 'customer_admin',
    scope: 'customer tenant',
    capabilities: ['view approved project status for their customer tenant', 'view customer dashboard, sites, assets, and health state'],
  },
  {
    role: 'customer_user',
    scope: 'customer tenant',
    capabilities: ['view approved project status for their customer tenant', 'view customer dashboard, sites, assets, and health state'],
  },
];
