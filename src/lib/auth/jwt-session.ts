import { createHash, randomBytes } from 'crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { ApiError } from '@/lib/api-error';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_INACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;
const JWT_ISSUER = 'fitnexus';
const JWT_AUDIENCE = 'fitnexus-api';

type JwtPayload = {
  sub: string;
  sid: string;
  typ: 'access';
};

export type TokenContext = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSec: number;
  refreshTokenExpiresAt: string;
  inactivityExpiresAt: string;
};

export type RefreshSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  ipAddress: string | null;
};

export type RefreshSessionStore = {
  create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    lastUsedAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<RefreshSessionRecord>;
  findByTokenHash(tokenHash: string): Promise<RefreshSessionRecord | null>;
  findByIdAndUser(id: string, userId: string): Promise<RefreshSessionRecord | null>;
  updateById(
    id: string,
    data: {
      tokenHash?: string;
      lastUsedAt?: Date;
      revokedAt?: Date;
      userAgent?: string | null;
      ipAddress?: string | null;
    }
  ): Promise<RefreshSessionRecord>;
};

function getJwtSecret(): Uint8Array {
  const raw = process.env.APP_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!raw) {
    throw new Error('APP_JWT_SECRET or NEXTAUTH_SECRET is required for JWT access tokens');
  }
  return new TextEncoder().encode(raw);
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function inactivityExpired(lastUsedAt: Date, now: Date): boolean {
  return addMs(lastUsedAt, REFRESH_INACTIVITY_TTL_MS) <= now;
}

