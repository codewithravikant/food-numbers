import { prisma } from '@/lib/prisma';

const fallbackBuckets = new Map<string, { count: number; resetAt: number }>();
let lastCleanupAt = 0;

function floorWindow(nowMs: number, windowMs: number): Date {
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}

function hitFallback(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const bucket = fallbackBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    fallbackBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true as const, source: 'memory-fallback' as const };
  }
  if (bucket.count >= max) return { success: false as const, source: 'memory-fallback' as const };
  bucket.count += 1;
  return { success: true as const, source: 'memory-fallback' as const };
}

async function maybeCleanupExpiredBuckets(now: Date): Promise<void> {
  const nowMs = now.getTime();
  if (nowMs - lastCleanupAt < 5 * 60 * 1000) return;
  lastCleanupAt = nowMs;
  await prisma.apiRateLimitBucket.deleteMany({
    where: { updatedAt: { lt: new Date(nowMs - 2 * 24 * 60 * 60 * 1000) } },
  });
}

async function hit(action: string, scopeKey: string, max: number, windowMs: number) {
  const now = new Date();
  const nowMs = now.getTime();
  const windowStart = floorWindow(nowMs, windowMs);
  const bucketKey = `${action}:${scopeKey}:${windowStart.toISOString()}`;
  try {
    await maybeCleanupExpiredBuckets(now);
    const row = await prisma.apiRateLimitBucket.upsert({
      where: {
        action_scopeKey_windowStart: {
          action,
          scopeKey,
          windowStart,
        },
      },
      create: {
        action,
        scopeKey,
        windowStart,
        hitCount: 1,
      },
      update: {
        hitCount: { increment: 1 },
      },
    });
    return { success: row.hitCount <= max, source: 'database' as const };
  } catch {
    return hitFallback(bucketKey, max, windowMs);
  }
}

export async function rateLimitStrict(userId: string, action: string) {
  return await hit(action, userId, 20, 60_000);
}

export async function rateLimitMutation(userId: string, action: string) {
  return await hit(action, userId, 40, 60_000);
}

export async function rateLimitByUser(userId: string, action: string, max: number, windowMs: number) {
  return await hit(action, userId, max, windowMs);
}

/** For unauthenticated routes keyed by email or IP fragment (e.g. resend-verify). */
export async function rateLimitByKey(key: string, max: number, windowMs: number) {
  return await hit('keyed-action', key, max, windowMs);
}
