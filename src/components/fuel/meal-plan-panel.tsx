'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, Sparkles } from 'lucide-react';
import { AiSourceBadge } from '@/components/ui/ai-source-badge';

const SHOPPING_LIST_UPDATED_EVENT = 'shopping-list-updated';
const SHOPPING_NOTEPAD_ENABLED_KEY = 'shopping-notepad-enabled';

function emitShoppingListUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SHOPPING_LIST_UPDATED_EVENT));
}

function enableShoppingNotepad() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SHOPPING_NOTEPAD_ENABLED_KEY, '1');
}

type MealPlanJson = {
  meals?: Array<{
    dayIndex?: number;
    slot?: string;
    title?: string;
    nutrition?: {
      calories?: number | string;
      protein?: number | string;
      carbs?: number | string;
      fats?: number | string;
      proteinG?: number | string;
      carbsG?: number | string;
      fatsG?: number | string;
    };
    calories?: number;
    proteinG?: number;
    carbsG?: number;
    fatsG?: number;
    ingredients?: Array<
      | string
      | {
          name?: string;
          quantity?: number | string;
          unit?: string;
        }
    >;
    instructions?: string[];
    planned?: boolean;
    pinned?: boolean;
    cookTime?: string;
    cookVideoUrl?: string | null;
  }>;
  days?: Array<{
    dayIndex?: number;
    meals?: Array<{
      dayIndex?: number;
      slot?: string;
      title?: string;
      nutrition?: {
        calories?: number | string;
        protein?: number | string;
        carbs?: number | string;
        fats?: number | string;
        proteinG?: number | string;
        carbsG?: number | string;
        fatsG?: number | string;
      };
      calories?: number;
      proteinG?: number;
      carbsG?: number;
      fatsG?: number;
      ingredients?: Array<
        | string
        | {
            name?: string;
            quantity?: number | string;
            unit?: string;
          }
      >;
      instructions?: string[];
      planned?: boolean;
      pinned?: boolean;
      cookTime?: string;
      cookVideoUrl?: string | null;
    }>;
  }>;
  note?: string;
};
type MealEntry = NonNullable<MealPlanJson['meals']>[number];

