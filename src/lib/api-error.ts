import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    const flattened = error.flatten();
    const firstFieldMessage = Object.values(flattened.fieldErrors).flat().find(Boolean);
    const firstMessage = firstFieldMessage || flattened.formErrors[0] || 'Validation failed';
    console.error('Validation error:', flattened);
    return NextResponse.json(
      {
        error: 'Validation failed',
        message: firstMessage,
        details: flattened,
        fieldErrors: flattened.fieldErrors,
      },
      { status: 400 }
    );
  }
  console.error(error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
