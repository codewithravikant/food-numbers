import { prisma } from '@/lib/prisma';

type MealEntry = {
  mealType: string;
  description: string | null;
  loggedAt: Date;
};

function extractNutritionFromDescription(description: string | null): {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
} | null {
  if (!description) return null;
  try {
    const parsed = JSON.parse(description) as Record<string, unknown>;
    if (typeof parsed.estimatedCalories !== 'number') return null;
    return {
      calories: parsed.estimatedCalories,
      proteinG: typeof parsed.estimatedProteinG === 'number' ? parsed.estimatedProteinG : 0,
      carbsG: typeof parsed.estimatedCarbsG === 'number' ? parsed.estimatedCarbsG : 0,
      fatsG: typeof parsed.estimatedFatsG === 'number' ? parsed.estimatedFatsG : 0,
    };
  } catch {
    return null;
  }
}

export async function computeMealCompliance(userId: string, days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [plan, logs] = await Promise.all([
    prisma.mealPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    }),
    prisma.mealLog.findMany({
      where: { userId, loggedAt: { gte: since } },
      orderBy: { loggedAt: 'desc' },
    }),
  ]);

  const plannedSlots = plan?.items.length ?? 0;
  const loggedMeals = logs.length;
  const slotCompliance = plannedSlots > 0 ? Math.min(1, loggedMeals / plannedSlots) : 0;

  const logTotals = (logs as MealEntry[])
    .map((l) => extractNutritionFromDescription(l.description))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .reduce(
      (acc, n) => ({
        calories: acc.calories + n.calories,
        proteinG: acc.proteinG + n.proteinG,
        carbsG: acc.carbsG + n.carbsG,
        fatsG: acc.fatsG + n.fatsG,
      }),
      { calories: 0, proteinG: 0, carbsG: 0, fatsG: 0 }
    );

  const targetCalories = plan?.calorieTarget ?? 0;
  const dailyAvgCalories = days > 0 ? logTotals.calories / days : logTotals.calories;
  const overeatingRatio = targetCalories > 0 ? dailyAvgCalories / targetCalories : 0;
  const overeatingRisk =
    overeatingRatio >= 1.2 ? 'high' : overeatingRatio >= 1.05 ? 'medium' : 'low';

  return {
    slotCompliance,
    plannedSlots,
    loggedMeals,
    targetCalories,
    dailyAvgCalories,
    overeatingRatio,
    overeatingRisk,
    macroTotals: logTotals,
  };
}
