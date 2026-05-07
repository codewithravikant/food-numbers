import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { suggestMicronutrients } from '@/lib/nutrition/micronutrients';
import { handleApiError, ApiError } from '@/lib/api-error';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new ApiError(401, 'Unauthorized');
    const body = (await request.json()) as { deficiencies?: string[] };
    const deficiencies = Array.isArray(body.deficiencies) ? body.deficiencies : [];
    return NextResponse.json({
      recommendations: suggestMicronutrients(deficiencies),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
