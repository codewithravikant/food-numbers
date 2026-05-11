import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogWeightDialog } from '@/components/blueprint/log-weight-dialog';
import { WeightTrend } from '@/components/charts/weight-trend';
import { StaggerContainer, FadeUpCard } from '@/components/ui/motion-wrappers';
import { calculateBMI } from '@/lib/calculations';
import { recalculateAndStoreWellnessScore } from '@/lib/wellness-score';
import { WellnessBodyVisualizer } from '@/components/blueprint/wellness-body-visualizer';
import { ExerciseBlueprintPanel } from '@/components/blueprint/exercise-blueprint-panel';
import { loadExerciseDataset } from '@/lib/exercises/load-exercises';
import { WellnessScoreTrend } from '@/components/charts/wellness-score-trend';
import { ComparisonChart } from '@/components/charts/comparison-chart';
import { ActivityHeatmap } from '@/components/charts/activity-heatmap';

/** Row shapes for callbacks — avoids implicit any when the Prisma proxy does not infer in the IDE. */
type BlueprintActivityLog = { loggedAt: Date; durationMin: number };
type BlueprintHabitLog = {
  hydrationLiters: number | null;
  stressLevel: number | null;
  moodLevel: number | null;
  sleepQuality: number | null;
};
type BlueprintWellnessScore = {
  id: string;
  date: Date;
  score: number;
  habitsScore: number;
  activityScore: number;
  progressScore: number;
  bmiScore: number;
  bmi: number | null;
  bmiCategory: string | null;
  weightKg: number | null;
};

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Blueprint - FitNexus' };

