import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api-error';
import { getRequestMeta, refreshTokenPair } from '@/lib/auth/jwt-session';

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { refreshToken } = refreshSchema.parse(body);
    const tokens = await refreshTokenPair(refreshToken, getRequestMeta(request));
    return NextResponse.json(tokens);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'refreshToken is required' }, { status: 400 });
    }
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleApiError(error);
  }
}
