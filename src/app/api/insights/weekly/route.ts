import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getModel, getOpenAI, hasOpenAIKey } from '@/lib/ai/openai-client';
import { buildWeeklySummaryPrompt, WEEKLY_PROMPT_VERSION } from '@/lib/ai/prompts';
import { buildAIContext } from '@/lib/ai/context-builder';
import { handleApiError, ApiError } from '@/lib/api-error';
import { rateLimitByUser } from '@/lib/rate-limit';
import { redactContextForAI } from '@/lib/ai/privacy';
import { getCachedAI, setCachedAI } from '@/lib/ai/cache';
import { computeMealCompliance } from '@/lib/nutrition/compliance';
import type { WeeklyInsightPayload } from '@/types/ai';
import { buildAdaptiveCoachDelta } from '@/lib/ai/adaptive-coach';
import { logAiCall } from '@/lib/ai/dev-io-log';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';

/**
 * GET /api/insights/weekly
 * Retrieve the most recent weekly summary.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const summary = await prisma.aIInsight.findFirst({
      where: { userId: session.user.id, weeklyFocus: { not: null } },
      orderBy: { generatedAt: 'desc' },
    });

    return NextResponse.json({ summary });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/insights/weekly
 * Generate a new weekly wellness summary using AI.
 * Rate limited to 1 generation per day.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    // Rate limit: 1 weekly summary per day
    const { success } = await rateLimitByUser(session.user.id, 'weekly-summary', 1, 24 * 60 * 60 * 1000);
    if (!success) throw new ApiError(429, 'Weekly summary can only be generated once per day');

    const context = await buildAIContext(session.user.id);
    const [compliance, adaptive] = await Promise.all([
      computeMealCompliance(session.user.id, 7),
      buildAdaptiveCoachDelta(session.user.id),
    ]);

    // Calculate weekly stats
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const latestPlan = await prisma.mealPlan.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        calorieTarget: true,
        proteinTargetG: true,
        fallbackUsed: true,
        createdAt: true,
      },
    });
    const nutritionHint = latestPlan
      ? `Latest meal plan targets ~${Math.round(latestPlan.calorieTarget)} kcal/day, protein ~${Math.round(latestPlan.proteinTargetG)}g (generated ${latestPlan.createdAt.toISOString().slice(0, 10)}, fallback=${latestPlan.fallbackUsed}).`
      : null;

    const [insights, scores] = await Promise.all([
      prisma.aIInsight.findMany({
        where: {
          userId: session.user.id,
          generatedAt: { gte: weekAgo },
          weeklyFocus: null,
          modelUsed: { not: 'observation_summary_v1' },
        },
      }),
      prisma.wellnessScore.findMany({
        where: { userId: session.user.id, date: { gte: weekAgo } },
      }),
    ]);

    // Calculate completion rate from stored daily plan actions
    let totalActions = 0;
    let completedActions = 0;
    for (const insight of insights) {
      const recs = insight.recommendations as Record<string, unknown> | null;
      if (recs && Array.isArray(recs)) {
        for (const item of recs) {
          if (typeof item === 'object' && item !== null) {
            totalActions++;
            if ((item as { completed?: boolean }).completed) completedActions++;
          }
        }
      } else if (recs && typeof recs === 'object' && 'actions' in recs && Array.isArray(recs.actions)) {
        for (const action of recs.actions as { completed?: boolean }[]) {
          totalActions++;
          if (action.completed) completedActions++;
        }
      }
    }

    const completionRate = totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0;
    const avgScore = scores.length
      ? scores.reduce((sum: number, s: { score: number }) => sum + s.score, 0) / scores.length
      : 50;

    const prompt = buildWeeklySummaryPrompt({
      ...redactContextForAI(context),
      weeklyStats: { completionRate, avgScore },
      nutritionHint:
        `${nutritionHint || ''} Meal compliance ${(compliance.slotCompliance * 100).toFixed(0)}%, overeating risk=${compliance.overeatingRisk}. Adaptive: ${adaptive.whyChanged}`.trim(),
    });

    const cacheKey = `${session.user.id}:weekly:${WEEKLY_PROMPT_VERSION}:${completionRate}:${Math.round(avgScore)}:${compliance.overeatingRisk}`;
    let parsed = getCachedAI<WeeklyInsightPayload>(cacheKey);
    if (!parsed) {
      try {
        if (!hasOpenAIKey()) throw new Error('no_llm_key');
        const model = getModel();
        const request: ChatCompletionCreateParamsNonStreaming = {
          model,
          messages: [{ role: 'user', content: prompt }] as ChatCompletionMessageParam[],
          temperature: 0.5,
          max_tokens: 700,
          response_format: { type: 'json_object' as const },
        };
        const completion = await logAiCall({
          scope: 'weekly-insight',
          model,
          request,
          run: () => getOpenAI().chat.completions.create(request),
          pickResponse: (c) => ({
            id: (c as { id?: string }).id,
            model: (c as { model?: string }).model,
            usage: (c as { usage?: unknown }).usage,
            choice0: (c as { choices?: any[] }).choices?.[0],
          }),
        });
        const content = completion.choices[0]?.message?.content;
        if (!content) throw new ApiError(500, 'Empty AI response');
        const raw = JSON.parse(content) as Record<string, unknown>;
        parsed = {
          weeklyHealthSummary: String(raw.weeklyHealthSummary || raw.summary || 'Steady progress this week.'),
          nutritionFeedback: String(raw.nutritionFeedback || 'Keep meal timing consistent and log portions.'),
          behaviorCorrections: Array.isArray(raw.behaviorCorrections) ? raw.behaviorCorrections.map(String) : [],
          goalTrackingInsights: Array.isArray(raw.goalTrackingInsights) ? raw.goalTrackingInsights.map(String) : [],
          weeklyFocus: typeof raw.weeklyFocus === 'string' ? raw.weeklyFocus : undefined,
          riskLevel:
            compliance.overeatingRisk === 'high'
              ? 'high'
              : compliance.overeatingRisk === 'medium'
                ? 'medium'
                : 'low',
        };
        setCachedAI(cacheKey, parsed);
      } catch {
        parsed = {
          weeklyHealthSummary: `Your weekly average wellness score is ${Math.round(avgScore)}. Keep momentum with consistent logs.`,
          nutritionFeedback: `Meal compliance was ${(compliance.slotCompliance * 100).toFixed(0)}% with ${Math.round(compliance.dailyAvgCalories)} kcal/day average.`,
          behaviorCorrections: [
            'Log meals immediately after eating for better accuracy.',
            'Keep meal portions aligned with your daily calorie target.',
          ],
          goalTrackingInsights: [
            `Completion rate: ${completionRate}%`,
            `Overeating risk level: ${compliance.overeatingRisk}`,
            `Adaptive delta: ${adaptive.scoreDelta >= 0 ? '+' : ''}${adaptive.scoreDelta.toFixed(1)} points`,
          ],
          weeklyFocus: 'Consistency over intensity',
          riskLevel:
            compliance.overeatingRisk === 'high'
              ? 'high'
              : compliance.overeatingRisk === 'medium'
                ? 'medium'
                : 'low',
        };
      }
    }

    const stored = await prisma.aIInsight.create({
      data: {
        userId: session.user.id,
        insightText: parsed.weeklyHealthSummary || '',
        recommendations: JSON.parse(JSON.stringify({ ...parsed, adaptation: adaptive })),
        weeklyFocus: parsed.weeklyFocus || null,
        fallbackUsed: !getCachedAI<WeeklyInsightPayload>(cacheKey),
        promptVersion: WEEKLY_PROMPT_VERSION,
        modelUsed: hasOpenAIKey() ? getModel() : 'fallback_rules_v1',
        contextHash: cacheKey,
      },
    });

    return NextResponse.json({ summary: stored }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
