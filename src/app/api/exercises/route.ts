import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { ApiError, handleApiError } from '@/lib/api-error';
import { listExercises } from '@/lib/exercises/load-exercises';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const { searchParams } = request.nextUrl;
    const q = searchParams.get('q') ?? undefined;
    const bodyPart = searchParams.get('bodyPart') ?? undefined;

    const exercises = listExercises({ q: q ?? undefined, bodyPart: bodyPart ?? undefined });
    return NextResponse.json({ exercises });
  } catch (e) {
    return handleApiError(e);
  }
}
