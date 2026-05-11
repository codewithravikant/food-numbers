import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TopActions } from '@/components/home/top-actions';
import { AIInsightCard } from '@/components/home/ai-insight-card';
import { NutritionCard } from '@/components/home/nutrition-card';
// import { StressCheckin } from '@/components/home/stress-checkin';
import { WeeklySnapshot } from '@/components/home/weekly-snapshot';
import { WellnessOrbWidget } from '@/components/home/wellness-orb-widget';
import { GeneratePlanButton } from '@/components/home/generate-plan-button';
import { fallbackInspiration, pickRotatingItems, type InspireItem } from '@/lib/content/wellness-content';
import { ObservationTracker } from '@/components/home/observation-tracker';
import { ObservationHistory } from '@/components/home/observation-history';
import { InspireVideoCard } from '@/components/fuel/inspire-video-card';
import { getYouTubeDurationsByUrl } from '@/lib/youtube-metadata';
import Link from 'next/link';

import { StaggerContainer, FadeUpCard, FadeUp } from '@/components/ui/motion-wrappers';
import {
  DEFAULT_DAILY_TOP_ACTIONS,
  DEFAULT_HOME_INSIGHT_TEXT,
} from '@/lib/daily-top-actions-default';
import { hasOpenAIKey } from '@/lib/ai/openai-client';
import type { DailyPlanFallbackReason } from '@/lib/ai/insight-generator';

const STALE_NO_KEY_INSIGHT_HINT = 'add openrouter_api_key';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Wellness Dashboard - FitNexus' };

