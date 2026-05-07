import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError, ApiError } from '@/lib/api-error';
import { requireApiUserId } from '@/lib/auth/jwt-session';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUserId(_request);

    const { id } = await params;
    const log = await prisma.weightLog.findFirst({
      where: { id, userId },
    });

    if (!log) throw new ApiError(404, 'Weight log not found');

    await prisma.weightLog.delete({ where: { id } });
    return NextResponse.json({ message: 'Deleted' });
  } catch (error) {
    return handleApiError(error);
  }
}