export function MealPlanPanel({
  initialPlan,
}: {
  initialPlan:
    | {
        planJson: unknown;
        fallbackUsed: boolean;
        createdAt: string;
        modelUsed?: string | null;
        items?: Array<{
          dayIndex?: number;
          slot?: string;
          title?: string;
          calories?: number | null;
          proteinG?: number | null;
          carbsG?: number | null;
          fatsG?: number | null;
        }>;
      }
    | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [plan, setPlan] = useState(initialPlan);
  const [shoppingCount, setShoppingCount] = useState<number | null>(null);
  const isDev = process.env.NODE_ENV !== 'production';

  const normalizePlanPayload = (
    payload: unknown
  ): {
    planJson: unknown;
    fallbackUsed: boolean;
    createdAt: string;
    modelUsed?: string | null;
    items?: Array<{
      dayIndex?: number;
      slot?: string;
      title?: string;
      calories?: number | null;
      proteinG?: number | null;
      carbsG?: number | null;
      fatsG?: number | null;
    }>;
  } | null => {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    const mealPlan = p.mealPlan as Record<string, unknown> | undefined;
    const planJson = (mealPlan?.planJson ?? p.planJson ?? p.plan ?? {}) as unknown;
    const fallbackUsed = Boolean(p.fallbackUsed);
    const modelUsed = typeof p.modelUsed === 'string' ? p.modelUsed : (typeof mealPlan?.modelUsed === 'string' ? mealPlan.modelUsed : null);
    const items = Array.isArray(p.items)
      ? (p.items as Array<{
      dayIndex?: number;
      slot?: string;
      title?: string;
      calories?: number | null;
      proteinG?: number | null;
      carbsG?: number | null;
      fatsG?: number | null;
    }>)
      : Array.isArray(mealPlan?.items)
        ? (mealPlan.items as Array<{
      dayIndex?: number;
      slot?: string;
      title?: string;
      calories?: number | null;
      proteinG?: number | null;
      carbsG?: number | null;
      fatsG?: number | null;
    }>)
        : undefined;
    return { planJson, fallbackUsed, createdAt: new Date().toISOString(), modelUsed, items };
  };

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: weekly ? 'weekly' : 'daily', mealsPerDay: 3 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      toast({ title: 'Meal plan ready', description: 'Your AI meal plan was saved.', variant: 'success' });
      setPlan(normalizePlanPayload(data) ?? plan);
      await refreshShoppingList();
    } catch (e) {
      toast({
        title: 'Could not generate',
        description: (e as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const refreshShoppingList = async () => {
    const listRes = await fetch('/api/shopping-list');
    const listJson = await listRes.json().catch(() => ({ items: [] }));
    if (Array.isArray(listJson.items)) {
      const items = listJson.items as Array<{ id: string }>;
      setShoppingCount(items.length);
      if (items.length > 0) {
        enableShoppingNotepad();
      }
      emitShoppingListUpdated();
    }
  };

  const addShoppingItem = async (
    name: string,
    quantity = 1,
    unit = 'each',
    category?: string
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const res = await fetch('/api/shopping-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, quantity, unit, category }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not add shopping item');
      enableShoppingNotepad();
      emitShoppingListUpdated();
      await refreshShoppingList();
      toast({ title: 'Added to shopping list', description: trimmed, variant: 'success' });
    } catch (e) {
      toast({
        title: 'Could not add item',
        description: (e as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };


  const patchPlan = async (action: 'pin' | 'togglePin' | 'togglePlanned' | 'regenerate', mealIndex?: number) => {
    setLoading(true);
    try {
      const res = await fetch('/api/meal-plans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          mealIndex,
          title: action === 'pin' ? 'Pinned meal' : 'Regenerated meal',
          slot: 'SNACK',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      const next = data.mealPlan?.mealPlan ?? data.mealPlan;
      setPlan(normalizePlanPayload(next) ?? plan);
      await refreshShoppingList();
      router.refresh();
      toast({ title: 'Meal plan updated', variant: 'success' });
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const pj = plan?.planJson as MealPlanJson | undefined;
  const meals = pj?.meals ?? [];

  const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const getMealNutrition = (meal: MealEntry, idx: number) => {
    const item = plan?.items?.find(
      (it) =>
        (it.dayIndex ?? 0) === (meal.dayIndex ?? 0) &&
        it.slot?.toString().toUpperCase() === meal.slot?.toString().toUpperCase() &&
        it.title?.trim().toLowerCase() === meal.title?.trim().toLowerCase()
    ) ?? plan?.items?.[idx];
    const calories =
      toNumber(meal.nutrition?.calories) ??
      toNumber(meal.calories) ??
      toNumber(item?.calories) ??
      0;
    const protein =
      toNumber(meal.nutrition?.protein) ??
      toNumber(meal.nutrition?.proteinG) ??
      toNumber(meal.proteinG) ??
      toNumber(item?.proteinG) ??
      0;
    const carbs =
      toNumber(meal.nutrition?.carbs) ??
      toNumber(meal.nutrition?.carbsG) ??
      toNumber(meal.carbsG) ??
      toNumber(item?.carbsG) ??
      0;
    const fats =
      toNumber(meal.nutrition?.fats) ??
      toNumber(meal.nutrition?.fatsG) ??
      toNumber(meal.fatsG) ??
      toNumber(item?.fatsG) ??
      0;
    return { calories, protein, carbs, fats };
  };

  const formatIngredient = (
    ing: string | { name?: string; quantity?: number | string; unit?: string }
  ) => {
    if (typeof ing === 'string') return ing;
    const name = ing.name?.trim() || 'ingredient';
    const qty = ing.quantity ?? '';
    const unit = ing.unit?.trim() ?? '';
    return `${qty}${qty && unit ? ' ' : ''}${unit}${qty || unit ? ' ' : ''}${name}`.trim();
  };

  const flattenedMeals =
    meals.length > 0
      ? meals.map((meal, idx) => ({ meal, idx }))
      : (pj?.days ?? []).flatMap((d, dIdx) =>
          (d.meals ?? []).map((meal, idx) => ({
            meal: { ...meal, dayIndex: meal.dayIndex ?? d.dayIndex ?? dIdx },
            idx: dIdx * 100 + idx,
          }))
        );
  const hasWeeklyData = flattenedMeals.some(({ meal }) => (meal.dayIndex ?? 0) > 0) || (pj?.days?.length ?? 0) > 1;
  const pinnedMeals = flattenedMeals.filter(({ meal }) => meal.pinned === true);
  const regularMealsBase = flattenedMeals.filter(({ meal }) => meal.pinned !== true);
  const regularDaily = regularMealsBase.filter(({ meal }) => (meal.dayIndex ?? 0) === 0);
  const mealsToShow = weekly && hasWeeklyData ? regularMealsBase : regularDaily.length > 0 ? regularDaily : regularMealsBase;
  const groupedByDay = mealsToShow.reduce<Record<number, typeof mealsToShow>>((acc, entry) => {
    const day = entry.meal.dayIndex ?? 0;
    if (!acc[day]) acc[day] = [];
    acc[day].push(entry);
    return acc;
  }, {});
  useEffect(() => {
    void refreshShoppingList();
  }, []);

  return (
    <Card className="border-primary/15">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Today&apos;s meal plan
          </CardTitle>
          <CardDescription>
            3-step AI pipeline with tool-validated nutrition. Uses your TDEE targets and catalog RAG.
          </CardDescription>
        </div>
        <Button size="sm" onClick={generate} disabled={loading} className="shrink-0 gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Generate
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Weekly</label>
          <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
        </div>
        {typeof shoppingCount === 'number' ? (
          <p className="text-xs text-muted-foreground">Shopping list items: {shoppingCount}</p>
        ) : null}
        <AiSourceBadge
          fallbackUsed={plan?.fallbackUsed ?? true}
          modelUsed={plan?.modelUsed ?? null}
          className="w-fit"
        />
        {isDev ? (
          <p className="text-[11px] text-muted-foreground">
            Dev source: {plan?.fallbackUsed ? 'fallback' : 'ai'}{plan?.modelUsed ? ` (${plan.modelUsed})` : ''}
          </p>
        ) : null}
        {pj?.note ? <p className="text-xs text-muted-foreground">{pj.note}</p> : null}
        {flattenedMeals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meals yet — tap Generate.</p>
        ) : (
          <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {Object.entries(groupedByDay)
              .sort((a, b) => Number(a[0]) - Number(b[0]))
              .map(([day, entries]) => (
                <div key={day} className="space-y-2">
                  {weekly && hasWeeklyData ? (
                    <p className="text-xs font-semibold text-muted-foreground">Day {Number(day) + 1}</p>
                  ) : null}
                  <ul className="space-y-2">
                    {entries.map(({ meal: m, idx }) => (
                      <li
                        key={`${day}-${idx}-${m.title ?? 'meal'}`}
                        className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium">{m.title ?? 'Meal'}</div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => patchPlan('regenerate')}
                              disabled={loading}
                            >
                              Regenerate
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => patchPlan('pin', idx)}
                              disabled={loading}
                            >
                              Pin
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px]"
                              onClick={() =>
                                void addShoppingItem(
                                  m.title ?? 'Prepared meal',
                                  1,
                                  'item',
                                  'Ready meals'
                                )
                              }
                              disabled={loading}
                            >
                              Ready food
                            </Button>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground capitalize">{m.slot ?? ''}</div>
                        <div className="text-xs mt-1 font-mono">
                          {(() => {
                            const n = getMealNutrition(m, idx);
                            return (
                              <>
                                {Math.round(n.calories)} kcal · P{Math.round(n.protein)} · C{Math.round(n.carbs)} · F
                                {Math.round(n.fats)}
                              </>
                            );
                          })()}
                        </div>
                        {Array.isArray(m.ingredients) && m.ingredients.length > 0 ? (
                          <div className="mt-2">
                            <p className="text-[11px] font-medium text-foreground/90">Ingredients</p>
                            <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
                              {m.ingredients.slice(0, 6).map((ing, ingIdx) => (
                                <li key={ingIdx} className="flex items-center justify-between gap-2">
                                  <span>{formatIngredient(ing)}</span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-[10px] shrink-0"
                                    onClick={() => void addShoppingItem(formatIngredient(ing))}
                                    disabled={loading}
                                  >
                                    Add
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {Array.isArray(m.instructions) && m.instructions.length > 0 ? (
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Recipe: {m.instructions[0]}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
        {pinnedMeals.length > 0 ? (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-semibold text-muted-foreground">Pin Board</p>
            <ul className="max-h-24 space-y-1 overflow-y-auto pr-1">
              {pinnedMeals.map(({ meal: m, idx: sourceMealIdx }, idx) => (
                <li key={`pinned-${idx}-${m.title ?? 'meal'}`} className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium leading-tight">{m.title ?? 'Pinned Meal'}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{m.slot ?? ''}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={m.planned ? 'default' : 'outline'}
                        className="h-6 px-2 text-[10px]"
                        onClick={() => patchPlan('togglePlanned', sourceMealIdx)}
                        disabled={loading}
                      >
                        {m.planned ? 'Added' : 'Add'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => patchPlan('togglePin', sourceMealIdx)}
                        disabled={loading}
                      >
                        Unpin
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
