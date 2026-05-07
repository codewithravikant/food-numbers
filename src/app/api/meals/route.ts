import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mealLogSchema } from '@/lib/validations/logging';
import { handleApiError, ApiError } from '@/lib/api-error';
import { rateLimitMutation } from '@/lib/rate-limit';
import { parseIso8601 } from '@/lib/nutrition/units';
import { requireApiUserId } from '@/lib/auth/jwt-session';
import { decryptJsonForUser, decryptTextForUser, encryptJsonForUser, encryptTextForUser } from '@/lib/security/field-crypto';

type MealMatchType = 'planned' | 'outside' | null;
type PlannedMealKey = {
  dayIndex: number;
  slot: string;
  title: string;
};
type MealMeasurement = {
  mealType?: string | null;
  estimatedCalories?: number | null;
  estimatedProteinG?: number | null;
  estimatedCarbsG?: number | null;
  estimatedFatsG?: number | null;
  loggedAt?: string | null;
  matchType?: MealMatchType;
  matchedPlannedMealKey?: PlannedMealKey | null;
};

export async function GET(request: Request) {
  try {
    const userId = await requireApiUserId(request);

    const logs = await prisma.mealLog.findMany({
      where: { userId },
      orderBy: { loggedAt: 'desc' },
      take: 30,
    });

    return NextResponse.json(
      logs.map((log) => ({
        ...(function () {
          const measurement = decryptJsonForUser<MealMeasurement>(userId, log.measurementEnc);
          return {
            mealMatchType: measurement?.matchType ?? null,
            matchedPlannedMealKey: measurement?.matchedPlannedMealKey ?? null,
          };
        })(),
        ...(() => {
          const safeLog = { ...log };
          delete (safeLog as { measurementEnc?: string | null }).measurementEnc;
          return safeLog;
        })(),
        notes: decryptTextForUser(userId, log.notes),
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireApiUserId(request);

    const { success } = await rateLimitMutation(userId, 'meal-log');
    if (!success) throw new ApiError(429, 'Too many requests');

    const body = await request.json();
    const data = mealLogSchema.parse(body);
    const encryptedNotes = encryptTextForUser(userId, data.notes);
    const measurementEnc = encryptJsonForUser(userId, {
      mealType: data.mealType,
      estimatedCalories: data.estimatedCalories ?? null,
      estimatedProteinG: data.estimatedProteinG ?? null,
      estimatedCarbsG: data.estimatedCarbsG ?? null,
      estimatedFatsG: data.estimatedFatsG ?? null,
      loggedAt: data.loggedAt ?? null,
      matchType: null,
      matchedPlannedMealKey: null,
    });

    const log = await prisma.mealLog.create({
      data: {
        mealType: data.mealType,
        description:
          data.description ||
          ([data.estimatedCalories, data.estimatedProteinG, data.estimatedCarbsG, data.estimatedFatsG].some((v) => typeof v === 'number')
            ? JSON.stringify({
                estimatedCalories: data.estimatedCalories ?? null,
                estimatedProteinG: data.estimatedProteinG ?? null,
                estimatedCarbsG: data.estimatedCarbsG ?? null,
                estimatedFatsG: data.estimatedFatsG ?? null,
              })
            : undefined),
        photoUrl: data.photoUrl,
        notes: encryptedNotes,
        loggedAt: data.loggedAt ? parseIso8601(data.loggedAt) : undefined,
        measurementEnc,
        userId,
      },
    });

    return NextResponse.json(
      {
        ...(() => {
          const safeLog = { ...log };
          delete (safeLog as { measurementEnc?: string | null }).measurementEnc;
          return safeLog;
        })(),
        notes: decryptTextForUser(userId, log.notes),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
