import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'crypto';
import { SignJWT, decodeJwt } from 'jose';
import { ApiError } from '../api-error';
import {
  createJwtSessionService,
  type RefreshSessionRecord,
  type RefreshSessionStore,
  jwtSessionConfig,
} from './jwt-session';

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-jwt';

class InMemoryRefreshStore implements RefreshSessionStore {
  private rows = new Map<string, RefreshSessionRecord>();

  async create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    lastUsedAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<RefreshSessionRecord> {
    const id = `rt_${Math.random().toString(36).slice(2, 10)}`;
    const row: RefreshSessionRecord = {
      id,
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      lastUsedAt: data.lastUsedAt,
      revokedAt: null,
      userAgent: data.userAgent ?? null,
      ipAddress: data.ipAddress ?? null,
    };
    this.rows.set(id, row);
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshSessionRecord | null> {
    for (const row of this.rows.values()) {
      if (row.tokenHash === tokenHash) return row;
    }
    return null;
  }

  async findByIdAndUser(id: string, userId: string): Promise<RefreshSessionRecord | null> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) return null;
    return row;
  }

  async updateById(
    id: string,
    data: {
      tokenHash?: string;
      lastUsedAt?: Date;
      revokedAt?: Date;
      userAgent?: string | null;
      ipAddress?: string | null;
    }
  ): Promise<RefreshSessionRecord> {
    const row = this.rows.get(id);
    if (!row) {
      throw new Error('Row not found');
    }
    const next: RefreshSessionRecord = {
      ...row,
      tokenHash: data.tokenHash ?? row.tokenHash,
      lastUsedAt: data.lastUsedAt ?? row.lastUsedAt,
      revokedAt: data.revokedAt ?? row.revokedAt,
      userAgent: data.userAgent ?? row.userAgent,
      ipAddress: data.ipAddress ?? row.ipAddress,
    };
    this.rows.set(id, next);
    return next;
  }
}

test('refresh works with expired access token and valid refresh token', async () => {
  const store = new InMemoryRefreshStore();
  const service = createJwtSessionService(store);
  const issued = await service.issueTokenPair('user_1');

  const decodedAccess = decodeJwt(issued.accessToken) as { sid: string };
  const expiredAccess = await new SignJWT({ sid: decodedAccess.sid, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user_1')
    .setIssuer('fitnexus')
    .setAudience('fitnexus-api')
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
    .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET!));

  await assert.rejects(
    () => service.validateAccessTokenAndTouch(expiredAccess),
    (error) => error instanceof Error
  );

  const refreshed = await service.refreshTokenPair(issued.refreshToken);
  assert.ok(refreshed.accessToken.length > 20);
  assert.notEqual(refreshed.refreshToken, issued.refreshToken);
});

test('refresh token is rejected after inactivity timeout', async () => {
  const store = new InMemoryRefreshStore();
  const service = createJwtSessionService(store);
  const issued = await service.issueTokenPair('user_2');

  const row = await store.findByTokenHash(createHash('sha256').update(issued.refreshToken).digest('hex'));
  assert.ok(row);
  await store.updateById(row!.id, {
    lastUsedAt: new Date(Date.now() - jwtSessionConfig.refreshInactivityTtlMs - 1000),
  });

  await assert.rejects(
    () => service.refreshTokenPair(issued.refreshToken),
    (error) => error instanceof ApiError && error.status === 401
  );
});

test('revoked refresh token is rejected', async () => {
  const store = new InMemoryRefreshStore();
  const service = createJwtSessionService(store);
  const issued = await service.issueTokenPair('user_3');
  await service.revokeRefreshToken(issued.refreshToken);

  await assert.rejects(
    () => service.refreshTokenPair(issued.refreshToken),
    (error) => error instanceof ApiError && error.status === 401
  );
});