async function getHomeData(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [profile, latestScore, previousScore, todayHabit, todayInsight, recentInsight, todayMeals, todayActivity] = await Promise.all([
    prisma.healthProfile.findUnique({ where: { userId } }),
    prisma.wellnessScore.findFirst({ where: { userId }, orderBy: { date: 'desc' } }),
    prisma.wellnessScore.findFirst({ where: { userId, date: { lt: weekAgo } }, orderBy: { date: 'desc' } }),
    prisma.habitLog.findFirst({ where: { userId, date: { gte: today } }, orderBy: { date: 'desc' } }),
    prisma.aIInsight.findFirst({
      where: {
        userId,
        generatedAt: { gte: today },
        modelUsed: { not: 'observation_summary_v1' },
      },
      orderBy: { generatedAt: 'desc' },
    }),
    prisma.aIInsight.findFirst({
      where: {
        userId,
        modelUsed: { not: 'observation_summary_v1' },
      },
      orderBy: { generatedAt: 'desc' },
    }),
    prisma.mealLog.count({
      where: { userId, loggedAt: { gte: today } },
    }),
    prisma.activityLog.aggregate({
      where: { userId, loggedAt: { gte: today } },
      _sum: { durationMin: true },
    }),
  ]);

  return {
    profile,
    latestScore,
    previousScore,
    todayHabit,
    activeInsight: todayInsight ?? recentInsight,
    todayMeals,
    todayActivityMin: todayActivity._sum.durationMin || 0,
  };
}

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const { profile, latestScore, previousScore, todayHabit, activeInsight, todayMeals, todayActivityMin } = await getHomeData(session.user.id);

  // recommendations stores the full AI response: { actions: [...], smartMeal: {...}, ... }
  const recs = activeInsight?.recommendations as Record<string, unknown> | null;
  const actions = Array.isArray(recs?.actions)
    ? (recs.actions as typeof DEFAULT_DAILY_TOP_ACTIONS)
    : DEFAULT_DAILY_TOP_ACTIONS;

  const isStaleNoKeyInsight =
    !!activeInsight?.fallbackUsed &&
    activeInsight.insightText.toLowerCase().includes(STALE_NO_KEY_INSIGHT_HINT) &&
    hasOpenAIKey();

  const insightText = isStaleNoKeyInsight
    ? "Your API key is configured. Regenerate today's plan for a live AI insight."
    : activeInsight?.insightText || DEFAULT_HOME_INSIGHT_TEXT;
  const insightExpanded = typeof recs?.insightExpanded === 'string' ? recs.insightExpanded : undefined;
  const insightPriority =
    recs?.priority === 'high' || recs?.priority === 'medium' || recs?.priority === 'low'
      ? recs.priority
      : 'medium';
  const aiStatus = (() => {
    if (!activeInsight) {
      return { label: 'No plan yet', tone: 'offline' as const };
    }
    if (!activeInsight.fallbackUsed) {
      return { label: 'Live AI', tone: 'live' as const };
    }
    if (activeInsight.modelUsed === 'cached_response_v1') {
      return { label: 'Cached AI', tone: 'cached' as const };
    }

    const fb = recs?.fallbackReason as DailyPlanFallbackReason | undefined;
    if (fb === 'no_model') {
      return { label: 'Model missing', tone: 'warning' as const };
    }
    if (fb === 'auth_error') {
      return { label: 'Key rejected', tone: 'warning' as const };
    }
    if (fb === 'rate_limit') {
      return { label: 'Provider rate limit', tone: 'warning' as const };
    }
    if (fb === 'network') {
      return { label: 'Provider unreachable', tone: 'offline' as const };
    }
    if (fb === 'parse_error') {
      return { label: 'AI parse error', tone: 'warning' as const };
    }
    if (fb === 'guardrail') {
      return { label: 'Safety guard', tone: 'warning' as const };
    }
    if (fb === 'invalid_model') {
      return { label: 'Model mismatch', tone: 'warning' as const };
    }
    if (fb === 'truncated') {
      return { label: 'Provider truncated', tone: 'warning' as const };
    }
    if (fb === 'privacy') {
      return { label: 'AI off (privacy)', tone: 'offline' as const };
    }

    const lowerText = activeInsight.insightText.toLowerCase();
    if (lowerText.includes('model is not configured') || lowerText.includes('openrouter_model or openai_model')) {
      return { label: 'Model missing', tone: 'warning' as const };
    }
    if (lowerText.includes('not compatible')) {
      return { label: 'Model mismatch', tone: 'warning' as const };
    }
    if (lowerText.includes('truncated')) {
      return { label: 'Provider truncated', tone: 'warning' as const };
    }
    if (lowerText.includes('privacy settings')) {
      return { label: 'AI off (privacy)', tone: 'offline' as const };
    }
    if (lowerText.includes('rejected the api key') || lowerText.includes('unauthorized')) {
      return { label: 'Key rejected', tone: 'warning' as const };
    }
    if (lowerText.includes('rate-limited') || lowerText.includes('quota')) {
      return { label: 'Provider rate limit', tone: 'warning' as const };
    }
    if (lowerText.includes('could not reach the ai provider')) {
      return { label: 'Provider unreachable', tone: 'offline' as const };
    }
    if (lowerText.includes('could not parse as json')) {
      return { label: 'AI parse error', tone: 'warning' as const };
    }
    if (lowerText.includes('safety validation')) {
      return { label: 'Safety guard', tone: 'warning' as const };
    }
    if (lowerText.includes(STALE_NO_KEY_INSIGHT_HINT)) {
      if (hasOpenAIKey()) {
        return { label: 'Stale plan — regenerate', tone: 'warning' as const };
      }
      return { label: 'API key missing', tone: 'offline' as const };
    }
    return { label: 'Offline fallback', tone: 'offline' as const };
  })();

  // Extract smart meal from AI response
  const aiSmartMeal = recs?.smartMeal as typeof defaultMeal | undefined;

  // Calculate completion rate from actions
  const completionRate = actions.length > 0
    ? Math.round((actions.filter((a) => a.completed).length / actions.length) * 100)
    : 0;

  const currentScore = latestScore?.score || 50;
  const previousScoreVal = previousScore?.score || currentScore;
  const scoreDelta = currentScore - previousScoreVal;

  const defaultMeal = {
    name: 'Mediterranean Quinoa Bowl',
    description: 'A balanced bowl with quinoa, roasted vegetables, chickpeas, and tahini dressing',
    prepTime: '25 min',
    ingredients: ['Quinoa', 'Cherry tomatoes', 'Cucumber', 'Chickpeas', 'Feta', 'Tahini'],
    macroHighlights: '35g protein, 45g carbs',
    dietaryTags: [profile?.dietaryPreference?.replace('_', ' ') || 'Balanced'],
  };

  const smartMeal = aiSmartMeal || defaultMeal;
  const inspireSeed = Number(new Date().toISOString().slice(0, 10).replaceAll('-', ''));
  const inspireItems = pickRotatingItems(fallbackInspiration, inspireSeed, 2);
  const inspireDurations = await getYouTubeDurationsByUrl(
    inspireItems.map((item: InspireItem) => item.link)
  );
  const enrichedInspireItems = inspireItems.map((item: InspireItem) => ({
    ...item,
    duration: inspireDurations[item.link] || item.duration,
  }));

  return (
    <div className="space-y-8 pb-12">
      <div className="pt-4">
        <h1 className="text-3xl font-bold font-heading tracking-tight gradient-heading drop-shadow-sm">Wellness Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm font-medium">Your daily wellness briefing</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <StaggerContainer className="space-y-6">
          <FadeUpCard>
            <TopActions actions={actions} planId={activeInsight?.id || 'default'} />
          </FadeUpCard>

          <FadeUp>
            <AIInsightCard
              insightText={insightText}
              insightExpanded={insightExpanded}
              priority={insightPriority}
              fallbackUsed={activeInsight?.fallbackUsed ?? true}
              statusLabel={aiStatus.label}
              statusTone={aiStatus.tone}
            />
          </FadeUp>

          {profile && (
            <FadeUpCard className="p-0 border-none blur-none bg-transparent shadow-none">
              <GeneratePlanButton hasExistingPlan={!!activeInsight} />
            </FadeUpCard>
          )}

          <FadeUpCard>
            <NutritionCard
              smartMeal={smartMeal}
              dietaryPreference={profile?.dietaryPreference || 'BALANCED'}
              source={{
                fallbackUsed: activeInsight?.fallbackUsed ?? true,
                modelUsed: activeInsight?.modelUsed ?? null,
              }}
            />
          </FadeUpCard>
        </StaggerContainer>

        <StaggerContainer className="space-y-6">
          <FadeUpCard className="overflow-hidden shadow-glow">
            <WellnessOrbWidget score={currentScore} />
          </FadeUpCard>

          <FadeUpCard>
            <WeeklySnapshot completionRate={completionRate} scoreDelta={scoreDelta} currentScore={currentScore} />
          </FadeUpCard>

          {/* <FadeUpCard>
            <StressCheckin currentStress={todayHabit?.stressLevel} preserveMode={todayHabit?.isRecoveryDay ?? false} />
          </FadeUpCard> */}

          <FadeUpCard>
            <div className="space-y-3">
              <h3 className="text-sm text-primary font-semibold tracking-wide uppercase font-heading">Inspire Me</h3>
              <p className="text-xs text-muted-foreground">
                Quick mindset and movement clips aligned with your day.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {enrichedInspireItems.map((item) => (
                  <InspireVideoCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          </FadeUpCard>

          <FadeUpCard>
            <div className="space-y-3">
              <h3 className="text-sm text-green-400 font-semibold tracking-wide uppercase font-heading">Inspire Me - Food</h3>
              <p className="text-xs text-muted-foreground">
                Light, food-focused inspiration from your intake lane.
              </p>
              <div className="space-y-2">
                {[
                  {
                    name: 'Green Moong & Cucumber Chaat',
                    description: 'Refreshing Indian-style salad with moong sprouts, cucumber, herbs, and lemon.',
                  },
                  {
                    name: 'Palak Apple Peanut Salad',
                    description: 'Crunchy spinach salad with apple, roasted peanuts, and citrus dressing.',
                  },
                  {
                    name: 'Vegan Millet Stuffed Bell Peppers',
                    description: 'Baked bell peppers filled with seasoned millet, peas, and herbs.',
                  },
                ].map((dish) => (
                  <Link
                    key={dish.name}
                    href={`/fuel/recipes?focus=${encodeURIComponent(dish.name)}`}
                    className="block rounded-lg border border-green-400/30 bg-green-400/10 p-3 hover:border-green-400/50 transition-colors"
                  >
                    <p className="text-xs font-semibold text-green-300">{dish.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{dish.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          </FadeUpCard>

          <FadeUpCard>
            <ObservationTracker
              userId={session.user.id}
              defaultFoodEntries={todayMeals}
              defaultActivityMinutes={todayActivityMin}
              defaultSleepHours={todayHabit?.sleepHours ?? 7}
              defaultStressLevel={todayHabit?.stressLevel ?? 3}
              defaultWaterLiters={todayHabit?.hydrationLiters ?? 1.5}
            />
          </FadeUpCard>

          <FadeUpCard>
            <ObservationHistory />
          </FadeUpCard>
        </StaggerContainer>
      </div>
    </div>
  );
}
