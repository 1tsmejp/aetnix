export const roles = [
  'platform_admin',
  'msp_admin',
  'project_manager',
  'technician',
  'installer',
  'customer_admin',
  'customer_user',
];

const permissionMap = {
  platform_admin: ['*'],
  msp_admin: ['tenant.manage', 'project.manage', 'job.manage.service', 'job.manage.installation', 'customer.read.approved', 'ticket.manage'],
  project_manager: ['project.manage', 'customer.read.approved', 'ticket.manage'],
  technician: ['job.manage.service', 'ticket.manage'],
  installer: ['job.manage.installation', 'ticket.manage'],
  customer_admin: ['customer.read.approved', 'ticket.read', 'ticket.create'],
  customer_user: ['customer.read.approved', 'ticket.read', 'ticket.create'],
};

export function isKnownRole(role) {
  return roles.includes(role);
}

export function roleHasPermission(role, permission) {
  const permissions = permissionMap[role] ?? [];
  return permissions.includes('*') || permissions.includes(permission);
}

export function roleSummary(role) {
  return {
    role,
    permissions: permissionMap[role] ?? [],
  };
}
