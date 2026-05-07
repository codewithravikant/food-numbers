'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

interface MealLogRecapProps {
  meals: Array<{
    id: string;
    mealType: string;
    description?: string;
    loggedAt: string;
    mealMatchType?: 'planned' | 'outside' | null;
    matchedPlannedMealKey?: {
      dayIndex: number;
      slot: string;
      title: string;
    } | null;
  }>;
  plannedMeals: Array<{
    dayIndex: number;
    slot: string;
    title: string;
  }>;
}

const mealEmojis: Record<string, string> = {
  BREAKFAST: '🌅',
  LUNCH: '☀️',
  DINNER: '🌙',
  SNACK: '🍎',
};

function plannedKey(plan: { dayIndex: number; slot: string; title: string }): string {
  return `${plan.dayIndex}::${plan.slot}::${plan.title}`.toLowerCase();
}

export function MealLogRecap({ meals, plannedMeals }: MealLogRecapProps) {
  const router = useRouter();
  const [openMealId, setOpenMealId] = useState<string | null>(null);
  const [matchType, setMatchType] = useState<'planned' | 'outside'>('outside');
  const [selectedPlannedKey, setSelectedPlannedKey] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedMeal = useMemo(
    () => meals.find((meal) => meal.id === openMealId) ?? null,
    [meals, openMealId]
  );
  const hasUntagged = meals.some((meal) => !meal.mealMatchType);
  const hasOutside = meals.some((meal) => meal.mealMatchType === 'outside');

  const selectedPlanned = useMemo(
    () => plannedMeals.find((meal) => plannedKey(meal) === selectedPlannedKey) ?? null,
    [plannedMeals, selectedPlannedKey]
  );

  const openTagDialog = (mealId: string) => {
    const meal = meals.find((entry) => entry.id === mealId);
    const existingMatchType = meal?.mealMatchType === 'planned' ? 'planned' : 'outside';
    setMatchType(existingMatchType);
    if (meal?.matchedPlannedMealKey) {
      setSelectedPlannedKey(plannedKey(meal.matchedPlannedMealKey));
    } else {
      setSelectedPlannedKey('');
    }
    setOpenMealId(mealId);
  };

  const saveTag = async () => {
    if (!selectedMeal) return;
    if (matchType === 'planned' && !selectedPlanned) {
      toast({ title: 'Pick a planned meal first', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/meals/${selectedMeal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchType,
          matchedPlannedMealKey:
            matchType === 'planned'
              ? {
                  dayIndex: selectedPlanned!.dayIndex,
                  slot: selectedPlanned!.slot,
                  title: selectedPlanned!.title,
                }
              : null,
        }),
      });
      if (!res.ok) throw new Error('Unable to tag meal');
      toast({ title: 'Meal tag saved', variant: 'success' });
      setOpenMealId(null);
      router.refresh();
    } catch {
      toast({ title: 'Failed to save tag', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (meals.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Meals</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No meals logged yet. Use the <strong>Log Meal</strong> button above to get started!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Recent Meals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {meals.slice(0, 7).map((meal) => (
          <div key={meal.id} className="flex items-center gap-3 rounded-lg bg-secondary/50 p-2">
            <span className="text-lg">{mealEmojis[meal.mealType] || '🍽️'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{meal.mealType.charAt(0) + meal.mealType.slice(1).toLowerCase()}</p>
              {meal.description && <p className="text-xs text-muted-foreground truncate">{meal.description}</p>}
              <div className="mt-1 flex items-center gap-1.5">
                {meal.mealMatchType === 'planned' && meal.matchedPlannedMealKey ? (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                    Matches plan: {meal.matchedPlannedMealKey.title}
                  </span>
                ) : meal.mealMatchType === 'outside' ? (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                    Outside plan
                  </span>
                ) : (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    Not linked to your plan yet
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => openTagDialog(meal.id)}
                >
                  Tag meal
                </Button>
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground">{formatDate(meal.loggedAt, 'MMM d')}</span>
          </div>
        ))}
        <Dialog open={!!openMealId} onOpenChange={(open) => !open && setOpenMealId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Tag meal to your plan</DialogTitle>
              <DialogDescription>
                Mark this log as matching a planned meal or as outside your current plan.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={matchType === 'planned' ? 'default' : 'outline'}
                  onClick={() => setMatchType('planned')}
                >
                  Matches planned meal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={matchType === 'outside' ? 'default' : 'outline'}
                  onClick={() => setMatchType('outside')}
                >
                  Outside plan
                </Button>
              </div>
              {matchType === 'planned' ? (
                plannedMeals.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Choose a planned meal</p>
                    <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-2">
                      {plannedMeals.map((plan) => {
                        const key = plannedKey(plan);
                        const selected = selectedPlannedKey === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setSelectedPlannedKey(key)}
                            className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                              selected
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground'
                            }`}
                          >
                            Day {plan.dayIndex + 1} - {plan.slot.toLowerCase()}: {plan.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No planned meals available yet. Generate or add meals first, or mark this as outside plan.
                  </p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  Outside-plan meals still count toward consistency. Keep logging to improve recommendations.
                </p>
              )}
              <Button type="button" className="w-full" onClick={saveTag} loading={saving}>
                Save tag
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {hasUntagged ? (
          <p className="rounded-lg border border-border/70 bg-muted/20 p-2 text-[11px] text-muted-foreground">
            Not linked to your plan yet. Tag meals to improve tracking quality and keep recommendations relevant.
          </p>
        ) : null}
        {hasOutside ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-100/90">
            Outside-plan meals are okay. Quick facts: prioritize protein, include fiber, and keep hydration steady.
            <Button asChild size="sm" variant="link" className="h-auto px-0 pl-1 text-[11px] text-amber-200">
              <Link href="/fuel/recipes">Find a matching recipe</Link>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
