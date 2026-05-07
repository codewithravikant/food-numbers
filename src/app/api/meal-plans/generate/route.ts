import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { generateMealPlanForUser } from '@/lib/ai/meal-plan-pipeline';
import { handleApiError, ApiError } from '@/lib/api-error';
import { rateLimitStrict } from '@/lib/rate-limit';
import { mealPlanRequestSchema } from '@/lib/validations/meal-plan';
import { prisma } from '@/lib/prisma';
import { syncShoppingListFromMealPlan } from '@/lib/shopping-list';
import { allBannedIngredientTokens } from '@/lib/dietary';

function textContainsBannedToken(text: string, bannedTokens: string[]): boolean {
  if (!text.trim() || bannedTokens.length === 0) return false;
  const normalized = text.toLowerCase();
  return bannedTokens.some((token) => normalized.includes(token.toLowerCase()));
}

function planContainsRestrictedMeal(plan: unknown, bannedTokens: string[]): boolean {
  if (!Array.isArray((plan as { meals?: unknown[] })?.meals)) return false;
  return ((plan as { meals: unknown[] }).meals).some((meal) => {
    if (!meal || typeof meal !== 'object') return false;
    const node = meal as Record<string, unknown>;
    if (textContainsBannedToken(String(node.title ?? ''), bannedTokens)) return true;
    const ingredients = Array.isArray(node.ingredients) ? node.ingredients : [];
    return ingredients.some((ingredient) => {
      if (!ingredient || typeof ingredient !== 'object') return false;
      return textContainsBannedToken(String((ingredient as Record<string, unknown>).name ?? ''), bannedTokens);
    });
  });
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const { success } = await rateLimitStrict(session.user.id, 'meal-plan-gen');
    if (!success) throw new ApiError(429, 'Too many meal plan generations — try again later');

    let days = 1;
    let mealsPerDay = 3;
    try {
      const rawBody = await request.json();
      if ('user_preferences' in (rawBody as Record<string, unknown>)) {
        const body = mealPlanRequestSchema.parse(rawBody);
        days = body.meal_plan_request.duration === 'weekly' ? 7 : 1;
        mealsPerDay = body.user_preferences.meals_per_day;
      } else {
        const body = rawBody as { duration?: 'daily' | 'weekly'; mealsPerDay?: number };
        days = body.duration === 'weekly' ? 7 : 1;
        if (typeof body.mealsPerDay === 'number') mealsPerDay = body.mealsPerDay;
      }
    } catch {
      throw new ApiError(400, 'Invalid meal plan request payload');
    }
    const result = await generateMealPlanForUser(session.user.id, { days, mealsPerDay });
    const profile = await prisma.healthProfile.findUnique({
      where: { userId: session.user.id },
      select: { dietaryRestrictions: true },
    });
    const bannedTokens = allBannedIngredientTokens(profile?.dietaryRestrictions ?? []);
    if (planContainsRestrictedMeal(result.plan, bannedTokens)) {
      throw new ApiError(422, 'Generated meal plan conflicts with your dietary restrictions. Please regenerate.');
    }
    await syncShoppingListFromMealPlan(session.user.id, result.mealPlanId);
    const mealPlan = await prisma.mealPlan.findUnique({
      where: { id: result.mealPlanId },
      include: {
        items: {
          include: {
            recipe: {
              include: {
                nutritionFacts: true,
              },
            },
          },
        },
      },
    });
    return NextResponse.json({
      mealPlan,
      ...result,
      planJson: mealPlan?.planJson ?? result.plan,
      items: mealPlan?.items ?? [],
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
