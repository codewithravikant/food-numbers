import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NutritionOverview } from '@/components/fuel/nutrition-overview';
import { MealLogRecap } from '@/components/fuel/meal-log-recap';
import { NutritionCard } from '@/components/home/nutrition-card';
import { LogMealDialog } from '@/components/fuel/log-meal-dialog';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ChefHat, Leaf } from 'lucide-react';
import { StaggerContainer, FadeUpCard } from '@/components/ui/motion-wrappers';
import { fallbackRecipes } from '@/lib/content/wellness-content';
import { deriveMacroTargets } from '@/lib/nutrition/tdee';
import { MacroPieChart } from '@/components/fuel/macro-pie-chart';
import { CalorieBalanceChart } from '@/components/fuel/calorie-balance-chart';
import { MealPlanPanel } from '@/components/fuel/meal-plan-panel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { isRecipeSafe, matchesPreference } from '@/lib/nutrition/recipe-filter';
import { AiSourceBadge } from '@/components/ui/ai-source-badge';
import { decryptJsonForUser } from '@/lib/security/field-crypto';
import { allBannedIngredientTokens } from '@/lib/dietary';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Intake - FitNexus' };

type MealMeasurement = {
  matchType?: 'planned' | 'outside' | null;
  matchedPlannedMealKey?: {
    dayIndex: number;
    slot: string;
    title: string;
  } | null;
};

