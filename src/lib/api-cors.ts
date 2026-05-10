import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Origins allowed to call this app's /api routes from a browser (cross-origin).
 * Same-origin Next.js (UI + API on one Railway URL) does not need CORS for fetch().
 *
 * CORS does not affect outbound SMTP; verification email uses the server → mail host path only.
 */
export function resolveCorsAllowOrigin(request: NextRequest): string {
  if (process.env.CORS_ALLOW_ANY === 'true') {
    return '*';
  }

  const fromEnv =
    process.env.CORS_ALLOWED_ORIGINS?.split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean) ?? [];

  const inferred = [
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, ''),
    process.env.NEXTAUTH_URL?.replace(/\/$/, ''),
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].filter((x): x is string => Boolean(x));

  const allowed = [...new Set([...fromEnv, ...inferred])];
  const origin = request.headers.get('origin')?.replace(/\/$/, '') ?? '';

  if (origin && allowed.includes(origin)) {
    return origin;
  }
  if (allowed.length > 0) {
    return allowed[0]!;
  }
  return '*';
}

export function corsHeadersFor(request: NextRequest): Record<string, string> {
  const allowOrigin = resolveCorsAllowOrigin(request);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };
  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

export function apiCorsPreflightResponse(request: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(request) });
}

export function withApiCors(request: NextRequest, response: NextResponse): NextResponse {
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return response;
  }
  const h = corsHeadersFor(request);
  for (const [key, value] of Object.entries(h)) {
    response.headers.set(key, value);
  }
  return response;
}
