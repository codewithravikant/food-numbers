import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-error';

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export async function resolveInsightForDailyActionUpdate(userId: string, clientPlanId: string) {
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const today = startOfToday();

  // If the client sent a concrete plan id, prefer that.
  if (clientPlanId && clientPlanId !== 'default') {
    const byId = await prisma.aIInsight.findFirst({
      where: {
        id: clientPlanId,
        userId,
        modelUsed: { not: 'observation_summary_v1' },
      },
    });
    if (byId) return byId;
  }

  // Fallback to today's newest plan.
  const todayInsight = await prisma.aIInsight.findFirst({
    where: {
      userId,
      generatedAt: { gte: today },
      modelUsed: { not: 'observation_summary_v1' },
    },
    orderBy: { generatedAt: 'desc' },
  });
  if (todayInsight) return todayInsight;

  // Final fallback to latest plan overall.
  const latestInsight = await prisma.aIInsight.findFirst({
    where: {
      userId,
      modelUsed: { not: 'observation_summary_v1' },
    },
    orderBy: { generatedAt: 'desc' },
  });
  if (latestInsight) return latestInsight;

  throw new ApiError(404, 'No active daily plan found');
}
