import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../../src/db';
import {
  branches,
  outlets,
  roles,
  staffInvitationBranchScopes,
  staffInvitationOutletScopes,
  staffInvitations,
  tenantMembershipBranches,
  tenantMembershipOutlets,
  tenantMemberships,
  userSessions,
  users,
} from '../../src/db/schema';
import { withTenantTransaction } from '../db/tenantTx';
import {
  requireAuth,
  requirePermission,
  requireTenantContext,
  verifyCsrf,
} from '../middleware/auth';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  consumePasswordReset,
  createPasswordReset,
  createSession,
  hashPassword,
  normalizeEmail,
  revokeSessionById,
  rotateSession,
  setSessionCookie,
  verifyPassword,
} from '../services/authService';
import { getNotificationAdapter } from '../services/notificationAdapter';
import { hydrateWorkspaceForTenant } from '../services/workspaceMapper';
import { generateOpaqueToken, sha256Hex } from '../utils/cryptoAndMoney';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  fullName: z.string().min(2).max(120),
  phoneE164: z.string().max(32).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

async function fetchUserMemberships(userId: string) {
  const res = await db.execute(
    sql`SELECT tenant_id, slug, business_name, primary_business_type, role_id, scope_type, status
        FROM list_user_tenant_memberships(${userId}::uuid)`
  );
  return res.rows as Array<{
    tenant_id: string;
    slug: string;
    business_name: string;
    primary_business_type: string;
    role_id: string;
    scope_type: string;
    status: string;
  }>;
}

