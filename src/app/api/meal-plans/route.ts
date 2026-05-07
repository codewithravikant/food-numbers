import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleApiError, ApiError } from '@/lib/api-error';
import { generateMealPlanForUser } from '@/lib/ai/meal-plan-pipeline';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const latest = await prisma.mealPlan.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: {
            recipe: {
              include: { nutritionFacts: true },
            },
          },
        },
      },
    });

    return NextResponse.json({ mealPlan: latest });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const body = (await request.json()) as {
      action: 'pin' | 'togglePin' | 'togglePlanned' | 'add' | 'regenerate';
      mealIndex?: number;
      title?: string;
      slot?: string;
    };
    const latest = await prisma.mealPlan.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) throw new ApiError(404, 'No meal plan found');

    if (body.action === 'regenerate') {
      const msPerDay = 24 * 60 * 60 * 1000;
      const totalDays = Math.max(1, Math.round((latest.endDate.getTime() - latest.startDate.getTime()) / msPerDay) + 1);
      const result = await generateMealPlanForUser(session.user.id, { days: totalDays, mealsPerDay: latest.mealsPerDay });
      const row = await prisma.mealPlan.findUnique({
        where: { id: result.mealPlanId },
        include: {
          items: {
            include: {
              recipe: { include: { nutritionFacts: true } },
            },
          },
        },
      });
      return NextResponse.json({ mealPlan: row });
    }

    const planJson = (latest.planJson || {}) as Record<string, unknown>;
    const meals = Array.isArray(planJson.meals) ? [...(planJson.meals as Record<string, unknown>[])] : [];
    const hasMealIndex = typeof body.mealIndex === 'number' && body.mealIndex >= 0 && body.mealIndex < meals.length;
    if ((body.action === 'pin' || body.action === 'togglePin' || body.action === 'add' || body.action === 'togglePlanned') && !hasMealIndex) {
      throw new ApiError(400, 'Valid meal index is required');
    }

    if (body.action === 'pin' || body.action === 'add') {
      const source = meals[body.mealIndex as number];
      meals[body.mealIndex as number] = {
        ...source,
        pinned: true,
      };
    }

    if (body.action === 'togglePlanned') {
      const source = meals[body.mealIndex as number];
      const nextPlanned = !Boolean(source.planned);
      meals[body.mealIndex as number] = {
        ...source,
        pinned: Boolean(source.pinned),
        planned: nextPlanned,
      };
    }

    if (body.action === 'togglePin') {
      const source = meals[body.mealIndex as number];
      meals[body.mealIndex as number] = {
        ...source,
        pinned: !Boolean(source.pinned),
      };
    }

    await prisma.mealPlan.update({
      where: { id: latest.id },
      data: { planJson: JSON.parse(JSON.stringify({ ...planJson, meals })) as object },
      include: {
        items: {
          include: {
            recipe: { include: { nutritionFacts: true } },
          },
        },
      },
    });
    if (body.action === 'togglePlanned') {
      const source = meals[body.mealIndex as number] as Record<string, unknown>;
      const normalizedSlot = (
        source.slot === 'BREAKFAST' || source.slot === 'LUNCH' || source.slot === 'DINNER' || source.slot === 'SNACK'
      )
        ? source.slot
        : 'SNACK';
      if (Boolean(source.planned)) {
        await prisma.mealPlanItem.create({
          data: {
            mealPlanId: latest.id,
            dayIndex: Number(source.dayIndex || 0),
            slot: normalizedSlot,
            title: String(source.title || body.title || 'Planned Meal'),
            calories: Number((source.nutrition as Record<string, unknown> | undefined)?.calories || 300),
            proteinG: Number((source.nutrition as Record<string, unknown> | undefined)?.protein || 20),
            carbsG: Number((source.nutrition as Record<string, unknown> | undefined)?.carbs || 25),
            fatsG: Number((source.nutrition as Record<string, unknown> | undefined)?.fats || 12),
          },
        });
      } else {
        await prisma.mealPlanItem.deleteMany({
          where: {
            mealPlanId: latest.id,
            title: String(source.title || body.title || 'Planned Meal'),
          },
        });
      }
    }
    const refreshed = await prisma.mealPlan.findUnique({
      where: { id: latest.id },
      include: {
        items: {
          include: {
            recipe: { include: { nutritionFacts: true } },
          },
        },
      },
    });
    return NextResponse.json({ mealPlan: refreshed });
  } catch (error) {
    return handleApiError(error);
  }
}