export default async function BlueprintPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const userId = session.user.id;

  const [profile, scoresRaw, weightLogs, habitLogsRaw, activityLogsRaw, mealLogs, latestInsight] = await Promise.all([
    prisma.healthProfile.findUnique({ where: { userId } }),
    prisma.wellnessScore.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 30 }),
    prisma.weightLog.findMany({ where: { userId }, orderBy: { loggedAt: 'desc' }, take: 30 }),
    prisma.habitLog.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 7 }),
    prisma.activityLog.findMany({ where: { userId }, orderBy: { loggedAt: 'desc' }, take: 45 }),
    prisma.mealLog.findMany({ where: { userId }, orderBy: { loggedAt: 'desc' }, take: 21 }),
    prisma.aIInsight.findFirst({
      where: { userId, modelUsed: { not: 'observation_summary_v1' } },
      orderBy: { generatedAt: 'desc' },
    }),
  ]);

  const scores = scoresRaw as BlueprintWellnessScore[];
  const habitLogs = habitLogsRaw as BlueprintHabitLog[];
  const activityLogs = activityLogsRaw as BlueprintActivityLog[];

  let latestScore: BlueprintWellnessScore | undefined = scores[0];
  if (profile) {
    const expectedBmi = calculateBMI(profile.heightCm, profile.weightKg);
    const staleScore =
      !latestScore
      || Math.abs((latestScore.bmi ?? 0) - expectedBmi) > 0.5
      || Math.abs((latestScore.weightKg ?? profile.weightKg) - profile.weightKg) > 0.01;

    if (staleScore) {
      latestScore = (await recalculateAndStoreWellnessScore(userId)) as BlueprintWellnessScore;
    }
  }
  const bmi = latestScore?.bmi;
  const bmiCategory = latestScore?.bmiCategory;

  // Calculate granular scores for the body visualizer
  type HabitMetricKey = keyof Pick<
    BlueprintHabitLog,
    'hydrationLiters' | 'stressLevel' | 'moodLevel' | 'sleepQuality'
  >;
  const avgHabit = (field: HabitMetricKey, max: number = 5) => {
    if (habitLogs.length === 0) return 50;
    const sum = habitLogs.reduce((acc, h) => acc + (Number(h[field]) || 0), 0);
    return Math.min(100, Math.max(0, (sum / (habitLogs.length * max)) * 100));
  };

  const exerciseMinutes = activityLogs.reduce((acc, a) => acc + a.durationMin, 0);
  const exerciseScore = Math.min(100, (exerciseMinutes / (7 * 30)) * 100); // 30 mins/day goal
  const waterScore = avgHabit('hydrationLiters', 2.5);
  const foodScore = Math.min(100, (mealLogs.length / 21) * 100); // 3 meals/day goal
  const stressScore = 100 - avgHabit('stressLevel', 5);
  const relaxationScore = avgHabit('moodLevel', 5);
  const sleepScore = avgHabit('sleepQuality', 5);

  const normalizeScore = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(100, Math.max(0, value));
  };

  const visualizerScores = {
    exercise: normalizeScore(exerciseScore, 45),
    water: normalizeScore(waterScore, 60),
    food: normalizeScore(foodScore, 70),
    stress: normalizeScore(stressScore, 40),
    relaxation: normalizeScore(relaxationScore, 55),
    sleep: normalizeScore(sleepScore, 65),
  };

  const exerciseDataset = loadExerciseDataset();
  const now = new Date();
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const oneMonthAgo = new Date(now);
  oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
  const twoMonthsAgo = new Date(now);
  twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60);

  const logsCurrentWeek = activityLogs.filter((row) => row.loggedAt >= oneWeekAgo);
  const logsPrevWeek = activityLogs.filter(
    (row) => row.loggedAt < oneWeekAgo && row.loggedAt >= twoWeeksAgo
  );
  const logsCurrentMonth = activityLogs.filter((row) => row.loggedAt >= oneMonthAgo);
  const logsPrevMonth = activityLogs.filter(
    (row) => row.loggedAt < oneMonthAgo && row.loggedAt >= twoMonthsAgo
  );

  const activityCurrentWeek = logsCurrentWeek.reduce((sum, row) => sum + row.durationMin, 0);
  const activityPreviousWeek = logsPrevWeek.reduce((sum, row) => sum + row.durationMin, 0);
  const activityCurrentMonth = logsCurrentMonth.reduce((sum, row) => sum + row.durationMin, 0);
  const activityPreviousMonth = logsPrevMonth.reduce((sum, row) => sum + row.durationMin, 0);

  const scoresCurrentWeekRows = scores.filter((row) => row.date >= oneWeekAgo);
  const scoresPrevWeekRows = scores.filter(
    (row) => row.date < oneWeekAgo && row.date >= twoWeeksAgo
  );
  const scoresCurrentMonthRows = scores.filter((row) => row.date >= oneMonthAgo);
  const scoresPrevMonthRows = scores.filter(
    (row) => row.date < oneMonthAgo && row.date >= twoMonthsAgo
  );

  const avgScore = (rows: typeof scores) =>
    rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
  const scoreCurrentWeek = avgScore(scoresCurrentWeekRows);
  const scorePreviousWeek = avgScore(scoresPrevWeekRows);
  const scoreCurrentMonth = avgScore(scoresCurrentMonthRows);
  const scorePreviousMonth = avgScore(scoresPrevMonthRows);

  const hasActivity7dCompare = logsCurrentWeek.length > 0 && logsPrevWeek.length > 0;
  const hasActivity30dCompare = logsCurrentMonth.length > 0 && logsPrevMonth.length > 0;
  const hasScore7dCompare = scoresCurrentWeekRows.length > 0 && scoresPrevWeekRows.length > 0;
  const hasScore30dCompare = scoresCurrentMonthRows.length > 0 && scoresPrevMonthRows.length > 0;

  const comparisonData: Array<{ label: string; current: number; previous: number }> = [];
  if (hasActivity7dCompare) {
    comparisonData.push({ label: 'Activity 7d', current: activityCurrentWeek, previous: activityPreviousWeek });
  }
  if (hasActivity30dCompare) {
    comparisonData.push({
      label: 'Activity 30d',
      current: activityCurrentMonth,
      previous: activityPreviousMonth,
    });
  }
  if (hasScore7dCompare) {
    comparisonData.push({
      label: 'Score 7d',
      current: Math.round(scoreCurrentWeek),
      previous: Math.round(scorePreviousWeek),
    });
  }
  if (hasScore30dCompare) {
    comparisonData.push({
      label: 'Score 30d',
      current: Math.round(scoreCurrentMonth),
      previous: Math.round(scorePreviousMonth),
    });
  }

  const scoreTrendRows = [...scores];
  if (latestScore && !scoreTrendRows.some((row) => row.id === latestScore.id)) {
    scoreTrendRows.unshift(latestScore);
  }

  const activityByDate = new Map<string, number>();
  for (let i = 0; i < 35; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    activityByDate.set(d.toISOString().slice(0, 10), 0);
  }
  for (const row of activityLogs) {
    const key = row.loggedAt.toISOString().slice(0, 10);
    if (activityByDate.has(key)) {
      activityByDate.set(key, (activityByDate.get(key) || 0) + row.durationMin);
    }
  }
  const heatmapData = Array.from(activityByDate.entries())
    .map(([date, minutes]) => ({ date, minutes }))
    .reverse();
  const insightPriority =
    ((latestInsight?.recommendations as Record<string, unknown> | null)?.priority as
      | 'high'
      | 'medium'
      | 'low'
      | undefined) ?? 'medium';

  return (
    <div className="space-y-8 pb-12">
      <div className="pt-4">
        <h1 className="text-3xl font-bold tracking-tight gradient-heading drop-shadow-sm">Blueprint</h1>
        <p className="text-muted-foreground mt-1 text-sm font-medium">Your progress dashboard</p>
      </div>

      <FadeUpCard className="p-0 border-none bg-transparent shadow-none">
        <Card className="overflow-hidden bg-black/20 border-white/5 backdrop-blur-xl">
          <CardHeader className="pb-0">
            <CardTitle className="text-lg text-emerald-400">Vitality Overview</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <WellnessBodyVisualizer scores={visualizerScores} />
          </CardContent>
        </Card>
      </FadeUpCard>

      <StaggerContainer className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <FadeUpCard className="lg:col-span-2 p-0 bg-transparent border-none shadow-none h-full">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-emerald-400">Wellness Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col lg:flex-row items-center gap-6">
                <div className="relative w-32 h-32 flex items-center justify-center shrink-0">
                  <svg className="absolute inset-0" viewBox="0 0 128 128">
                    <circle cx="64" cy="64" r="54" fill="none" stroke="currentColor" strokeWidth="8" className="text-emerald-900/40" />
                    <circle cx="64" cy="64" r="54" fill="none" stroke="currentColor" strokeWidth="8"
                      strokeDasharray={`${((latestScore?.score || 50) / 100) * 339} 339`}
                      strokeLinecap="round" className="text-emerald-500 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]" transform="rotate(-90 64 64)" />
                  </svg>
                  <span className="text-3xl font-bold text-glow">{Math.round(latestScore?.score || 50)}</span>
                </div>
                {latestScore && (
                  <div className="grid grid-cols-4 gap-4 flex-1 w-full">
                    <div className="rounded-lg bg-black/40 border border-emerald-500/10 p-3 text-center shadow-inner">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Habits</p>
                      <p className="font-bold text-xl text-emerald-50 mt-1">{Math.round(latestScore.habitsScore)}</p>
                    </div>
                    <div className="rounded-lg bg-black/40 border border-emerald-500/10 p-3 text-center shadow-inner">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Activity</p>
                      <p className="font-bold text-xl text-emerald-50 mt-1">{Math.round(latestScore.activityScore)}</p>
                    </div>
                    <div className="rounded-lg bg-black/40 border border-emerald-500/10 p-3 text-center shadow-inner">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Progress</p>
                      <p className="font-bold text-xl text-emerald-50 mt-1">{Math.round(latestScore.progressScore)}</p>
                    </div>
                    <div className="rounded-lg bg-black/40 border border-emerald-500/10 p-3 text-center shadow-inner">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">BMI</p>
                      <p className="font-bold text-xl text-emerald-50 mt-1">{Math.round(latestScore.bmiScore)}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </FadeUpCard>

        <FadeUpCard className="h-full p-0 bg-transparent border-none shadow-none">
          <Card className="h-full flex flex-col justify-between relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <CardHeader className="pb-2 relative z-10">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-emerald-400">Weight</CardTitle>
                <LogWeightDialog currentWeight={profile?.weightKg} />
              </div>
            </CardHeader>
            <CardContent className="relative z-10">
              <p className="text-4xl font-bold text-glow">{profile?.weightKg?.toFixed(1)} <span className="text-lg font-normal text-muted-foreground">kg</span></p>
              {weightLogs.length > 1 && (
                <p className="text-sm text-emerald-500/70 mt-4">
                  {weightLogs.length} entries carefully tracked
                </p>
              )}
            </CardContent>
          </Card>
        </FadeUpCard>
      </StaggerContainer>

      {/* Weight Trend Chart */}
      {weightLogs.length > 0 && (
        <FadeUpCard className="p-0 border-none bg-transparent shadow-none">
          <WeightTrend
            data={weightLogs.map((w: { loggedAt: Date; weightKg: number }) => ({
              date: w.loggedAt.toISOString(),
              weight: w.weightKg,
            }))}
            targetWeight={profile?.targetWeightKg ?? undefined}
          />
        </FadeUpCard>
      )}

      <StaggerContainer className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <FadeUpCard className="xl:col-span-2 p-0 border-none bg-transparent shadow-none">
          <WellnessScoreTrend
            data={scoreTrendRows.map((score) => ({
              date: score.date.toISOString(),
              score: score.score,
            }))}
          />
        </FadeUpCard>
        <FadeUpCard className="p-0 border-none bg-transparent shadow-none">
          <ActivityHeatmap data={heatmapData} />
        </FadeUpCard>
      </StaggerContainer>

      <FadeUpCard className="p-0 border-none bg-transparent shadow-none">
        <ComparisonChart data={comparisonData} title="Current vs Previous (Week/Month)" />
      </FadeUpCard>

      {latestInsight && (
        <FadeUpCard className="p-0 border-none bg-transparent shadow-none">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-emerald-400">AI Recommendation Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
                Priority: {insightPriority}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{latestInsight.insightText}</p>
            </CardContent>
          </Card>
        </FadeUpCard>
      )}

      {bmi && (
        <StaggerContainer className="grid grid-cols-1 gap-8">
          <FadeUpCard className="p-0 bg-transparent border-none shadow-none h-full">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-emerald-400">Body Mass Index</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-6 mt-2">
                  <div>
                    <p className="text-4xl font-bold text-glow">{bmi.toFixed(1)}</p>
                    <p className="text-sm text-emerald-400/80 uppercase tracking-wide mt-1">{bmiCategory}</p>
                  </div>
                  <div className="h-2 flex-1 rounded-full bg-gradient-to-r from-emerald-400 via-yellow-400 to-red-400 relative overflow-hidden">
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-4 h-5 rounded-md bg-white border-2 border-background shadow-[0_0_10px_rgba(255,255,255,0.5)] transition-all duration-1000 ease-out"
                      style={{ left: `${Math.min(100, Math.max(0, ((bmi - 15) / 25) * 100))}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </FadeUpCard>
        </StaggerContainer>
      )}

      <FadeUpCard className="p-0 border-none bg-transparent shadow-none">
        <ExerciseBlueprintPanel exercises={exerciseDataset.exercises} />
      </FadeUpCard>
    </div>
  );
}
