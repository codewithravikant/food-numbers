import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleApiError, ApiError } from '@/lib/api-error';
import { inferShoppingCategory } from '@/lib/shopping-list';

function shoppingModel() {
  return (prisma as unknown as { shoppingListItem?: {
    count: (...args: unknown[]) => Promise<number>;
    findMany: (...args: unknown[]) => Promise<unknown[]>;
    create: (...args: unknown[]) => Promise<unknown>;
  } }).shoppingListItem;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');
    const shopping = shoppingModel();
    if (!shopping) return NextResponse.json({ items: [] });
    const items = await shopping.findMany({
      where: { userId: session.user.id },
      orderBy: [{ checked: 'asc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');
    const shopping = shoppingModel();
    if (!shopping) throw new ApiError(503, 'Shopping list is unavailable until server restart');
    const body = (await request.json()) as {
      name?: string;
      quantity?: number;
      unit?: string;
      category?: string;
    };
    const name = String(body.name || '').trim();
    if (!name) throw new ApiError(400, 'Name is required');
    const row = await shopping.create({
      data: {
        userId: session.user.id,
        name,
        quantity: Number(body.quantity || 0),
        unit: String(body.unit || 'g'),
        category: body.category || inferShoppingCategory(name),
      },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
