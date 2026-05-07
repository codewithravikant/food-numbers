import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAiIoLog, clearAiIoLog } from '@/lib/ai/dev-io-log';

function isDevEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && (process.env.AI_IO_LOG === '1' || process.env.AI_IO_LOG === 'true');
}

export async function GET(req: Request) {
  if (!isDevEnabled()) return new NextResponse('Not found', { status: 404 });

  // Keep it safe: only allow logged-in users to view prompts/responses in dev.
  const session = await auth();
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

  const url = new URL(req.url);
  const clear = url.searchParams.get('clear');
  if (clear === '1' || clear === 'true') clearAiIoLog();

  return NextResponse.json({ enabled: true, entries: getAiIoLog() });
}

