import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth-helpers';
import { signupSchema } from '@/lib/validations/auth';
// import { generateVerificationToken } from '@/lib/tokens';
// import { sendVerificationEmail } from '@/lib/email';
import { handleApiError, ApiError } from '@/lib/api-error';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = signupSchema.parse(body);

    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existingUser) {
      throw new ApiError(409, 'An account with this email already exists');
    }

    const hashedPassword = await hashPassword(password);
    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        emailVerified: new Date(),
      },
    });

    // Email verification disabled for now — users can sign in immediately.
    // const token = await generateVerificationToken(user.id);
    // try {
    //   await sendVerificationEmail(email, token);
    // } catch (emailError) {
    //   console.error('Failed to send verification email:', emailError);
    //   return NextResponse.json(
    //     {
    //       emailSent: false,
    //       message:
    //         'Account created, but the verification email could not be sent. Use Google SMTP (SMTP_USER, SMTP_PASS App Password, SMTP_PORT=587) on the server, then use Resend link below.',
    //     },
    //     { status: 201 }
    //   );
    // }

    return NextResponse.json(
      {
        emailSent: true,
        message: 'Account created. You can sign in now.',
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
