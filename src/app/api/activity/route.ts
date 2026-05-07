import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { activityLogSchema } from '@/lib/validations/logging';
import { handleApiError, ApiError } from '@/lib/api-error';
import { rateLimitMutation } from '@/lib/rate-limit';
import { requireApiUserId } from '@/lib/auth/jwt-session';
import { recalculateAndStoreWellnessScore } from '@/lib/wellness-score';
import { Prisma } from '@prisma/client';
import { decryptTextForUser, encryptJsonForUser, encryptTextForUser } from '@/lib/security/field-crypto';

export async function GET(request: Request) {
  try {
    const userId = await requireApiUserId(request);

    const logs = await prisma.activityLog.findMany({
      where: { userId },
      orderBy: { loggedAt: 'desc' },
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

    const { success } = await rateLimitMutation(userId, 'activity-log');
    if (!success) throw new ApiError(429, 'Too many requests');

    const body = await request.json();
    const data = activityLogSchema.parse(body);
    const persistedData = {
      ...data,
      notes: encryptTextForUser(userId, data.notes),
      loggedAt: data.loggedAt ? new Date(data.loggedAt) : undefined,
      measurementEnc: encryptJsonForUser(userId, {
        activityType: data.activityType,
        durationMin: data.durationMin,
        intensityLevel: data.intensityLevel ?? null,
        isRecoveryDay: data.isRecoveryDay ?? null,
        loggedAt: data.loggedAt ?? null,
      }),
    };

    // ─── Duplicate Prevention ───────────────────────────────────────
    // Reject identical activity logs within a 5-minute window
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const duplicate = await prisma.activityLog.findFirst({
      where: {
        userId,
        activityType: persistedData.activityType,
        durationMin: persistedData.durationMin,
        loggedAt: { gte: fiveMinAgo },
      },
    });

    if (duplicate) {
      throw new ApiError(409, 'Duplicate activity detected. Same activity was logged within the last 5 minutes.');
    }

    let log;
    try {
      log = await prisma.activityLog.create({
        data: { ...persistedData, userId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'An activity entry already exists for this timestamp');
      }
      throw error;
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
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