async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  const secret = getJwtSecret();
  return await new SignJWT({ sid: sessionId, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

async function decodeAccessToken(accessToken: string): Promise<JwtPayload> {
  const secret = getJwtSecret();
  const { payload } = await jwtVerify(accessToken, secret, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new ApiError(401, 'Invalid access token');
  }

  return payload as unknown as JwtPayload;
}

function buildTokenPairResponse(
  accessToken: string,
  refreshToken: string,
  refreshExpiresAt: Date,
  lastUsedAt: Date
): TokenPair {
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresInSec: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    inactivityExpiresAt: addMs(lastUsedAt, REFRESH_INACTIVITY_TTL_MS).toISOString(),
  };
}

export function createJwtSessionService(store: RefreshSessionStore) {
  return {
    async issueTokenPair(userId: string, context: TokenContext = {}): Promise<TokenPair> {
      const now = new Date();
      const refreshToken = newRefreshToken();
      const refreshTokenHash = hashRefreshToken(refreshToken);
      const refreshExpiresAt = addMs(now, REFRESH_TOKEN_TTL_MS);

      const refreshSession = await store.create({
        userId,
        tokenHash: refreshTokenHash,
        expiresAt: refreshExpiresAt,
        lastUsedAt: now,
        userAgent: context.userAgent ?? undefined,
        ipAddress: context.ipAddress ?? undefined,
      });

      const accessToken = await signAccessToken(userId, refreshSession.id);
      return buildTokenPairResponse(accessToken, refreshToken, refreshExpiresAt, now);
    },

    async refreshTokenPair(refreshToken: string, context: TokenContext = {}): Promise<TokenPair> {
      const tokenHash = hashRefreshToken(refreshToken);
      const now = new Date();
      const existing = await store.findByTokenHash(tokenHash);

      if (!existing || existing.revokedAt || existing.expiresAt <= now || inactivityExpired(existing.lastUsedAt, now)) {
        throw new ApiError(401, 'Refresh token is invalid or expired');
      }

      const rotatedToken = newRefreshToken();
      const rotatedTokenHash = hashRefreshToken(rotatedToken);

      const updated = await store.updateById(existing.id, {
        tokenHash: rotatedTokenHash,
        lastUsedAt: now,
        userAgent: context.userAgent ?? existing.userAgent ?? undefined,
        ipAddress: context.ipAddress ?? existing.ipAddress ?? undefined,
      });

      const accessToken = await signAccessToken(updated.userId, updated.id);
      return buildTokenPairResponse(accessToken, rotatedToken, updated.expiresAt, updated.lastUsedAt);
    },

    async revokeRefreshToken(refreshToken: string): Promise<void> {
      const tokenHash = hashRefreshToken(refreshToken);
      const token = await store.findByTokenHash(tokenHash);
      if (!token || token.revokedAt) return;
      await store.updateById(token.id, { revokedAt: new Date() });
    },

    async validateAccessTokenAndTouch(accessToken: string): Promise<string> {
      const payload = await decodeAccessToken(accessToken);
      const now = new Date();
      const refreshSession = await store.findByIdAndUser(payload.sid, payload.sub);

      if (!refreshSession || refreshSession.expiresAt <= now || inactivityExpired(refreshSession.lastUsedAt, now)) {
        throw new ApiError(401, 'Session expired due to inactivity');
      }

      await store.updateById(refreshSession.id, { lastUsedAt: now });
      return payload.sub;
    },
  };
}

async function createPrismaStore(): Promise<RefreshSessionStore> {
  const { prisma } = await import('@/lib/prisma');
  return {
    async create(data) {
      return await prisma.apiRefreshToken.create({ data });
    },
    async findByTokenHash(tokenHash) {
      return await prisma.apiRefreshToken.findUnique({ where: { tokenHash } });
    },
    async findByIdAndUser(id, userId) {
      return await prisma.apiRefreshToken.findFirst({
        where: { id, userId, revokedAt: null },
      });
    },
    async updateById(id, data) {
      return await prisma.apiRefreshToken.update({
        where: { id },
        data,
      });
    },
  };
}

export async function issueTokenPair(userId: string, context: TokenContext = {}): Promise<TokenPair> {
  const service = createJwtSessionService(await createPrismaStore());
  return await service.issueTokenPair(userId, context);
}

export async function refreshTokenPair(refreshToken: string, context: TokenContext = {}): Promise<TokenPair> {
  const service = createJwtSessionService(await createPrismaStore());
  return await service.refreshTokenPair(refreshToken, context);
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const service = createJwtSessionService(await createPrismaStore());
  return await service.revokeRefreshToken(refreshToken);
}

export async function validateAccessTokenAndTouch(accessToken: string): Promise<string> {
  const service = createJwtSessionService(await createPrismaStore());
  return await service.validateAccessTokenAndTouch(accessToken);
}

export async function issueTokenPairWithStore(
  store: RefreshSessionStore,
  userId: string,
  context: TokenContext = {}
): Promise<TokenPair> {
  return await createJwtSessionService(store).issueTokenPair(userId, context);
}

export async function refreshTokenPairWithStore(
  store: RefreshSessionStore,
  refreshToken: string,
  context: TokenContext = {}
): Promise<TokenPair> {
  return await createJwtSessionService(store).refreshTokenPair(refreshToken, context);
}

export async function validateAccessTokenAndTouchWithStore(
  store: RefreshSessionStore,
  accessToken: string
): Promise<string> {
  return await createJwtSessionService(store).validateAccessTokenAndTouch(accessToken);
}

export async function revokeRefreshTokenWithStore(
  store: RefreshSessionStore,
  refreshToken: string
): Promise<void> {
  await createJwtSessionService(store).revokeRefreshToken(refreshToken);
}

export function getRequestMeta(request: Request): TokenContext {
  return {
    userAgent: request.headers.get('user-agent'),
    ipAddress:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip'),
  };
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

export async function requireApiUserId(request: Request): Promise<string> {
  const bearer = readBearerToken(request);
  if (bearer) {
    try {
      return await validateAccessTokenAndTouch(bearer);
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new ApiError(401, 'Access token expired');
      }
      throw error;
    }
  }

  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');
  return session.user.id;
}

export const jwtSessionConfig = {
  accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlMs: REFRESH_TOKEN_TTL_MS,
  refreshInactivityTtlMs: REFRESH_INACTIVITY_TTL_MS,
};
