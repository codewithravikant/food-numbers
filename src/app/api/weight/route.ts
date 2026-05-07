import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { weightLogSchema } from '@/lib/validations/logging';
import { handleApiError, ApiError } from '@/lib/api-error';
import { rateLimitMutation } from '@/lib/rate-limit';
import { recalculateAndStoreWellnessScore } from '@/lib/wellness-score';
import { requireApiUserId } from '@/lib/auth/jwt-session';
import { Prisma } from '@prisma/client';
import {
  decryptJsonForUser,
  decryptTextForUser,
  encryptJsonForUser,
  encryptTextForUser,
} from '@/lib/security/field-crypto';

export async function GET(request: Request) {
  try {
    const userId = await requireApiUserId(request);

    const logs = await prisma.weightLog.findMany({
      where: { userId },
      orderBy: { loggedAt: 'desc' },
      take: 90,
    });

    return NextResponse.json(
      logs.map((log) => ({
        ...(() => {
          const safeLog = { ...log };
          delete (safeLog as { measurementEnc?: string | null }).measurementEnc;
          return safeLog;
        })(),
        note: decryptTextForUser(userId, log.note),
      }))
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireApiUserId(request);

    const { success } = await rateLimitMutation(userId, 'weight-log');
    if (!success) throw new ApiError(429, 'Too many requests');

    const body = await request.json();
    const data = weightLogSchema.parse(body);
    const persistedData = {
      ...data,
      note: encryptTextForUser(userId, data.note),
      loggedAt: data.loggedAt ? new Date(data.loggedAt) : undefined,
      measurementEnc: encryptJsonForUser(userId, {
        weightKg: data.weightKg,
        loggedAt: data.loggedAt ?? null,
      }),
    };

    let log;
    try {
      log = await prisma.weightLog.create({
        data: { ...persistedData, userId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'A weight entry already exists for this timestamp');
      }
      throw error;
    }

    // Update profile weight
    const profile = await prisma.healthProfile.findUnique({
      where: { userId },
      select: { sensitiveSnapshotEnc: true },
    });
    const currentSnapshot = decryptJsonForUser<Record<string, unknown>>(
      userId,
      profile?.sensitiveSnapshotEnc
    ) ?? {};
    const currentPhysicalMetrics = (
      typeof currentSnapshot.physicalMetrics === 'object' && currentSnapshot.physicalMetrics
        ? currentSnapshot.physicalMetrics
        : {}
    ) as Record<string, unknown>;
    await prisma.healthProfile.update({
      where: { userId },
      data: {
        weightKg: data.weightKg,
        sensitiveSnapshotEnc: encryptJsonForUser(userId, {
          ...currentSnapshot,
          physicalMetrics: {
            ...currentPhysicalMetrics,
            weightKg: data.weightKg,
          },
        }),
      },
    });

    await recalculateAndStoreWellnessScore(userId);

    return NextResponse.json(
      {
        ...(() => {
          const safeLog = { ...log };
          delete (safeLog as { measurementEnc?: string | null }).measurementEnc;
          return safeLog;
        })(),
        note: decryptTextForUser(userId, log.note),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
