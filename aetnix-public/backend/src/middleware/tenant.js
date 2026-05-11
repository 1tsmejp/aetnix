import { forbidden } from '../lib/errors.js';

export function requireTenantAccess(allowedRoles = []) {
  return (req, _res, next) => {
    const activeTenant = req.auth?.activeTenant;

    if (!activeTenant && req.auth?.user?.platformRole !== 'platform_admin') {
      next(forbidden('No active tenant membership found'));
      return;
    }

    if (allowedRoles.length > 0 && activeTenant && !allowedRoles.includes(activeTenant.role) && req.auth.user.platformRole !== 'platform_admin') {
      next(forbidden(`Role ${activeTenant.role} is not allowed here`));
      return;
    }

    next();
  };
}
