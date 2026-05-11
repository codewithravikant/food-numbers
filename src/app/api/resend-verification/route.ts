import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resendVerificationSchema } from '@/lib/validations/auth';
import { generateVerificationToken } from '@/lib/tokens';
import { sendVerificationEmail } from '@/lib/email';
import { handleApiError } from '@/lib/api-error';
import { rateLimitByKey } from '@/lib/rate-limit';

const GENERIC_OK =
  'If an account exists with that email and needs verification, we sent a new link.';

const isDev = process.env.NODE_ENV === 'development';

type ResendDebug =
  | { skipped: 'not_found' | 'oauth_only' | 'already_verified'; sent: false }
  | { skipped: null; sent: true };

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = resendVerificationSchema.parse(body);

    const { success } = await rateLimitByKey(`resend-verify:${email}`, 3, 60 * 60 * 1000);
    if (!success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, password: true, emailVerified: true, email: true },
    });

    if (!user) {
      if (isDev) console.warn('[resend-verification] skipped: no user for email', email);
      else console.warn('[resend-verification] skipped: no matching account');
      return NextResponse.json({
        message: GENERIC_OK,
        ...(isDev && { debug: { skipped: 'not_found', sent: false } satisfies ResendDebug }),
      });
    }

    if (!user.password) {
      if (isDev) console.warn('[resend-verification] skipped: oauth-only user', email);
      else console.warn('[resend-verification] skipped: oauth-only account');
      return NextResponse.json({
        message: GENERIC_OK,
        ...(isDev && { debug: { skipped: 'oauth_only', sent: false } satisfies ResendDebug }),
      });
    }

    if (user.emailVerified) {
      if (isDev) console.warn('[resend-verification] skipped: already verified', email);
      else console.warn('[resend-verification] skipped: already verified');
      return NextResponse.json({
        message: GENERIC_OK,
        ...(isDev && { debug: { skipped: 'already_verified', sent: false } satisfies ResendDebug }),
      });
    }

    await prisma.verificationToken.deleteMany({
      where: { userId: user.id, used: false },
    });

    const token = await generateVerificationToken(user.id);
    try {
      await sendVerificationEmail(user.email, token);
    } catch (e) {
      console.error('resend-verification: send failed', e);
      return NextResponse.json(
        {
          error:
            'Email could not be sent. Check SMTP_HOST, SMTP_PORT (587 recommended), SMTP_USER, SMTP_PASS, and EMAIL_FROM on the server.',
        },
        { status: 503 }
      );
    }

    if (isDev) console.info('[resend-verification] verification email sent to', user.email);
    else console.info('[resend-verification] verification email sent');

    return NextResponse.json({
      message: GENERIC_OK,
      ...(isDev && { debug: { skipped: null, sent: true } satisfies ResendDebug }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
