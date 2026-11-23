import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../../src/db';
import {
  roles,
  tenantMembershipBranches,
  tenantMembershipOutlets,
  tenantMemberships,
  userSessions,
  users,
} from '../../src/db/schema';
import { withTenantTransaction } from '../db/tenantTx';
import { constantTimeEqual, sha256Hex } from '../utils/cryptoAndMoney';
import { SESSION_COOKIE_NAME } from '../services/authService';

export interface AuthContext {
  userId: string;
  email: string;
  fullName: string;
  sessionId: string;
  activeTenantId: string | null;
  platformRole: 'platform_admin' | 'platform_support_ro' | null;
  csrfTokenHash: string;
}

export interface TenantMembershipContext {
  tenantId: string;
  membershipId: string;
  roleId: string;
  scopeType: 'tenant' | 'branch' | 'outlet';
  permissions: string[];
  allowedBranchIds: string[];
  allowedOutletIds: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      tenantContext?: TenantMembershipContext;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (!rawToken || typeof rawToken !== 'string') {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const tokenHash = sha256Hex(rawToken);
    const now = new Date();

    const rows = await db
      .select({
        sessionId: userSessions.id,
        userId: userSessions.userId,
        activeTenantId: userSessions.activeTenantId,
        csrfTokenHash: userSessions.csrfTokenHash,
        email: users.email,
        fullName: users.fullName,
        platformRole: users.platformRole,
        userStatus: users.status,
      })
      .from(userSessions)
      .innerJoin(users, eq(users.id, userSessions.userId))
      .where(
        and(
          eq(userSessions.tokenHash, tokenHash),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, now)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row || row.userStatus !== 'active') {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    req.auth = {
      userId: row.userId,
      email: row.email,
      fullName: row.fullName,
      sessionId: row.sessionId,
      activeTenantId: row.activeTenantId,
      platformRole: row.platformRole as AuthContext['platformRole'],
      csrfTokenHash: row.csrfTokenHash,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Verifies Origin/Referer host match + X-CSRF-Token header bound to the active session.
 */
export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required for CSRF validation' });
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const forwardedHost =
        typeof req.headers['x-forwarded-host'] === 'string'
          ? req.headers['x-forwarded-host'].split(',')[0].trim()
          : undefined;
      const host = forwardedHost || req.headers.host;
      const appUrlHost = process.env.APP_URL ? new URL(process.env.APP_URL).host : undefined;
      if (host && originHost !== host && originHost !== appUrlHost) {
        res.status(403).json({ error: 'Origin mismatch rejected by CSRF policy' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Invalid Origin header' });
      return;
    }
  }

  const rawCsrf = req.headers['x-csrf-token'];
  if (!rawCsrf || typeof rawCsrf !== 'string') {
    res.status(403).json({ error: 'Missing X-CSRF-Token header' });
    return;
  }

  const candidateHash = sha256Hex(rawCsrf);
  if (!constantTimeEqual(candidateHash, req.auth.csrfTokenHash)) {
    res.status(403).json({ error: 'Invalid X-CSRF-Token' });
    return;
  }

  next();
}

export async function requireTenantContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const tenantId = req.auth.activeTenantId;
    if (!tenantId) {
      res.status(403).json({ error: 'No active tenant selected in session' });
      return;
    }

    const membershipData = await withTenantTransaction(tenantId, async (tx) => {
      const [m] = await tx
        .select({
          membershipId: tenantMemberships.id,
          roleId: tenantMemberships.roleId,
          scopeType: tenantMemberships.scopeType,
          status: tenantMemberships.status,
          permissions: roles.permissions,
        })
        .from(tenantMemberships)
        .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
        .where(
          and(
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.userId, req.auth!.userId)
          )
        )
        .limit(1);

      if (!m || m.status !== 'active') return null;

      const branchRows = await tx
        .select({ branchId: tenantMembershipBranches.branchId })
        .from(tenantMembershipBranches)
        .where(
          and(
            eq(tenantMembershipBranches.tenantId, tenantId),
            eq(tenantMembershipBranches.membershipId, m.membershipId)
          )
        );

      const outletRows = await tx
        .select({ outletId: tenantMembershipOutlets.outletId })
        .from(tenantMembershipOutlets)
        .where(
          and(
            eq(tenantMembershipOutlets.tenantId, tenantId),
            eq(tenantMembershipOutlets.membershipId, m.membershipId)
          )
        );

      return {
        tenantId,
        membershipId: m.membershipId,
        roleId: m.roleId,
        scopeType: m.scopeType as TenantMembershipContext['scopeType'],
        permissions: m.permissions,
        allowedBranchIds: branchRows.map((r) => r.branchId),
        allowedOutletIds: outletRows.map((r) => r.outletId),
      };
    });

    if (!membershipData) {
      res.status(403).json({ error: 'Forbidden: active tenant membership not found' });
      return;
    }

    req.tenantContext = membershipData;
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.tenantContext;
    if (!ctx) {
      res.status(403).json({ error: 'Tenant context required' });
      return;
    }
    if (!ctx.permissions.includes('*') && !ctx.permissions.includes(permission)) {
      res.status(403).json({ error: `Missing permission: ${permission}` });
      return;
    }
    next();
  };
}

export function canAccessBranch(ctx: TenantMembershipContext, branchId: string): boolean {
  if (ctx.scopeType === 'tenant') return true;
  return ctx.allowedBranchIds.includes(branchId);
}

export function canAccessOutlet(
  ctx: TenantMembershipContext,
  outletId: string,
  outletBranchId?: string
): boolean {
  if (ctx.scopeType === 'tenant') return true;
  if (ctx.scopeType === 'branch') {
    return outletBranchId ? ctx.allowedBranchIds.includes(outletBranchId) : false;
  }
  return ctx.allowedOutletIds.includes(outletId);
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth || !req.auth.platformRole) {
    res.status(403).json({ error: 'Platform administrator access required' });
    return;
  }
  next();
}
