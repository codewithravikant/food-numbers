import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ApiError, handleApiError } from '@/lib/api-error';
import { getRequestMeta, issueTokenPair } from '@/lib/auth/jwt-session';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new ApiError(401, 'Unauthorized');
    }

    const tokens = await issueTokenPair(session.user.id, getRequestMeta(request));
    return NextResponse.json(tokens, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
