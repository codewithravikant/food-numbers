'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Droplets, Apple, Flame } from 'lucide-react';
import { prefLabelsFromRestrictions } from '@/lib/dietary';

interface NutritionOverviewProps {
  dietaryPreference: string;
  dietaryRestrictions?: string[];
}

const tagFocus: Partial<Record<string, { focus: string; targets: string[] }>> = {
  'Diabetes-friendly': {
    focus: 'Favor steady carbs, fiber, and lean protein to support glucose stability',
    targets: ['Whole grains over refined', 'Non-starchy vegetables', 'Limit sugary drinks'],
  },
  Vegan: {
    focus: 'Plant proteins and B12-aware choices',
    targets: ['Legumes + whole grains', 'Fortified foods or B12', 'Variety of colors'],
  },
  Vegetarian: {
    focus: 'Complete proteins without meat',
    targets: ['Eggs or dairy if you use them', 'Iron + vitamin C pairs', 'Fish optional if pescatarian'],
  },
  Keto: {
    focus: 'Very low carb, adequate protein, higher fat from whole foods',
    targets: ['Track net carbs', 'Hydrate + electrolytes', 'Non-starchy vegetables'],
  },
};

export function NutritionOverview({ dietaryPreference, dietaryRestrictions = [] }: NutritionOverviewProps) {
  const tips = {
    HIGH_PROTEIN: { focus: 'Prioritize lean proteins at every meal', targets: ['30g+ protein per meal', '2L water daily', 'Limit processed foods'] },
    PLANT_BASED: { focus: 'Ensure complete protein combinations', targets: ['Combine legumes + grains', 'B12-rich foods', 'Iron-rich greens'] },
    LOW_CARB: { focus: 'Focus on healthy fats and fiber', targets: ['Under 50g net carbs', 'Plenty of vegetables', 'Healthy fat sources'] },
    BALANCED: { focus: 'Aim for colorful, varied meals', targets: ['50% vegetables on plate', 'Moderate portions', 'Whole food sources'] },
  };

  const current = tips[dietaryPreference as keyof typeof tips] || tips.BALANCED;
  const prefLabels = prefLabelsFromRestrictions(dietaryRestrictions);
  const extra =
    prefLabels.map((label) => tagFocus[label]).find(Boolean) ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Today&apos;s Nutrition Focus</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{current.focus}</p>
        <div className="grid grid-cols-3 gap-2">
          {current.targets.map((target, i) => {
            const icons = [Apple, Droplets, Flame];
            const Icon = icons[i];
            return (
              <div key={target} className="flex flex-col items-center gap-1 rounded-lg bg-secondary p-2 text-center">
                <Icon className="h-4 w-4 text-primary" />
                <span className="text-[10px] text-muted-foreground leading-tight">{target}</span>
              </div>
            );
          })}
        </div>
        {prefLabels.length > 0 ? (
          <p className="text-[11px] text-muted-foreground border-t pt-2">
            Additional patterns: {prefLabels.join(', ')}
          </p>
        ) : null}
        {extra ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs space-y-2">
            <p className="font-medium text-foreground/90">{extra.focus}</p>
            <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
              {extra.targets.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
