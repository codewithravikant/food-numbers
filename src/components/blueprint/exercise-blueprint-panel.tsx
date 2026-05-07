'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Dumbbell, Copy, Trash2 } from 'lucide-react';

import type { ExerciseRecord } from '@/lib/exercises/schema';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'fitnexus_custom_workout_v1';

/** Open wger in the browser; private exercises are not imported into FitNexus yet. */
const WGER_LOGIN_URL = 'https://wger.de/en/user/login';

const DISCLAIMER =
  'This workout plan is informational only. You are responsible for your exercise choices and intensity. Consult a qualified health professional before starting or changing any fitness program.';

export type WorkoutLine = {
  exerciseId: string;
  name: string;
  sets: number;
  reps: number;
  restSec: number;
};

type StoredWorkout = {
  acknowledged: boolean;
  lines: WorkoutLine[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safe attribute value for srcDoc iframe (URLs from our dataset only). */
function escapeAttrUrl(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function loadStored(): StoredWorkout {
  if (typeof window === 'undefined') {
    return { acknowledged: false, lines: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { acknowledged: false, lines: [] };
    const p = JSON.parse(raw) as StoredWorkout;
    if (!p || !Array.isArray(p.lines)) return { acknowledged: false, lines: [] };
    return {
      acknowledged: Boolean(p.acknowledged),
      lines: p.lines.filter((l) => l.exerciseId && l.name),
    };
  } catch {
    return { acknowledged: false, lines: [] };
  }
}

function ExerciseThumb({ ex }: { ex: ExerciseRecord }) {
  const src = ex.mediaLocalPath || ex.mediaUrl;
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded-md bg-muted/50 text-muted-foreground">
        <Dumbbell className="h-10 w-10 opacity-40" aria-hidden />
      </div>
    );
  }
  return (
    <div className="relative h-28 w-full overflow-hidden rounded-md bg-muted/30">
      <Image
        src={src}
        alt=""
        fill
        className="object-contain p-1"
        sizes="(max-width: 768px) 100vw, 200px"
        unoptimized={src.startsWith('http')}
        onError={() => setErr(true)}
      />
    </div>
  );
}

function buildPreviewSrcDoc(ex: ExerciseRecord): string | null {
  const src = ex.mediaLocalPath || ex.mediaUrl;
  const title = ex.name;
  const body = ex.instructions.length > 0 ? ex.instructions.join(' ') : 'No written instructions for this exercise.';
  if (!src) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
      body{margin:0;font-family:system-ui,sans-serif;background:#0c0c0e;color:#e5e5e5;padding:16px;min-height:100%;box-sizing:border-box;}
      h1{font-size:1rem;margin:0 0 12px;font-weight:600;color:#34d399;}
      p{font-size:0.8125rem;line-height:1.5;opacity:0.92;}
      .ph{display:flex;align-items:center;justify-content:center;min-height:200px;color:#737373;font-size:0.875rem;}
    </style></head><body><h1>${escapeHtml(title)}</h1><div class="ph">No image — use form cues and instructions.</div><p>${escapeHtml(body)}</p></body></html>`;
  }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
    body{margin:0;font-family:system-ui,sans-serif;background:#0c0c0e;color:#e5e5e5;padding:12px;min-height:100%;box-sizing:border-box;}
    h1{font-size:1rem;margin:0 0 10px;font-weight:600;color:#34d399;}
    .wrap{max-width:100%;text-align:center;}
    img{max-width:100%;max-height:min(48vh,360px);width:auto;height:auto;object-fit:contain;display:inline-block;vertical-align:middle;border-radius:8px;background:#18181b;}
    p{font-size:0.8125rem;line-height:1.5;margin-top:12px;text-align:left;opacity:0.92;}
  </style></head><body><div class="wrap"><h1>${escapeHtml(title)}</h1><img src="${escapeAttrUrl(src)}" alt=""/></div><p>${escapeHtml(body)}</p></body></html>`;
}

export function ExerciseBlueprintPanel({ exercises }: { exercises: ExerciseRecord[] }) {
  const [activeTab, setActiveTab] = useState('library');
  const [q, setQ] = useState('');
  const [bodyPart, setBodyPart] = useState<string>('all');
  const [ack, setAck] = useState(false);
  const [lines, setLines] = useState<WorkoutLine[]>([]);
  const [previewLineIndex, setPreviewLineIndex] = useState<number | null>(null);
  /** Controlled value + reset so the "Add exercise" select works every time you pick. */
  const [addExerciseId, setAddExerciseId] = useState('');

  const byId = useMemo(() => {
    const m = new Map<string, ExerciseRecord>();
    for (const e of exercises) m.set(e.id, e);
    return m;
  }, [exercises]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const s = loadStored();
      setAck(s.acknowledged);
      setLines(s.lines);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (lines.length === 0) {
        setPreviewLineIndex(null);
        return;
      }
      setPreviewLineIndex((prev) => {
        if (prev === null) return lines.length - 1;
        if (prev >= lines.length) return lines.length - 1;
        return prev;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [lines]);

  const persist = useCallback((next: { acknowledged?: boolean; lines?: WorkoutLine[] }) => {
    const payload: StoredWorkout = {
      acknowledged: next.acknowledged ?? ack,
      lines: next.lines ?? lines,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [ack, lines]);

  const bodyParts = useMemo(() => {
    const s = new Set(exercises.map((e) => e.bodyPart));
    return ['all', ...Array.from(s).sort()];
  }, [exercises]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return exercises.filter((e) => {
      if (bodyPart !== 'all' && e.bodyPart !== bodyPart) return false;
      if (!qq) return true;
      return (
        e.name.toLowerCase().includes(qq) ||
        e.targetMuscle.toLowerCase().includes(qq) ||
        e.equipment.some((x) => x.toLowerCase().includes(qq))
      );
    });
  }, [exercises, q, bodyPart]);

  const addLine = (ex: ExerciseRecord, opts?: { switchToCustom?: boolean }) => {
    if (!ack) return;
    const next: WorkoutLine[] = [
      ...lines,
      { exerciseId: ex.id, name: ex.name, sets: 3, reps: 10, restSec: 60 },
    ];
    setLines(next);
    setPreviewLineIndex(next.length - 1);
    persist({ lines: next });
    if (opts?.switchToCustom) setActiveTab('custom');
  };

  const updateLine = (i: number, patch: Partial<WorkoutLine>) => {
    const next = lines.map((l, j) => (j === i ? { ...l, ...patch } : l));
    setLines(next);
    persist({ lines: next });
  };

  const removeLine = (i: number) => {
    const next = lines.filter((_, j) => j !== i);
    setLines(next);
    persist({ lines: next });
  };

  const previewExercise: ExerciseRecord | null = useMemo(() => {
    if (previewLineIndex === null || previewLineIndex < 0 || previewLineIndex >= lines.length) return null;
    const id = lines[previewLineIndex]?.exerciseId;
    if (!id) return null;
    return byId.get(id) ?? null;
  }, [byId, lines, previewLineIndex]);

  const previewSrcDoc = previewExercise ? buildPreviewSrcDoc(previewExercise) : null;

  const exportText = () => {
    const header = `Custom workout (informational only)\n${DISCLAIMER}\n\n`;
    const body = lines
      .map(
        (l, i) =>
          `${i + 1}. ${l.name} — ${l.sets}×${l.reps}, rest ${l.restSec}s`
      )
      .join('\n');
    return header + (body || '(no exercises selected)');
  };

  const copyExport = async () => {
    if (!ack) return;
    await navigator.clipboard.writeText(exportText());
  };

  return (
    <Card className="border-emerald-500/15 bg-black/20 backdrop-blur-xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-emerald-400">Exercise library &amp; custom workout</CardTitle>
        <p className="text-xs text-muted-foreground">
          Data from wger (community licenses per exercise). Not medical advice.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-100/90">
          <p className="font-medium text-amber-200">Safety gate — required for access</p>
          <p className="mt-1">{DISCLAIMER}</p>
          <label className="mt-3 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ack}
              onChange={(e) => {
                const v = e.target.checked;
                setAck(v);
                persist({ acknowledged: v });
              }}
            />
            <span>I understand and take responsibility for my workout choices.</span>
          </label>
        </div>

        {!ack && (
          <div
            className="rounded-xl border border-dashed border-amber-500/30 bg-black/40 p-8 text-center"
            aria-live="polite"
          >
            <p className="text-sm font-medium text-amber-200/95">Exercise library and custom workout are locked</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Accept the safety notice above to unlock browsing, building a plan, and export. Nothing below is available
              until then.
            </p>
          </div>
        )}

        {ack && (
          <p className="rounded-lg border border-emerald-500/20 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-100/90">
            Safety acknowledgement on file — library and workout builder are unlocked.
          </p>
        )}

        {ack ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="custom">Custom workout</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="ex-search">Search</Label>
                <Input
                  id="ex-search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Name, muscle, equipment…"
                />
              </div>
              <div className="w-full space-y-1 sm:w-48">
                <Label htmlFor="ex-bp">Body part</Label>
                <select
                  id="ex-bp"
                  className={cn(
                    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                  value={bodyPart}
                  onChange={(e) => setBodyPart(e.target.value)}
                >
                  {bodyParts.map((bp) => (
                    <option key={bp} value={bp}>
                      {bp === 'all' ? 'All' : bp}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid max-h-[480px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((ex) => (
                <div
                  key={ex.id}
                  className="flex flex-col rounded-lg border border-white/5 bg-black/30 p-3 text-sm"
                >
                  <ExerciseThumb ex={ex} />
                  <p className="mt-2 font-medium leading-tight">{ex.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ex.bodyPart} · {ex.targetMuscle}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground/80 line-clamp-2">
                    {ex.licenseType} · {ex.attribution}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-2 w-full"
                    onClick={() => addLine(ex, { switchToCustom: true })}
                  >
                    Add to workout
                  </Button>
                </div>
              ))}
            </div>
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground">No exercises match your filters.</p>
            )}
          </TabsContent>

          <TabsContent value="custom" className="space-y-4">
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-8 lg:items-start">
              <div className="space-y-2 lg:sticky lg:top-4">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <Label className="text-emerald-400/90">Exercise preview (sandbox)</Label>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {previewExercise?.sourceUrl && (
                      <a
                        href={previewExercise.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Source API
                      </a>
                    )}
                    <span className="text-muted-foreground/50" aria-hidden>
                      |
                    </span>
                    <a
                      href={WGER_LOGIN_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground underline-offset-2 hover:underline"
                      title="Open wger in a new tab to log in to your account"
                    >
                      Log in to wger
                    </a>
                    <span className="text-muted-foreground/50 hidden sm:inline" aria-hidden>
                      |
                    </span>
                    <span className="text-muted-foreground/90 max-w-[220px] leading-snug sm:max-w-none">
                      Your own exercises on wger are not imported here yet—use the public library below or manage
                      them on wger.
                    </span>
                  </div>
                </div>
                <div
                  className={cn(
                    'overflow-hidden rounded-xl border border-emerald-500/25 bg-zinc-950/80 shadow-inner',
                    'min-h-[min(52vh,420px)]'
                  )}
                >
                  {previewSrcDoc ? (
                    <iframe
                      title="Exercise preview"
                      className="h-[min(52vh,420px)] w-full border-0 bg-zinc-950"
                      sandbox=""
                      srcDoc={previewSrcDoc}
                    />
                  ) : (
                    <div className="flex h-[min(52vh,420px)] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                      <Dumbbell className="h-12 w-12 opacity-30" aria-hidden />
                      <p>Add exercises to your plan to see a large preview here.</p>
                      <p className="text-xs opacity-80">Tap a row below to switch which exercise is shown.</p>
                    </div>
                  )}
                </div>
                {previewExercise && (
                  <p className="text-[10px] text-muted-foreground/80">
                    Preview is isolated (sandbox). Image and text come from your library data, not a live external page.
                  </p>
                )}
              </div>

              <div className="space-y-4 min-w-0">
            <div className="space-y-3">
              {lines.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Click the exercise name to show it in the preview. Edit sets, reps, and rest for each line.
                </p>
              )}
              {lines.map((line, i) => (
                <div
                  key={`${line.exerciseId}-${i}`}
                  className={cn(
                    'rounded-lg border bg-black/30 p-3 transition-colors',
                    previewLineIndex === i
                      ? 'border-emerald-500/50 ring-1 ring-emerald-500/30'
                      : 'border-white/5'
                  )}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] sm:items-center sm:gap-2">
                  <div className="min-w-0 flex items-start gap-2">
                    <button
                      type="button"
                      className={cn(
                        'text-left font-medium leading-tight underline-offset-2 hover:underline',
                        previewLineIndex === i ? 'text-emerald-300' : 'text-foreground'
                      )}
                      onClick={() => setPreviewLineIndex(i)}
                    >
                      {line.name}
                    </button>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Label htmlFor={`sets-${i}`} className="w-8 shrink-0 text-xs text-muted-foreground">
                      Sets
                    </Label>
                    <Input
                      id={`sets-${i}`}
                      type="number"
                      min={1}
                      className="w-20"
                      value={line.sets}
                      onChange={(e) => updateLine(i, { sets: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Label htmlFor={`reps-${i}`} className="w-8 shrink-0 text-xs text-muted-foreground">
                      Reps
                    </Label>
                    <Input
                      id={`reps-${i}`}
                      type="number"
                      min={1}
                      className="w-20"
                      value={line.reps}
                      onChange={(e) => updateLine(i, { reps: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Label htmlFor={`rest-${i}`} className="w-10 shrink-0 text-xs text-muted-foreground">
                      Rest
                    </Label>
                    <Input
                      id={`rest-${i}`}
                      type="number"
                      min={0}
                      className="w-20"
                      value={line.restSec}
                      onChange={(e) => updateLine(i, { restSec: Number(e.target.value) || 0 })}
                    />
                    <span className="text-xs text-muted-foreground">s</span>
                  </div>
                  <div className="flex items-center justify-end sm:justify-center">
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="Remove exercise">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={copyExport}>
                <Copy className="mr-2 h-4 w-4" />
                Copy plan to clipboard
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={lines.length === 0}
                onClick={() => {
                  setLines([]);
                  persist({ lines: [] });
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Clear plan
              </Button>
            </div>

            <pre className="max-h-40 overflow-auto rounded-md bg-muted/30 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
              {exportText()}
            </pre>

            <div className="space-y-2 border-t border-white/10 pt-4">
              <Label htmlFor="add-exercise-select">Add exercise</Label>
              <select
                id="add-exercise-select"
                value={addExerciseId}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(e) => {
                  const id = e.target.value;
                  setAddExerciseId('');
                  if (!id) return;
                  const ex = exercises.find((x) => x.id === id);
                  if (ex) addLine(ex);
                }}
              >
                <option value="">Choose an exercise to add…</option>
                {exercises.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name} ({ex.bodyPart})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                Pick an exercise to append to your plan. You can add the same exercise more than once if needed.
              </p>
            </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        ) : null}
      </CardContent>
    </Card>
  );
}
