import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/api-error';
import { requireApiUserId } from '@/lib/auth/jwt-session';
import { decryptTextForUser } from '@/lib/security/field-crypto';

type WeightLogRow = Awaited<ReturnType<typeof prisma.weightLog.findMany>>[number];
type ActivityLogRow = Awaited<ReturnType<typeof prisma.activityLog.findMany>>[number];
type HabitLogRow = Awaited<ReturnType<typeof prisma.habitLog.findMany>>[number];
type MealLogRow = Awaited<ReturnType<typeof prisma.mealLog.findMany>>[number];
type WellnessScoreRow = Awaited<ReturnType<typeof prisma.wellnessScore.findMany>>[number];
type SummaryWindow = {
  activityMinutes: number;
  avgWellnessScore: number | null;
  wellnessDelta: number | null;
};

function makeSummaryWindow(
  activityRows: ActivityLogRow[],
  scoreRows: WellnessScoreRow[],
  startInclusive: Date,
  endExclusive: Date
): SummaryWindow {
  const activityMinutes = activityRows
    .filter((row) => row.loggedAt >= startInclusive && row.loggedAt < endExclusive)
    .reduce((sum, row) => sum + row.durationMin, 0);
  const scopedScores = scoreRows
    .filter((row) => row.date >= startInclusive && row.date < endExclusive)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const avgWellnessScore = scopedScores.length
    ? Number(
        (
          scopedScores.reduce((sum, row) => sum + row.score, 0) / scopedScores.length
        ).toFixed(2)
      )
    : null;
  const wellnessDelta = scopedScores.length >= 2
    ? Number((scopedScores[scopedScores.length - 1].score - scopedScores[0].score).toFixed(2))
    : null;
  return { activityMinutes, avgWellnessScore, wellnessDelta };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireApiUserId(request);

    const format = request.nextUrl.searchParams.get('format') || 'json';

    const [profile, wellnessScores, weightLogs, activityLogs, habitLogs, mealLogs] = await Promise.all([
      prisma.healthProfile.findUnique({ where: { userId } }),
      prisma.wellnessScore.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
      prisma.weightLog.findMany({ where: { userId }, orderBy: { loggedAt: 'desc' } }),
      prisma.activityLog.findMany({ where: { userId }, orderBy: { loggedAt: 'desc' } }),
      prisma.habitLog.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
      prisma.mealLog.findMany({ where: { userId }, orderBy: { loggedAt: 'desc' } }),
    ]);
    const decryptedProfile = profile
      ? {
          ...(() => {
            const safeProfile = { ...profile };
            delete (safeProfile as { sensitiveSnapshotEnc?: string | null }).sensitiveSnapshotEnc;
            return safeProfile;
          })(),
          occupationType: decryptTextForUser(userId, profile.occupationType),
        }
      : null;
    const decryptedWeightLogs = weightLogs.map((row) => ({
      ...(() => {
        const safeLog = { ...row };
        delete (safeLog as { measurementEnc?: string | null }).measurementEnc;
        return safeLog;
      })(),
      note: decryptTextForUser(userId, row.note),
    }));
    const decryptedActivityLogs = activityLogs.map((row) => ({
      ...(() => {
        const safeLog = { ...row };
        delete (safeLog as { measurementEnc?: string | null }).measurementEnc;
        return safeLog;
      })(),
      notes: decryptTextForUser(userId, row.notes),
    }));
    const decryptedHabitLogs = habitLogs.map((row) => ({
      ...(() => {
        const safeLog = { ...row };
        delete (safeLog as { measurementEnc?: string | null }).measurementEnc;
        return safeLog;
      })(),
      notes: decryptTextForUser(userId, row.notes),
    }));
    const decryptedMealLogs = mealLogs.map((row) => ({
      ...(() => {
        const safeLog = { ...row };
        delete (safeLog as { measurementEnc?: string | null }).measurementEnc;
        return safeLog;
      })(),
      notes: decryptTextForUser(userId, row.notes),
    }));
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now);
    monthStart.setDate(monthStart.getDate() - 30);
    const previousWeekStart = new Date(weekStart);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    const previousMonthStart = new Date(monthStart);
    previousMonthStart.setDate(previousMonthStart.getDate() - 30);

    const weeklySummary = makeSummaryWindow(decryptedActivityLogs, wellnessScores, weekStart, now);
    const monthlySummary = makeSummaryWindow(decryptedActivityLogs, wellnessScores, monthStart, now);
    const previousWeeklySummary = makeSummaryWindow(
      decryptedActivityLogs,
      wellnessScores,
      previousWeekStart,
      weekStart
    );
    const previousMonthlySummary = makeSummaryWindow(
      decryptedActivityLogs,
      wellnessScores,
      previousMonthStart,
      monthStart
    );

    const latestWeight = decryptedWeightLogs[0]?.weightKg ?? null;
    const targetWeight = decryptedProfile?.targetWeightKg ?? null;
    const goalProgress = targetWeight && latestWeight
      ? {
          currentWeightKg: latestWeight,
          targetWeightKg: targetWeight,
          deltaToTargetKg: Number((latestWeight - targetWeight).toFixed(2)),
        }
      : null;

    if (format === 'csv') {
      const csvEscape = (val: string) => `"${val.replace(/"/g, '""')}"`;
      const lines = ['Record Type,Date,Value,Notes'];
      lines.push(
        `Summary,${now.toISOString()},${weeklySummary.activityMinutes},${csvEscape('Weekly activity minutes')}`
      );
      lines.push(
        `Summary,${now.toISOString()},${weeklySummary.avgWellnessScore ?? ''},${csvEscape('Weekly avg wellness score')}`
      );
      lines.push(
        `Summary,${now.toISOString()},${weeklySummary.wellnessDelta ?? ''},${csvEscape('Weekly wellness score delta')}`
      );
      lines.push(
        `Summary,${now.toISOString()},${monthlySummary.activityMinutes},${csvEscape('Monthly activity minutes')}`
      );
      lines.push(
        `Summary,${now.toISOString()},${monthlySummary.avgWellnessScore ?? ''},${csvEscape('Monthly avg wellness score')}`
      );
      lines.push(
        `Summary,${now.toISOString()},${monthlySummary.wellnessDelta ?? ''},${csvEscape('Monthly wellness score delta')}`
      );
      if (goalProgress) {
        lines.push(
          `Summary,${now.toISOString()},${goalProgress.deltaToTargetKg},${csvEscape('Current weight minus target (kg)')}`
        );
      }

      decryptedWeightLogs.forEach((w: WeightLogRow) =>
        lines.push(`Weight,${w.loggedAt.toISOString()},${w.weightKg},${csvEscape(w.note || '')}`)
      );
      decryptedActivityLogs.forEach((a: ActivityLogRow) =>
        lines.push(
          `Activity,${a.loggedAt.toISOString()},${a.durationMin},${csvEscape(`${a.activityType} (minutes)`)}`
        )
      );
      decryptedHabitLogs.forEach((h: HabitLogRow) =>
        lines.push(
          `Habit,${h.date.toISOString()},${h.stressLevel},${csvEscape(`sleep hours: ${h.sleepHours ?? 'n/a'}`)}`
        )
      );
      decryptedMealLogs.forEach((m: MealLogRow) =>
        lines.push(`Meal,${m.loggedAt.toISOString()},${csvEscape(m.mealType)},${csvEscape(m.description || '')}`)
      );
      wellnessScores.forEach((s: WellnessScoreRow) =>
        lines.push(`Wellness Score,${s.date.toISOString()},${s.score},${csvEscape(`BMI: ${s.bmi.toFixed(1)}`)}`)
      );

      return new NextResponse(lines.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="fitnexus-export.csv"',
        },
      });
    }

    const data = {
      exportedAt: new Date().toISOString(),
      profile: decryptedProfile,
      summaries: {
        weekly: weeklySummary,
        previousWeek: previousWeeklySummary,
        monthly: monthlySummary,
        previousMonth: previousMonthlySummary,
        goalProgress,
      },
      wellnessScores,
      weightLogs: decryptedWeightLogs,
      activityLogs: decryptedActivityLogs,
      habitLogs: decryptedHabitLogs,
      mealLogs: decryptedMealLogs,
    };

    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="fitnexus-export.json"',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
