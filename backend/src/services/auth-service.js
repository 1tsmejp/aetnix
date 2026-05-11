import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { hashPassword, hashToken, randomToken, verifyPassword } from '../lib/security.js';
import { isKnownRole, roleSummary } from '../lib/rbac.js';
import { query, withTransaction } from './db.js';

export async function getPlatformMeta() {
  const [{ count }] = (await query('SELECT COUNT(*)::int AS count FROM users WHERE role = $1', ['platform_admin'])).rows;
  return { platformAdminCount: count };
}

export async function bootstrapPlatform({ companyName, tenantKey, adminEmail, adminPassword, adminName }) {
  const meta = await getPlatformMeta();
  if (meta.platformAdminCount > 0) {
    throw badRequest('Platform bootstrap has already been completed');
  }

  const normalizedEmail = adminEmail.trim().toLowerCase();
  const normalizedTenantKey = tenantKey.trim().toLowerCase();
  const passwordHash = await hashPassword(adminPassword);

  return withTransaction(async (client) => {
    const tenantResult = await client.query(
      `INSERT INTO tenants (id, tenant_key, display_name, kind, status, approved_at)
       VALUES (gen_random_uuid(), $1, $2, 'msp', 'active', NOW())
       RETURNING id, tenant_key, display_name, kind, status, parent_tenant_id, created_at`,
      [normalizedTenantKey, companyName.trim()]
    );

    const tenant = tenantResult.rows[0];

    const userResult = await client.query(
      `INSERT INTO users (id, tenant_id, email, role, password_hash, full_name, status)
       VALUES (gen_random_uuid(), $1, $2, 'platform_admin', $3, $4, 'active')
       RETURNING id, email, role, full_name, status, created_at`,
      [tenant.id, normalizedEmail, passwordHash, adminName.trim()]
    );

    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role, is_primary)
       VALUES ($1, $2, 'platform_admin', TRUE)`,
      [tenant.id, user.id]
    );

    return buildAuthProfile({ user, memberships: [{ ...tenant, role: 'platform_admin', is_primary: true }] });
  });
}

export async function login({ email, password, tenantKey, meta = {} }) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedTenantKey = tenantKey?.trim().toLowerCase() || null;

  const result = await query(
    `SELECT
      u.id AS user_id,
      u.email,
      u.role AS platform_role,
      u.full_name,
      u.status AS user_status,
      u.password_hash,
      tm.role AS membership_role,
      tm.is_primary,
      t.id AS tenant_id,
      t.tenant_key,
      t.display_name,
      t.kind,
      t.status AS tenant_status,
      t.settings,
      t.parent_tenant_id
    FROM users u
    LEFT JOIN tenant_memberships tm ON tm.user_id = u.id
    LEFT JOIN tenants t ON t.id = tm.tenant_id
    WHERE u.email = $1
      AND ($2::text IS NULL OR t.tenant_key = $2)
    ORDER BY tm.is_primary DESC, t.created_at ASC`,
    [normalizedEmail, normalizedTenantKey]
  );

  if (result.rowCount === 0) {
    throw unauthorized('Invalid email, password, or tenant');
  }

  const first = result.rows[0];
  const passwordMatches = await verifyPassword(password, first.password_hash);
  if (!passwordMatches) {
    throw unauthorized('Invalid email, password, or tenant');
  }

  const memberships = result.rows
    .filter((row) => row.tenant_id)
    .map((row) => ({
      tenantId: row.tenant_id,
      tenantKey: row.tenant_key,
      displayName: row.display_name,
      kind: row.kind,
      status: row.tenant_status,
      parentTenantId: row.parent_tenant_id,
      settings: row.settings ?? {},
      role: row.membership_role,
      isPrimary: row.is_primary,
    }));

  const activeMembership = memberships[0] ?? null;
  const user = {
    id: first.user_id,
    email: first.email,
    role: first.platform_role,
    full_name: first.full_name,
    status: first.user_status,
  };

  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  return createSession({ user, activeMembership, memberships });
}

export async function createSession({ user, activeMembership, memberships, meta = {} }) {
  const sessionToken = randomToken();
  const sessionTokenHash = hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + env.sessionTtlDays * 24 * 60 * 60 * 1000);

  const sessionResult = await query(
    `INSERT INTO auth_sessions (user_id, tenant_id, session_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, expires_at, created_at`,
    [user.id, activeMembership?.tenantId ?? null, sessionTokenHash, meta.userAgent ?? null, meta.ipAddress ?? null, expiresAt.toISOString()]
  );

  const session = sessionResult.rows[0];
  const authProfile = buildAuthProfile({ user, memberships, activeTenantId: activeMembership?.tenantId ?? null });
  const accessToken = jwt.sign(
    {
      sub: user.id,
      sid: session.id,
      tenantId: activeMembership?.tenantId ?? null,
      role: activeMembership?.role ?? user.role,
    },
    env.jwtSecret,
    {
      issuer: env.jwtIssuer,
      expiresIn: env.accessTokenTtl,
    }
  );

  return {
    accessToken,
    sessionToken,
    session: {
      id: session.id,
      expiresAt: session.expires_at,
      createdAt: session.created_at,
    },
    user: authProfile.user,
    activeTenant: authProfile.activeTenant,
    memberships: authProfile.memberships,
  };
}

export async function getSessionContextFromBearerToken(token) {
  let decoded;

  try {
    decoded = jwt.verify(token, env.jwtSecret, { issuer: env.jwtIssuer });
  } catch {
    throw unauthorized('Invalid or expired access token');
  }

  const sessionResult = await query(
    `SELECT s.id, s.expires_at, s.revoked_at, u.id AS user_id, u.email, u.role AS platform_role, u.full_name, u.status
     FROM auth_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [decoded.sid]
  );

  if (sessionResult.rowCount === 0) {
    throw unauthorized('Session not found');
  }

  const session = sessionResult.rows[0];
  if (session.revoked_at || new Date(session.expires_at) < new Date()) {
    throw unauthorized('Session expired');
  }

  const memberships = await listMembershipsForUser(session.user_id);
  const activeTenant = memberships.find((membership) => membership.tenantId === decoded.tenantId) ?? null;

  return {
    session,
    user: {
      id: session.user_id,
      email: session.email,
      role: session.platform_role,
      fullName: session.full_name,
      status: session.status,
    },
    activeTenant,
    memberships,
    claims: decoded,
  };
}

export async function listMembershipsForUser(userId) {
  const result = await query(
    `SELECT
      tm.role,
      tm.is_primary,
      t.id AS tenant_id,
      t.tenant_key,
      t.display_name,
      t.kind,
      t.status,
      t.settings,
      t.parent_tenant_id
    FROM tenant_memberships tm
    INNER JOIN tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = $1
    ORDER BY tm.is_primary DESC, t.created_at ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantKey: row.tenant_key,
    displayName: row.display_name,
    kind: row.kind,
    status: row.status,
    parentTenantId: row.parent_tenant_id,
    settings: row.settings ?? {},
    role: row.role,
    isPrimary: row.is_primary,
  }));
}

export async function createTenantUser({ tenantId, email, password, fullName, role }) {
  if (!isKnownRole(role)) {
    throw badRequest('Unknown role');
  }

  const passwordHash = await hashPassword(password);
  const normalizedEmail = email.trim().toLowerCase();

  return withTransaction(async (client) => {
    let userResult = await client.query('SELECT id, email, role, full_name, status FROM users WHERE email = $1', [normalizedEmail]);
    let user = userResult.rows[0];

    if (!user) {
      userResult = await client.query(
        `INSERT INTO users (id, tenant_id, email, role, password_hash, full_name, status)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'active')
         RETURNING id, email, role, full_name, status, created_at`,
        [tenantId, normalizedEmail, role, passwordHash, fullName.trim()]
      );
      user = userResult.rows[0];
    }

    await client.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role, is_primary)
       VALUES ($1, $2, $3, FALSE)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [tenantId, user.id, role]
    );

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      status: user.status,
      role,
      roleDetails: roleSummary(role),
    };
  });
}

export async function changeOwnPassword({ actor, currentPassword, newPassword }) {
  if (!currentPassword || !newPassword) throw badRequest('currentPassword and newPassword are required');
  if (currentPassword === newPassword) throw badRequest('New password must be different from the current password');
  if (String(newPassword).length < 10) throw badRequest('New password must be at least 10 characters');

  const userResult = await query('SELECT id, password_hash FROM users WHERE id = $1', [actor.user.id]);
  if (userResult.rowCount === 0) throw unauthorized('User not found');
  const current = userResult.rows[0];
  const matches = await verifyPassword(currentPassword, current.password_hash);
  if (!matches) throw unauthorized('Current password is incorrect');

  const nextHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [actor.user.id, nextHash]);
  await revokeSession(actor.session.id);
  return { changed: true };
}

export async function revokeSession(sessionId) {
  await query('UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1', [sessionId]);
}

export async function setUserPassword({ userId, password }) {
  const nextPassword = String(password ?? '');
  if (nextPassword.length < 10) throw badRequest('New password must be at least 10 characters long');
  const passwordHash = await hashPassword(nextPassword);
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
  await query('UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

function buildAuthProfile({ user, memberships, activeTenantId = null }) {
  const normalizedMemberships = memberships.map((membership) => ({
    tenantId: membership.tenantId ?? membership.id,
    tenantKey: membership.tenantKey ?? membership.tenant_key,
    displayName: membership.displayName ?? membership.display_name,
    kind: membership.kind,
    status: membership.status,
    parentTenantId: membership.parentTenantId ?? membership.parent_tenant_id ?? null,
    settings: membership.settings ?? {},
    role: membership.role,
    isPrimary: membership.isPrimary ?? membership.is_primary ?? false,
  }));

  const activeTenant = normalizedMemberships.find((membership) => membership.tenantId === activeTenantId)
    ?? normalizedMemberships.find((membership) => membership.isPrimary)
    ?? normalizedMemberships[0]
    ?? null;

  return {
    user: {
      id: user.id,
      email: user.email,
      platformRole: user.role,
      fullName: user.full_name ?? user.fullName,
      status: user.status,
    },
    activeTenant,
    memberships: normalizedMemberships,
  };
}
