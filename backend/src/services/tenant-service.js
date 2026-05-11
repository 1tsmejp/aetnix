import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { isKnownRole } from '../lib/rbac.js';
import { query } from './db.js';
import { createTenantUser } from './auth-service.js';

export async function createTenant({ tenantKey, displayName, kind, parentTenantId = null }) {
  const normalizedTenantKey = tenantKey.trim().toLowerCase();
  const normalizedKind = kind?.trim().toLowerCase();

  if (!['msp', 'customer'].includes(normalizedKind)) throw badRequest('Tenant kind must be msp or customer');

  const result = await query(
    `INSERT INTO tenants (id, tenant_key, display_name, kind, parent_tenant_id, status, approved_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'active', NOW())
     RETURNING id, tenant_key, display_name, kind, parent_tenant_id, status, approved_at, created_at`,
    [normalizedTenantKey, displayName.trim(), normalizedKind, parentTenantId]
  );

  return mapTenant(result.rows[0]);
}

export async function listTenantsVisibleTo(actor) {
  if (actor.user.platformRole === 'platform_admin') {
    const result = await query('SELECT * FROM tenants ORDER BY created_at ASC');
    return result.rows.map(mapTenant);
  }

  const tenantIds = actor.memberships.map((membership) => membership.tenantId);
  const result = await query('SELECT * FROM tenants WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC', [tenantIds]);
  return result.rows.map(mapTenant);
}

export async function createCustomerTenantWithAdmin({ mspTenantId, tenantKey, displayName, adminEmail, adminPassword, adminName }) {
  const tenant = await createTenant({ tenantKey, displayName, kind: 'customer', parentTenantId: mspTenantId });
  if (!adminEmail || !adminPassword || !adminName) {
    return { tenant, user: null };
  }
  const user = await createTenantUser({ tenantId: tenant.id, email: adminEmail, password: adminPassword, fullName: adminName, role: 'customer_admin' });
  return { tenant, user };
}

export async function addTenantMember({ tenantId, email, password, fullName, role }) {
  if (!isKnownRole(role)) throw badRequest('Unknown role');
  return createTenantUser({ tenantId, email, password, fullName, role });
}

export async function updateTenantMember({ actor, tenantId, userId, role, status, fullName }) {
  await assertActorCanManageTenant(actor, tenantId);
  if (!role && !status && !fullName) throw badRequest('At least one field must be provided');
  if (role && !isKnownRole(role)) throw badRequest('Unknown role');

  const membershipResult = await query(
    `SELECT tm.id, tm.tenant_id, tm.user_id, tm.role, tm.is_primary, u.email, u.full_name, u.status
     FROM tenant_memberships tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.tenant_id = $1 AND tm.user_id = $2`,
    [tenantId, userId]
  );
  if (membershipResult.rowCount === 0) throw notFound('Tenant membership not found');

  const current = membershipResult.rows[0];
  if (role) {
    await query('UPDATE tenant_memberships SET role = $3 WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId, role]);
  }
  if (status || fullName) {
    await query('UPDATE users SET status = $2, full_name = $3 WHERE id = $1', [userId, status ?? current.status, fullName ?? current.full_name]);
  }

  return {
    id: current.id,
    tenantId,
    userId,
    role: role ?? current.role,
    isPrimary: current.is_primary,
    email: current.email,
    fullName: fullName ?? current.full_name,
    status: status ?? current.status,
  };
}

export async function listTenantMembers(actor, tenantId) {
  await assertActorCanReadTenant(actor, tenantId);
  const result = await query(
    `SELECT tm.id, tm.tenant_id, tm.user_id, tm.role, tm.is_primary, tm.created_at,
            u.email, u.full_name, u.status, u.last_login_at
     FROM tenant_memberships tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.tenant_id = $1
     ORDER BY u.full_name ASC, u.email ASC`,
    [tenantId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    role: row.role,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    lastLoginAt: row.last_login_at,
  }));
}

export async function getTenantById(tenantId) {
  const result = await query('SELECT * FROM tenants WHERE id = $1', [tenantId]);
  if (result.rowCount === 0) throw notFound('Tenant not found');
  return mapTenant(result.rows[0]);
}

async function assertActorCanReadTenant(actor, tenantId) {
  if (actor.user.platformRole === 'platform_admin') return;
  if (!actor.activeTenant) throw forbidden('No active tenant');
  if (actor.activeTenant.tenantId === tenantId) return;
  const tenant = await getTenantById(tenantId);
  if (tenant.parentTenantId === actor.activeTenant.tenantId && ['platform_admin', 'msp_admin', 'project_manager'].includes(actor.activeTenant.role)) return;
  throw forbidden('Tenant is outside the active scope');
}

async function assertActorCanManageTenant(actor, tenantId) {
  if (actor.user.platformRole === 'platform_admin') return;
  if (!actor.activeTenant) throw forbidden('No active tenant');
  if (actor.activeTenant.tenantId === tenantId && ['msp_admin'].includes(actor.activeTenant.role)) return;
  throw forbidden('Tenant is outside the admin scope');
}

function mapTenant(row) {
  return {
    id: row.id,
    tenantKey: row.tenant_key,
    displayName: row.display_name,
    kind: row.kind,
    parentTenantId: row.parent_tenant_id,
    status: row.status,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}
