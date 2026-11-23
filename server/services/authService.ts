import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { db } from '../../src/db';
import { passwordResetTokens, userSessions, users } from '../../src/db/schema';
import { generateOpaqueToken, sha256Hex } from '../utils/cryptoAndMoney';

export const SESSION_COOKIE_NAME = 'amal_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, candidate: string): Promise<boolean> {
  try {
    return await argon2Verify(passwordHash, candidate);
  } catch {
    return false;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isHttpsRequest(req: Request): boolean {
  const xfProto = req.headers['x-forwarded-proto'];
  if (typeof xfProto === 'string') {
    return xfProto.split(',')[0].trim() === 'https';
  }
  return req.secure || req.protocol === 'https';
}

export function setSessionCookie(req: Request, res: Response, rawToken: string, expiresAt: Date): void {
  const isHttps = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', parts.join('; '));
}

export interface IssuedSession {
  sessionId: string;
  rawSessionToken: string;
  rawCsrfToken: string;
  expiresAt: Date;
  familyId: string;
}

export async function createSession(params: {
  userId: string;
  activeTenantId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  familyId?: string;
}): Promise<IssuedSession> {
  const rawSessionToken = generateOpaqueToken(32);
  const rawCsrfToken = generateOpaqueToken(24);
  const tokenHash = sha256Hex(rawSessionToken);
  const csrfTokenHash = sha256Hex(rawCsrfToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const familyId = params.familyId || crypto.randomUUID();

  const [created] = await db
    .insert(userSessions)
    .values({
      userId: params.userId,
      activeTenantId: params.activeTenantId ?? null,
      tokenHash,
      csrfTokenHash,
      familyId,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ? params.userAgent.slice(0, 300) : null,
      expiresAt,
    })
    .returning({ id: userSessions.id });

  return {
    sessionId: created.id,
    rawSessionToken,
    rawCsrfToken,
    expiresAt,
    familyId,
  };
}

/**
 * Rotates an existing session token. If a previously revoked/replaced token from
 * the same family is replayed, revokes the entire session family immediately.
 */
export async function rotateSession(params: {
  rawSessionToken: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<IssuedSession | null> {
  const tokenHash = sha256Hex(params.rawSessionToken);
  const [existing] = await db
    .select()
    .from(userSessions)
    .where(eq(userSessions.tokenHash, tokenHash))
    .limit(1);

  if (!existing) return null;

  // Replay / theft detection: token was already revoked or replaced
  if (existing.revokedAt !== null || existing.replacedBySessionId !== null) {
    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.familyId, existing.familyId), isNull(userSessions.revokedAt)));
    return null;
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.id, existing.id));
    return null;
  }

  const next = await createSession({
    userId: existing.userId,
    activeTenantId: existing.activeTenantId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    familyId: existing.familyId,
  });

  await db
    .update(userSessions)
    .set({
      revokedAt: new Date(),
      replacedBySessionId: next.sessionId,
    })
    .where(eq(userSessions.id, existing.id));

  return next;
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(eq(userSessions.id, sessionId));
}

export async function createPasswordReset(email: string): Promise<{
  user: { id: string; email: string; fullName: string };
  rawToken: string;
} | null> {
  const normalized = normalizeEmail(email);
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
    })
    .from(users)
    .where(eq(users.emailNormalized, normalized))
    .limit(1);

  if (!user || user.status !== 'active') return null;

  const rawToken = generateOpaqueToken(32);
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  return { user: { id: user.id, email: user.email, fullName: user.fullName }, rawToken };
}

export async function consumePasswordReset(rawToken: string, newPassword: string): Promise<boolean> {
  const tokenHash = sha256Hex(rawToken);
  const now = new Date();
  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now)
      )
    )
    .limit(1);

  if (!record) return false;

  const newHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(eq(passwordResetTokens.id, record.id));
    await tx
      .update(users)
      .set({ passwordHash: newHash, updatedAt: now })
      .where(eq(users.id, record.userId));
    // Revoke all existing sessions for security after password change
    await tx
      .update(userSessions)
      .set({ revokedAt: now })
      .where(and(eq(userSessions.userId, record.userId), isNull(userSessions.revokedAt)));
  });

  return true;
}
