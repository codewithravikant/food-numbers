import type { NextFetchEvent, NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';
import { apiCorsPreflightResponse, withApiCors } from '@/lib/api-cors';

const { auth: authEdge } = NextAuth(authConfig);

type EdgeAuth = (req: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>;
const authMiddleware = authEdge as unknown as EdgeAuth;

function asNextResponse(res: Response | NextResponse | undefined | null): NextResponse {
  if (res == null) return NextResponse.next();
  if (res instanceof NextResponse) return res;
  return new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/**
 * NextAuth session edge check for protected pages + all /api routes.
 * API routes also get CORS headers for split frontends (see CORS_ALLOWED_ORIGINS).
 *
 * Note: Verification email is sent server→SMTP; CORS does not affect mail delivery.
 */
export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    if (request.method === 'OPTIONS') {
      return apiCorsPreflightResponse(request);
    }
    const authResponse = await authMiddleware(request, event);
    return withApiCors(request, asNextResponse(authResponse));
  }

  const authResponse = await authMiddleware(request, event);
  return asNextResponse(authResponse);
}

export const config = {
  matcher: [
    '/api/:path*',
    '/home/:path*',
    '/fuel/:path*',
    '/vitality/:path*',
    '/blueprint/:path*',
    '/settings/:path*',
    '/onboarding/:path*',
  ],
};
