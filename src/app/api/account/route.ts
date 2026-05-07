import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth-helpers';
import { deleteAccountSchema, patchAccountSchema } from '@/lib/validations/auth';
import { handleApiError, ApiError } from '@/lib/api-error';
import { rateLimitMutation } from '@/lib/rate-limit';

const OAUTH_DELETE_CONFIRM_PHRASE = 'DELETE';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, password: true, twoFactorEnabled: true },
    });
    if (!user) {
      throw new ApiError(401, 'Your session is out of date. Sign out and sign in again.');
    }

    return NextResponse.json({
      name: user.name ?? '',
      email: user.email,
      hasPassword: Boolean(user.password),
      twoFactorEnabled: user.twoFactorEnabled,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const { success } = await rateLimitMutation(session.user.id, 'account-update');
    if (!success) throw new ApiError(429, 'Too many requests');

    const body = await request.json();
    const { name } = patchAccountSchema.parse(body);

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { name: name === '' ? null : name },
      select: { name: true, email: true, password: true, twoFactorEnabled: true },
    });

    return NextResponse.json({
      name: user.name ?? '',
      email: user.email,
      hasPassword: Boolean(user.password),
      twoFactorEnabled: user.twoFactorEnabled,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');

    const { success } = await rateLimitMutation(session.user.id, 'account-delete');
    if (!success) throw new ApiError(429, 'Too many requests');

    const rawBody = await request.json().catch(() => ({}));
    const { email, currentPassword, confirmPhrase } = deleteAccountSchema.parse(rawBody);

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, password: true },
    });
    if (!user) {
      throw new ApiError(401, 'Your session is out of date. Sign out and sign in again.');
    }

    if (email !== user.email.trim().toLowerCase()) {
      throw new ApiError(400, 'Email confirmation does not match your account email.');
    }

    if (user.password) {
      if (!currentPassword) throw new ApiError(400, 'Current password is required.');
      const passwordOk = await verifyPassword(currentPassword, user.password);
      if (!passwordOk) throw new ApiError(400, 'Current password is incorrect.');
    } else {
      if (confirmPhrase?.trim().toUpperCase() !== OAUTH_DELETE_CONFIRM_PHRASE) {
        throw new ApiError(400, `Type ${OAUTH_DELETE_CONFIRM_PHRASE} to confirm account deletion.`);
      }
    }

    // Prisma relations from User are set to onDelete: Cascade for user-owned data.
    await prisma.user.delete({ where: { id: session.user.id } });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
