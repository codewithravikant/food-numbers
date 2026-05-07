import { cn } from '@/lib/utils';

type SourceTone = 'live' | 'cached' | 'fallback';

interface AiSourceBadgeProps {
  fallbackUsed?: boolean;
  modelUsed?: string | null;
  labelOverride?: string;
  className?: string;
}

function resolveSource(
  fallbackUsed?: boolean,
  modelUsed?: string | null
): { label: string; tone: SourceTone } {
  if (!fallbackUsed) return { label: 'Live AI', tone: 'live' };
  if (modelUsed === 'cached_response_v1') return { label: 'Cached AI', tone: 'cached' };
  return { label: 'Fallback', tone: 'fallback' };
}

const toneClasses: Record<SourceTone, string> = {
  live: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
  cached: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-300',
  fallback: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
};

export function AiSourceBadge({
  fallbackUsed = true,
  modelUsed = null,
  labelOverride,
  className,
}: AiSourceBadgeProps) {
  const source = resolveSource(fallbackUsed, modelUsed);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider',
        toneClasses[source.tone],
        className
      )}
    >
      {labelOverride ?? source.label}
    </span>
  );
}
