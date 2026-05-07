import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { habitLogSchema } from '@/lib/validations/logging';
import { handleApiError, ApiError } from '@/lib/api-error';
import { rateLimitMutation } from '@/lib/rate-limit';
import { recalculateAndStoreWellnessScore } from '@/lib/wellness-score';
import { requireApiUserId } from '@/lib/auth/jwt-session';
import { decryptTextForUser, encryptJsonForUser, encryptTextForUser } from '@/lib/security/field-crypto';

export async function GET(request: Request) {
  try {
    const userId = await requireApiUserId(request);

    const logs = await prisma.habitLog.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 30,
    });

    return NextResponse.json(
      logs.map((log) => ({
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

    const { success } = await rateLimitMutation(userId, 'habit-log');
    if (!success) throw new ApiError(429, 'Too many requests');

    const body = await request.json();
    const data = habitLogSchema.parse(body);
    const persistedData = {
      ...data,
      notes: encryptTextForUser(userId, data.notes),
      measurementEnc: encryptJsonForUser(userId, {
        sleepHours: data.sleepHours ?? null,
        sleepQuality: data.sleepQuality ?? null,
        hydrationLiters: data.hydrationLiters ?? null,
        stressLevel: data.stressLevel,
        moodLevel: data.moodLevel ?? null,
        isRecoveryDay: data.isRecoveryDay ?? null,
      }),
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Upsert for today
    const existing = await prisma.habitLog.findFirst({
      where: { userId, date: { gte: today } },
    });

    let log;
    if (existing) {
      log = await prisma.habitLog.update({
        where: { id: existing.id },
        data: persistedData,
      });
    } else {
      log = await prisma.habitLog.create({
        data: { ...persistedData, userId },
      });
    }

    await recalculateAndStoreWellnessScore(userId);

    return NextResponse.json(
      {
        ...(() => {
          const safeLog = { ...log };
          delete (safeLog as { measurementEnc?: string | null }).measurementEnc;
          return safeLog;
        })(),
        notes: decryptTextForUser(userId, log.notes),
      },
      { status: existing ? 200 : 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
