import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/api-error';

type Review = { recipeId: string; rating: number; comment?: string; createdAt: string };
const reviews: Review[] = [];

export async function GET() {
  try {
    const grouped = new Map<string, { recipeId: string; avgRating: number; reviewCount: number }>();
    for (const r of reviews) {
      const g = grouped.get(r.recipeId);
      if (g) {
        const total = g.avgRating * g.reviewCount + r.rating;
        g.reviewCount += 1;
        g.avgRating = total / g.reviewCount;
      } else {
        grouped.set(r.recipeId, { recipeId: r.recipeId, avgRating: r.rating, reviewCount: 1 });
      }
    }
    const ranked = Array.from(grouped.values()).sort((a, b) => b.avgRating - a.avgRating);
    return NextResponse.json({ ranked });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');
    const body = (await request.json()) as { recipeId?: string; rating?: number; comment?: string };
    if (!body.recipeId || typeof body.rating !== 'number') throw new ApiError(400, 'recipeId and rating required');
    reviews.push({
      recipeId: body.recipeId,
      rating: Math.max(1, Math.min(5, body.rating)),
      comment: body.comment,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
