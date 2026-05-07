import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleApiError, ApiError } from '@/lib/api-error';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');
    const habits = await prisma.habitLog.findMany({
      where: { userId: session.user.id },
      orderBy: { date: 'desc' },
      take: 7,
    });
    const avgStress =
      habits.length > 0 ? habits.reduce((sum, h) => sum + h.stressLevel, 0) / habits.length : 5;
    const avgSleep =
      habits.length > 0 ? habits.reduce((sum, h) => sum + (h.sleepHours || 7), 0) / habits.length : 7;

    const suggestions = [
      avgStress > 6 ? 'Use 5-minute breathing protocol after lunch.' : 'Keep your current stress buffer ritual.',
      avgSleep < 7 ? 'Move screen cutoff 30 minutes earlier tonight.' : 'Sleep rhythm is stable; preserve wake time.',
      'Pair dinner log + hydration check to boost habit consistency.',
    ];
    return NextResponse.json({ suggestions });
  } catch (error) {
    return handleApiError(error);
  }
}