authRouter.post('/auth/register', authLimiter, async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid registration fields', issues: parsed.error.issues });
      return;
    }

    const emailNorm = normalizeEmail(parsed.data.email);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emailNormalized, emailNorm))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const [created] = await db
      .insert(users)
      .values({
        email: parsed.data.email.trim(),
        emailNormalized: emailNorm,
        passwordHash,
        fullName: parsed.data.fullName.trim(),
        phoneE164: parsed.data.phoneE164?.trim() || null,
      })
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        platformRole: users.platformRole,
      });

    const session = await createSession({
      userId: created.id,
      activeTenantId: null,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    setSessionCookie(req, res, session.rawSessionToken, session.expiresAt);
    res.status(201).json({
      user: created,
      memberships: [],
      activeTenantId: null,
      csrfToken: session.rawCsrfToken,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/login', authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid credentials payload' });
      return;
    }

    const emailNorm = normalizeEmail(parsed.data.email);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, emailNorm))
      .limit(1);

    if (!user || user.status !== 'active') {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const ok = await verifyPassword(user.passwordHash, parsed.data.password);
    if (!ok) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const memberships = await fetchUserMemberships(user.id);
    const defaultTenantId = memberships[0]?.tenant_id || null;

    const session = await createSession({
      userId: user.id,
      activeTenantId: defaultTenantId,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    setSessionCookie(req, res, session.rawSessionToken, session.expiresAt);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        platformRole: user.platformRole,
      },
      memberships: memberships.map((m) => ({
        tenantId: m.tenant_id,
        slug: m.slug,
        businessName: m.business_name,
        primaryBusinessType: m.primary_business_type,
        roleId: m.role_id,
        scopeType: m.scope_type,
      })),
      activeTenantId: defaultTenantId,
      csrfToken: session.rawCsrfToken,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/refresh', async (req, res, next) => {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (!rawToken || typeof rawToken !== 'string') {
      res.status(401).json({ error: 'Missing session cookie' });
      return;
    }

    const rotated = await rotateSession({
      rawSessionToken: rawToken,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    if (!rotated) {
      clearSessionCookie(req, res);
      res.status(401).json({ error: 'Session expired or token reuse detected' });
      return;
    }

    setSessionCookie(req, res, rotated.rawSessionToken, rotated.expiresAt);
    res.json({ csrfToken: rotated.rawCsrfToken, expiresAt: rotated.expiresAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/logout', requireAuth, verifyCsrf, async (req, res, next) => {
  try {
    await revokeSessionById(req.auth!.sessionId);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const memberships = await fetchUserMemberships(req.auth!.userId);
    res.json({
      user: {
        id: req.auth!.userId,
        email: req.auth!.email,
        fullName: req.auth!.fullName,
        platformRole: req.auth!.platformRole,
      },
      activeTenantId: req.auth!.activeTenantId,
      memberships: memberships.map((m) => ({
        tenantId: m.tenant_id,
        slug: m.slug,
        businessName: m.business_name,
        primaryBusinessType: m.primary_business_type,
        roleId: m.role_id,
        scopeType: m.scope_type,
      })),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/switch-tenant', requireAuth, verifyCsrf, async (req, res, next) => {
  try {
    const schema = z.object({ tenantId: z.string().uuid() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid tenantId UUID is required' });
      return;
    }

    const memberships = await fetchUserMemberships(req.auth!.userId);
    const target = memberships.find((m) => m.tenant_id === parsed.data.tenantId);
    if (!target) {
      res.status(403).json({ error: 'Forbidden: you do not belong to that tenant' });
      return;
    }

    await db
      .update(userSessions)
      .set({ activeTenantId: target.tenant_id })
      .where(eq(userSessions.id, req.auth!.sessionId));

    const workspace = await withTenantTransaction(target.tenant_id, (tx) =>
      hydrateWorkspaceForTenant(tx, target.tenant_id, { includeSensitiveCustomerData: true })
    );

    res.json({ activeTenantId: target.tenant_id, workspace });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/password-reset/request', authLimiter, async (req, res, next) => {
  try {
    const schema = z.object({ email: z.string().email() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    const reset = await createPasswordReset(parsed.data.email);
    if (reset) {
      const adapter = getNotificationAdapter();
      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      await adapter.sendPasswordReset({
        toEmail: reset.user.email,
        fullName: reset.user.fullName,
        resetUrl: `${baseUrl}/?resetToken=${encodeURIComponent(reset.rawToken)}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
    }
    // Always return 200 to prevent account enumeration
    res.json({ ok: true, message: 'If that email exists, a reset link has been queued.' });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/password-reset/confirm', authLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      token: z.string().min(10),
      newPassword: z.string().min(8).max(128),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid token and password (min 8 chars) required' });
      return;
    }

    const updated = await consumePasswordReset(parsed.data.token, parsed.data.newPassword);
    if (!updated) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// SCOPED STAFF & INVITATION MANAGEMENT
// ============================================================================

authRouter.get(
  '/staff',
  requireAuth,
  requireTenantContext,
  requirePermission('workspace:read'),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const staffList = await withTenantTransaction(ctx.tenantId, async (tx) => {
        const rows = await tx
          .select({
            membershipId: tenantMemberships.id,
            userId: tenantMemberships.userId,
            roleId: tenantMemberships.roleId,
            scopeType: tenantMemberships.scopeType,
            status: tenantMemberships.status,
            fullName: users.fullName,
            email: users.email,
          })
          .from(tenantMemberships)
          .innerJoin(users, eq(users.id, tenantMemberships.userId));
        return rows;
      });
      res.json({ staff: staffList });
    } catch (err) {
      next(err);
    }
  }
);

const inviteSchema = z.object({
  email: z.string().email().max(254),
  roleId: z.enum(['tenant_manager', 'branch_manager', 'outlet_staff', 'kitchen_staff']),
  scopeType: z.enum(['tenant', 'branch', 'outlet']),
  branchIds: z.array(z.string().uuid()).default([]),
  outletAssignments: z
    .array(
      z.object({
        branchId: z.string().uuid(),
        outletId: z.string().uuid(),
      })
    )
    .default([]),
});

authRouter.post(
  '/staff/invitations',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('staff:manage'),
  async (req, res, next) => {
    try {
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid invitation payload', issues: parsed.error.issues });
        return;
      }

      const data = parsed.data;
      if (data.scopeType === 'branch' && data.branchIds.length === 0) {
        res.status(400).json({ error: 'Branch-scoped invitations require at least one branchId' });
        return;
      }
      if (data.scopeType === 'outlet' && data.outletAssignments.length === 0) {
        res
          .status(400)
          .json({ error: 'Outlet-scoped invitations require at least one outlet assignment' });
        return;
      }

      const ctx = req.tenantContext!;
      const rawInviteToken = generateOpaqueToken(32);
      const tokenHash = sha256Hex(rawInviteToken);
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

      const invitation = await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [inv] = await tx
          .insert(staffInvitations)
          .values({
            tenantId: ctx.tenantId,
            invitedByUserId: req.auth!.userId,
            emailNormalized: normalizeEmail(data.email),
            roleId: data.roleId,
            scopeType: data.scopeType,
            tokenHash,
            expiresAt,
          })
          .returning();

        for (const branchId of data.branchIds) {
          const [b] = await tx
            .select({ id: branches.id })
            .from(branches)
            .where(eq(branches.id, branchId))
            .limit(1);
          if (!b) throw new Error('Invalid branchId for tenant');
          await tx.insert(staffInvitationBranchScopes).values({
            tenantId: ctx.tenantId,
            invitationId: inv.id,
            branchId,
          });
        }

        for (const oa of data.outletAssignments) {
          const [o] = await tx
            .select({ id: outlets.id })
            .from(outlets)
            .where(and(eq(outlets.id, oa.outletId), eq(outlets.branchId, oa.branchId)))
            .limit(1);
          if (!o) throw new Error('Outlet does not belong to specified branch in this tenant');
          await tx.insert(staffInvitationOutletScopes).values({
            tenantId: ctx.tenantId,
            invitationId: inv.id,
            branchId: oa.branchId,
            outletId: oa.outletId,
          });
        }

        return inv;
      });

      const adapter = getNotificationAdapter();
      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      await adapter.sendStaffInvite({
        toEmail: normalizeEmail(data.email),
        tenantName: ctx.tenantId,
        roleName: data.roleId,
        inviteUrl: `${baseUrl}/?inviteToken=${encodeURIComponent(rawInviteToken)}`,
        expiresAt,
      });

      res.status(201).json({
        invitationId: invitation.id,
        expiresAt: invitation.expiresAt.toISOString(),
        scopeType: invitation.scopeType,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('does not belong')) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  }
);

authRouter.post('/staff/invitations/accept', requireAuth, verifyCsrf, async (req, res, next) => {
  try {
    const schema = z.object({ token: z.string().min(10) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invitation token required' });
      return;
    }

    const tokenHash = sha256Hex(parsed.data.token);
    const now = new Date();

    const lookupRes = await db.execute(
      sql`SELECT id, tenant_id, email_normalized, role_id, scope_type
          FROM resolve_staff_invitation_by_hash(${tokenHash})`
    );
    const row = lookupRes.rows[0] as
      | {
          id: string;
          tenant_id: string;
          email_normalized: string;
          role_id: 'tenant_manager' | 'branch_manager' | 'outlet_staff' | 'kitchen_staff';
          scope_type: 'tenant' | 'branch' | 'outlet';
        }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Invitation not found, expired, or already used' });
      return;
    }

    const invLookup = {
      id: row.id,
      tenantId: row.tenant_id,
      emailNormalized: row.email_normalized,
      roleId: row.role_id,
      scopeType: row.scope_type,
    };

    if (normalizeEmail(req.auth!.email) !== invLookup.emailNormalized) {
      res.status(403).json({ error: 'Invitation email does not match authenticated account' });
      return;
    }

    await withTenantTransaction(invLookup.tenantId, async (tx) => {
      const [membership] = await tx
        .insert(tenantMemberships)
        .values({
          tenantId: invLookup.tenantId,
          userId: req.auth!.userId,
          roleId: invLookup.roleId,
          scopeType: invLookup.scopeType,
          status: 'active',
        })
        .returning();

      const branchScopes = await tx
        .select()
        .from(staffInvitationBranchScopes)
        .where(eq(staffInvitationBranchScopes.invitationId, invLookup.id));

      for (const bs of branchScopes) {
        await tx.insert(tenantMembershipBranches).values({
          tenantId: invLookup.tenantId,
          membershipId: membership.id,
          branchId: bs.branchId,
        });
      }

      const outletScopes = await tx
        .select()
        .from(staffInvitationOutletScopes)
        .where(eq(staffInvitationOutletScopes.invitationId, invLookup.id));

      for (const os of outletScopes) {
        await tx.insert(tenantMembershipOutlets).values({
          tenantId: invLookup.tenantId,
          membershipId: membership.id,
          branchId: os.branchId,
          outletId: os.outletId,
        });
      }

      await tx
        .update(staffInvitations)
        .set({ acceptedAt: now })
        .where(eq(staffInvitations.id, invLookup.id));
    });

    await db
      .update(userSessions)
      .set({ activeTenantId: invLookup.tenantId })
      .where(eq(userSessions.id, req.auth!.sessionId));

    res.json({ ok: true, tenantId: invLookup.tenantId });
  } catch (err) {
    next(err);
  }
});

// Keep roles import used for type check
void roles;
