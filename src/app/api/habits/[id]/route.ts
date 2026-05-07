import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { habitLogSchema } from '@/lib/validations/logging';
import { handleApiError, ApiError } from '@/lib/api-error';
import { requireApiUserId } from '@/lib/auth/jwt-session';
import { decryptTextForUser, encryptJsonForUser, encryptTextForUser } from '@/lib/security/field-crypto';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUserId(request);

    const { id } = await params;
    const body = await request.json();
    const data = habitLogSchema.partial().parse(body);

    const log = await prisma.habitLog.findFirst({
      where: { id, userId },
    });
    if (!log) throw new ApiError(404, 'Habit log not found');
    const persistedData = {
      ...data,
      ...(Object.prototype.hasOwnProperty.call(data, 'notes')
        ? { notes: encryptTextForUser(userId, data.notes) }
        : {}),
      ...(Object.keys(data).length > 0
        ? {
            measurementEnc: encryptJsonForUser(userId, {
              sleepHours: data.sleepHours ?? log.sleepHours ?? null,
              sleepQuality: data.sleepQuality ?? log.sleepQuality ?? null,
              hydrationLiters: data.hydrationLiters ?? log.hydrationLiters ?? null,
              stressLevel: data.stressLevel ?? log.stressLevel ?? null,
              moodLevel: data.moodLevel ?? log.moodLevel ?? null,
              isRecoveryDay: data.isRecoveryDay ?? log.isRecoveryDay ?? null,
            }),
          }
        : {}),
    };

    const updated = await prisma.habitLog.update({
      where: { id },
      data: persistedData,
    });

    return NextResponse.json({
      ...(() => {
        const safeLog = { ...updated };
        delete (safeLog as { measurementEnc?: string | null }).measurementEnc;
        return safeLog;
      })(),
      notes: decryptTextForUser(userId, updated.notes),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUserId(_request);

    const { id } = await params;
    const log = await prisma.habitLog.findFirst({
      where: { id, userId },
    });
    if (!log) throw new ApiError(404, 'Habit log not found');

    await prisma.habitLog.delete({ where: { id } });
    return NextResponse.json({ message: 'Deleted' });
  } catch (error) {
    return handleApiError(error);
  }
}
