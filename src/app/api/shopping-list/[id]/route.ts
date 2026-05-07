import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleApiError, ApiError } from '@/lib/api-error';

function shoppingModel() {
  return (prisma as unknown as { shoppingListItem?: {
    updateMany: (...args: unknown[]) => Promise<{ count: number }>;
    findUnique: (...args: unknown[]) => Promise<unknown>;
    deleteMany: (...args: unknown[]) => Promise<{ count: number }>;
  } }).shoppingListItem;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');
    const shopping = shoppingModel();
    if (!shopping) throw new ApiError(503, 'Shopping list is unavailable until server restart');
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      quantity?: number;
      unit?: string;
      category?: string;
      checked?: boolean;
    };
    const updated = await shopping.updateMany({
      where: { id, userId: session.user.id },
      data: {
        ...(typeof body.name === 'string' ? { name: body.name.trim() } : {}),
        ...(typeof body.quantity === 'number' ? { quantity: body.quantity } : {}),
        ...(typeof body.unit === 'string' ? { unit: body.unit } : {}),
        ...(typeof body.category === 'string' ? { category: body.category } : {}),
        ...(typeof body.checked === 'boolean' ? { checked: body.checked } : {}),
      },
    });
    if (updated.count === 0) throw new ApiError(404, 'Item not found');
    const row = await shopping.findUnique({ where: { id } });
    return NextResponse.json(row);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');
    const shopping = shoppingModel();
    if (!shopping) throw new ApiError(503, 'Shopping list is unavailable until server restart');
    const { id } = await params;
    const deleted = await shopping.deleteMany({
      where: { id, userId: session.user.id },
    });
    if (deleted.count === 0) throw new ApiError(404, 'Item not found');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
