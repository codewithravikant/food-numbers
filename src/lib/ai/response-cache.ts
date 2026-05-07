import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { DailyAction, SmartMeal } from '@/types/ai';

export type CachedDailyPlanPayload = {
  insightText: string;
  recommendations: {
    actions: DailyAction[];
    smartMeal: SmartMeal;
    preserveMode: boolean;
    insightExpanded: string;
    priority: 'high' | 'medium' | 'low';
  };
  modelUsed: string;
  promptVersion: string;
  fallbackUsed: boolean;
};

const DAILY_PLAN_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCachedDailyPlanPayload(value: unknown): value is CachedDailyPlanPayload {
  if (!isRecord(value)) return false;
  if (typeof value.insightText !== 'string') return false;
  if (typeof value.modelUsed !== 'string') return false;
  if (typeof value.promptVersion !== 'string') return false;
  if (typeof value.fallbackUsed !== 'boolean') return false;

  const rec = value.recommendations;
  if (!isRecord(rec)) return false;
  if (!Array.isArray(rec.actions)) return false;
  if (!isRecord(rec.smartMeal)) return false;
  if (typeof rec.preserveMode !== 'boolean') return false;
  if (typeof rec.insightExpanded !== 'string') return false;
  if (rec.priority !== 'high' && rec.priority !== 'medium' && rec.priority !== 'low') return false;

  return true;
}

export function makeDailyPlanCacheKey(userId: string, dateKey: string): string {
  return createHash('sha256').update(`daily-plan:${userId}:${dateKey}`).digest('hex');
}

export async function getCachedDailyPlan(cacheKey: string): Promise<CachedDailyPlanPayload | null> {
  const row = await prisma.aiResponseCache.findUnique({ where: { cacheKey } });
  if (!row) return null;
  if (row.expiresAt <= new Date()) return null;
  return isCachedDailyPlanPayload(row.payload) ? row.payload : null;
}

export async function setCachedDailyPlan(cacheKey: string, payload: CachedDailyPlanPayload): Promise<void> {
  await prisma.aiResponseCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      payload: JSON.parse(JSON.stringify(payload)),
      expiresAt: new Date(Date.now() + DAILY_PLAN_CACHE_TTL_MS),
    },
    update: {
      payload: JSON.parse(JSON.stringify(payload)),
      expiresAt: new Date(Date.now() + DAILY_PLAN_CACHE_TTL_MS),
    },
  });
}