export default async function FuelPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [profile, meals, recentInsight, latestMealPlan] = await Promise.all([
    prisma.healthProfile.findUnique({ where: { userId: session.user.id } }),
    prisma.mealLog.findMany({
      where: { userId: session.user.id },
      orderBy: { loggedAt: 'desc' },
      take: 7,
    }),
    prisma.aIInsight.findFirst({
      where: {
        userId: session.user.id,
        modelUsed: { not: 'observation_summary_v1' },
      },
      orderBy: { generatedAt: 'desc' },
      select: { recommendations: true, fallbackUsed: true, modelUsed: true },
    }),
    prisma.mealPlan.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    }),
  ]);

  const dietPref = profile?.dietaryPreference || 'BALANCED';
  const dietRestrictions = profile?.dietaryRestrictions ?? [];

  const macroTargets =
    profile != null
      ? deriveMacroTargets(
          profile.weightKg,
          profile.heightCm,
          profile.age,
          profile.gender,
          profile.weeklyActivityFrequency,
          profile.primaryGoal,
          profile.targetDirection
        )
      : null;

  const mealCaloriesByDay = meals.reduce<Record<string, number>>((acc, meal) => {
    const key = meal.loggedAt.toISOString().slice(0, 10);
    let calories = 0;
    try {
      const parsed = meal.description ? (JSON.parse(meal.description) as Record<string, unknown>) : null;
      calories = typeof parsed?.estimatedCalories === 'number' ? parsed.estimatedCalories : 0;
    } catch {
      calories = 0;
    }
    acc[key] = (acc[key] || 0) + calories;
    return acc;
  }, {});

  const calorieChartDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    return {
      date: key,
      target: macroTargets?.calorieTarget ?? 2000,
      loggedEstimate: mealCaloriesByDay[key],
    };
  });

  // Extract smart meal from the latest AI-generated daily plan
  const recs = recentInsight?.recommendations as Record<string, unknown> | null;
  const aiSmartMeal = recs?.smartMeal as {
    name: string; description: string; prepTime: string;
    ingredients: string[]; macroHighlights?: string; dietaryTags: string[];
  } | undefined;

  const smartMealCandidate = aiSmartMeal || {
    name: 'Mediterranean Quinoa Bowl',
    description: 'A balanced bowl with quinoa, roasted vegetables, chickpeas, and tahini dressing',
    prepTime: '25 min',
    ingredients: ['Quinoa', 'Cherry tomatoes', 'Cucumber', 'Chickpeas', 'Feta', 'Tahini'],
    macroHighlights: '35g protein, 45g carbs',
    dietaryTags: [dietPref.replace('_', ' ')],
  };
  const restrictedTokens = allBannedIngredientTokens(dietRestrictions);
  const smartMealContent = [
    smartMealCandidate.name,
    smartMealCandidate.description,
    ...smartMealCandidate.ingredients,
    ...smartMealCandidate.dietaryTags,
  ]
    .join(' ')
    .toLowerCase();
  const smartMealConflictsRestriction = restrictedTokens.some((token) =>
    smartMealContent.includes(token.toLowerCase())
  );
  const smartMeal = smartMealConflictsRestriction
    ? {
        name: 'Safe Balanced Plate',
        description: 'A simple, restriction-aware plate with lean protein, vegetables, and whole grains.',
        prepTime: '20 min',
        ingredients: ['Lean protein', 'Seasonal vegetables', 'Whole grain or legume side'],
        macroHighlights: 'Balanced energy + protein support',
        dietaryTags: [dietPref.replace('_', ' '), 'Restriction-aware'],
      }
    : smartMealCandidate;
  const safeFallbackRecipes = fallbackRecipes.filter((recipe) => isRecipeSafe(recipe, dietRestrictions));
  const strictInspiration = safeFallbackRecipes.filter((recipe) => matchesPreference(recipe, dietPref));
  const relaxedInspiration = strictInspiration.length > 0 ? strictInspiration : safeFallbackRecipes;
  const foodInspiration = relaxedInspiration.slice(0, 3);
  const inspireRelaxed = strictInspiration.length === 0 && safeFallbackRecipes.length > 0;
  const mealsWithTags = meals.map((meal) => {
    const measurement = decryptJsonForUser<MealMeasurement>(session.user.id, meal.measurementEnc);
    return {
      ...meal,
      mealMatchType: measurement?.matchType ?? null,
      matchedPlannedMealKey: measurement?.matchedPlannedMealKey ?? null,
    };
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight gradient-heading drop-shadow-sm">Intake</h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">Nutrition overview &amp; recipes</p>
        </div>
        <div className="flex items-center gap-2">
          <LogMealDialog />
          <Link href="/fuel/recipes">
            <Button variant="outline" className="gap-2 glass-panel border-primary/20 hover:border-primary/40 hover:bg-primary/10 transition-all">
              <ChefHat className="h-4 w-4 text-primary" /> Recipes
            </Button>
          </Link>
        </div>
      </div>

      <StaggerContainer className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          <FadeUpCard className="p-0 bg-transparent border-none shadow-none">
            <NutritionOverview dietaryPreference={dietPref} dietaryRestrictions={dietRestrictions} />
          </FadeUpCard>
          {macroTargets ? (
            <FadeUpCard>
              <Card className="border-primary/15">
                <CardHeader>
                  <CardTitle className="text-base">Macro targets (TDEE-based)</CardTitle>
                  <CardDescription>Daily distribution from your profile and activity</CardDescription>
                </CardHeader>
                <CardContent>
                  <MacroPieChart
                    proteinG={macroTargets.proteinG}
                    carbsG={macroTargets.carbsG}
                    fatsG={macroTargets.fatsG}
                  />
                  <p className="mt-3 text-center text-sm font-medium tabular-nums leading-relaxed text-foreground/90">
                    ~{Math.round(macroTargets.calorieTarget)} kcal / day
                  </p>
                </CardContent>
              </Card>
            </FadeUpCard>
          ) : null}
          <FadeUpCard>
            <Card className="border-primary/15">
              <CardHeader>
                <CardTitle className="text-base">Calorie balance (7 days)</CardTitle>
                <CardDescription>Target line vs balance when meal kcal are tracked</CardDescription>
              </CardHeader>
              <CardContent>
                <CalorieBalanceChart days={calorieChartDays} />
              </CardContent>
            </Card>
          </FadeUpCard>
          <FadeUpCard>
            <MealPlanPanel
              initialPlan={
                latestMealPlan
                  ? {
                      planJson: latestMealPlan.planJson,
                      fallbackUsed: latestMealPlan.fallbackUsed,
                      createdAt: latestMealPlan.createdAt.toISOString(),
                      modelUsed: latestMealPlan.modelUsed,
                      items: latestMealPlan.items.map((it) => ({
                        dayIndex: it.dayIndex,
                        slot: it.slot,
                        title: it.title,
                        calories: it.calories,
                        proteinG: it.proteinG,
                        carbsG: it.carbsG,
                        fatsG: it.fatsG,
                      })),
                    }
                  : null
              }
            />
          </FadeUpCard>
          <FadeUpCard>
            <NutritionCard
              smartMeal={smartMeal}
              dietaryPreference={dietPref}
              source={{
                fallbackUsed: recentInsight?.fallbackUsed ?? true,
                modelUsed: recentInsight?.modelUsed ?? null,
              }}
            />
          </FadeUpCard>
        </div>
        <div className="space-y-5">
          <FadeUpCard className="p-0 bg-transparent border-none shadow-none">
            <MealLogRecap
              meals={mealsWithTags.map((m) => ({
                id: m.id,
                mealType: m.mealType,
                description: m.description ?? undefined,
                loggedAt: m.loggedAt.toISOString(),
                mealMatchType: m.mealMatchType,
                matchedPlannedMealKey: m.matchedPlannedMealKey,
              }))}
              plannedMeals={
                Array.isArray((latestMealPlan?.planJson as { meals?: Array<Record<string, unknown>> } | null)?.meals)
                  ? (((latestMealPlan?.planJson as { meals?: Array<Record<string, unknown>> }).meals || [])
                      .filter((meal) => meal.planned === true)
                      .map((meal) => ({
                        dayIndex: Number(meal.dayIndex || 0),
                        slot: String(meal.slot || 'SNACK').toUpperCase(),
                        title: String(meal.title || 'Planned meal'),
                      })))
                  : []
              }
            />
          </FadeUpCard>
          <FadeUpCard>
            <Card className="border-primary/15">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-green-400 font-semibold tracking-wide uppercase font-heading">
                  Inspire Me - Food
                </CardTitle>
                <CardDescription>
                  Light, food-focused inspiration from your intake lane.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {foodInspiration.length > 0 ? (
                  <>
                    {inspireRelaxed ? (
                      <p className="text-[11px] text-muted-foreground">
                        No strict diet-style match found; showing safe options that still respect your restrictions.
                      </p>
                    ) : null}
                    {foodInspiration.map((item) => (
                      <Link
                        key={item.id}
                        href={`/fuel/recipes?focus=${encodeURIComponent(item.name)}`}
                        className="block rounded-lg border border-green-400/30 bg-green-400/10 p-3 transition-colors hover:border-green-300/50 hover:bg-green-400/15"
                      >
                        <p className="text-xs font-semibold text-green-300 inline-flex items-center gap-1 leading-snug">
                          <Leaf className="h-3 w-3 shrink-0" />
                          <span className="line-clamp-1">{item.name}</span>
                        </p>
                        <AiSourceBadge fallbackUsed className="mt-1" />
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                          {item.description}
                        </p>
                      </Link>
                    ))}
                  </>
                ) : (
                  <p className="rounded-lg border border-dashed border-green-400/30 bg-green-500/5 p-3 text-[11px] text-muted-foreground">
                    No safe inspiration found for your current restrictions. Update your profile restrictions to widen options.
                  </p>
                )}
              </CardContent>
            </Card>
          </FadeUpCard>
        </div>
      </StaggerContainer>
    </div>
  );
}
