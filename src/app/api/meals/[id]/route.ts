import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError, ApiError } from '@/lib/api-error';
import { requireApiUserId } from '@/lib/auth/jwt-session';
import { decryptJsonForUser, encryptJsonForUser } from '@/lib/security/field-crypto';
import { z } from 'zod';

const mealMatchPatchSchema = z.object({
  matchType: z.enum(['planned', 'outside']),
  matchedPlannedMealKey: z
    .object({
      dayIndex: z.number().int().min(0),
      slot: z.string().min(1),
      title: z.string().min(1),
    })
    .optional()
    .nullable(),
});

type MealMeasurement = {
  mealType?: string | null;
  estimatedCalories?: number | null;
  estimatedProteinG?: number | null;
  estimatedCarbsG?: number | null;
  estimatedFatsG?: number | null;
  loggedAt?: string | null;
  matchType?: 'planned' | 'outside' | null;
  matchedPlannedMealKey?: {
    dayIndex: number;
    slot: string;
    title: string;
  } | null;
};

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUserId(_request);

    const { id } = await params;
    const log = await prisma.mealLog.findFirst({
      where: { id, userId },
    });
    if (!log) throw new ApiError(404, 'Meal log not found');

    await prisma.mealLog.delete({ where: { id } });
    return NextResponse.json({ message: 'Deleted' });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUserId(request);
    const { id } = await params;
    const payload = mealMatchPatchSchema.parse(await request.json());

    if (payload.matchType === 'planned' && !payload.matchedPlannedMealKey) {
      throw new ApiError(400, 'matchedPlannedMealKey is required when matchType is planned');
    }
    if (payload.matchType === 'outside' && payload.matchedPlannedMealKey) {
      throw new ApiError(400, 'matchedPlannedMealKey must be empty when matchType is outside');
    }

    const existing = await prisma.mealLog.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new ApiError(404, 'Meal log not found');

    const measurement = decryptJsonForUser<MealMeasurement>(userId, existing.measurementEnc) || {};
    const nextMeasurement: MealMeasurement = {
      ...measurement,
      matchType: payload.matchType,
      matchedPlannedMealKey: payload.matchType === 'planned' ? payload.matchedPlannedMealKey || null : null,
    };

    const updated = await prisma.mealLog.update({
      where: { id },
      data: {
        measurementEnc: encryptJsonForUser(userId, nextMeasurement),
      },
    });

    return NextResponse.json({
      id: updated.id,
      mealMatchType: nextMeasurement.matchType,
      matchedPlannedMealKey: nextMeasurement.matchedPlannedMealKey ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
