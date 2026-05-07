'use client';

import { useState } from 'react';
import { Clock, PlayCircle, Tag, Trash2, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { RecipeData } from '@/types/ai';
import { resolveVideoIframeSrc } from '@/lib/youtube-embed';
import { AiSourceBadge } from '@/components/ui/ai-source-badge';

interface RecipeCardProps {
  recipe: RecipeData;
  forceOpen?: boolean;
  plannedMealIndex?: number;
  source?: {
    fallbackUsed?: boolean;
    modelUsed?: string | null;
    labelOverride?: string;
  };
}

export function RecipeCard({ recipe, forceOpen = false, plannedMealIndex, source }: RecipeCardProps) {
  const hasVideo = Boolean(recipe.cookVideoUrl);
  const [open, setOpen] = useState(forceOpen);
  const [removing, setRemoving] = useState(false);
  const router = useRouter();

  const removeFromPlannedMeals = async () => {
    if (typeof plannedMealIndex !== 'number') return;
    setRemoving(true);
    try {
      await fetch('/api/meal-plans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'togglePlanned',
          mealIndex: plannedMealIndex,
        }),
      });
      router.refresh();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold">{recipe.name}</h3>
          <div className="flex items-center gap-1.5 shrink-0">
            <AiSourceBadge
              fallbackUsed={source?.fallbackUsed ?? true}
              modelUsed={source?.modelUsed ?? null}
              labelOverride={source?.labelOverride}
            />
            {typeof plannedMealIndex === 'number' ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label="Delete from planned meals"
                onClick={removeFromPlannedMeals}
                disabled={removing}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-3">{recipe.description}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {recipe.prepTime} prep
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {recipe.cookTime} cook
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" /> {recipe.servings} portions
          </span>
          {recipe.difficulty && <span>{recipe.difficulty}</span>}
          {recipe.cookVideoDuration && (
            <span className="flex items-center gap-1 text-primary">
              <PlayCircle className="h-3 w-3" /> {recipe.cookVideoDuration}
            </span>
          )}
          {typeof recipe.kcal === 'number' && (
            <span className="font-medium text-foreground">{Math.round(recipe.kcal)} kcal</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {recipe.dietaryTags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground"
            >
              <Tag className="h-2.5 w-2.5" /> {tag}
            </span>
          ))}
          {recipe.dietaryTags.length > 4 && (
            <span className="text-[10px] text-muted-foreground">+{recipe.dietaryTags.length - 4}</span>
          )}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            >
              <PlayCircle className="h-4 w-4" />
              {hasVideo ? 'View recipe & video' : 'View full recipe'}
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[min(95vw,960px)] max-h-[90vh] max-w-4xl overflow-y-auto bg-background/85 backdrop-blur-xl border-primary/30">
            <DialogHeader>
              <DialogTitle>{recipe.name}</DialogTitle>
              <DialogDescription>{recipe.description}</DialogDescription>
            </DialogHeader>

            {hasVideo && (
              <div className="mx-auto aspect-video w-full max-w-[900px] overflow-hidden rounded-lg border border-primary/20 bg-black/70">
                <iframe
                  src={resolveVideoIframeSrc(recipe.cookVideoUrl!)}
                  title={recipe.cookVideoTitle || `${recipe.name} video`}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium mb-1">Ingredients</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                  {recipe.ingredients.map((ing) => (
                    <li key={ing}>{ing}</li>
                  ))}
                </ul>
              </div>
              {typeof recipe.kcal === 'number' ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                  <p className="text-[11px] font-medium text-primary">
                    Nutrition: {Math.round(recipe.kcal)} kcal · P{Math.round(recipe.proteinG ?? 0)} · C{Math.round(recipe.carbsG ?? 0)} · F{Math.round(recipe.fatsG ?? 0)}
                  </p>
                </div>
              ) : null}
              <div>
                <p className="text-xs font-medium mb-1">Steps</p>
                <ol className="space-y-1 text-xs text-muted-foreground list-decimal list-inside">
                  {recipe.instructions.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
              {recipe.foodFact && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                  <p className="text-[11px] font-medium text-primary">Food fact</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{recipe.foodFact}</p>
                </div>
              )}
            </div>

            {hasVideo && (
              <div className="flex justify-end pt-2">
                <Button asChild variant="ghost" size="sm" className="text-primary">
                  <a href={recipe.cookVideoUrl} target="_blank" rel="noreferrer">
                    Open on YouTube
                  </a>
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
