import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { RecipeCard } from '@/components/fuel/recipe-card';
import { MealPlanPanel } from '@/components/fuel/meal-plan-panel';
import type { RecipeData } from '@/types/ai';
import {
  fallbackRecipes,
} from '@/lib/content/wellness-content';
import { isRecipeSafe, matchesPreference } from '@/lib/nutrition/recipe-filter';
import { findYouTubeVideoByQuery, getYouTubeDurationsByUrl } from '@/lib/youtube-metadata';

export const metadata = { title: 'Recipes - FitNexus' };

interface RemoteWellnessContent {
  recipes?: RecipeData[];
}

function normalize(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

async function loadRemoteContent(): Promise<RemoteWellnessContent | null> {
  const url = process.env.CONTENT_FEED_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, { next: { revalidate: 1800 } }); // 30 mins
    return res.ok ? (await res.json()) : null;
  } catch {
    return null;
  }
}

export default async function RecipesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;

  const params = (await searchParams) || {};
  const query = typeof params.q === 'string' ? params.q.toLowerCase().trim() : '';
  const cuisine = typeof params.cuisine === 'string' ? params.cuisine.toLowerCase().trim() : '';
  const maxPrep = typeof params.maxPrep === 'string' ? Number(params.maxPrep) : NaN;
  const focusRecipe = typeof params.focus === 'string' ? params.focus.toLowerCase().trim() : '';

  const [profile, remote] = await Promise.all([
    prisma.healthProfile.findUnique({
      where: { userId: session.user.id },
      select: { dietaryPreference: true, dietaryRestrictions: true },
    }),
    loadRemoteContent(),
  ]);
  const latestMealPlan = await prisma.mealPlan.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      items: {
        include: {
          recipe: {
            include: { nutritionFacts: true },
          },
        },
      },
    },
  });
  const latestPlanMeals = Array.isArray((latestMealPlan?.planJson as Record<string, unknown> | undefined)?.meals)
    ? (((latestMealPlan?.planJson as Record<string, unknown>).meals as Record<string, unknown>[]))
    : [];
  const plannedMeals = latestPlanMeals
    .map((meal, sourceMealIndex) => ({ meal, sourceMealIndex }))
    .filter(({ meal }) => meal.planned === true);

  const dietPref = profile?.dietaryPreference || 'BALANCED';
  const restrictions = profile?.dietaryRestrictions || [];

  const allRecipes: RecipeData[] = remote?.recipes?.length
    ? (remote.recipes as RecipeData[])
    : fallbackRecipes;
  const safe = (recipe: RecipeData) => isRecipeSafe(recipe, restrictions);

  let baseRecipes: RecipeData[] = allRecipes
    .filter(safe)
    .filter((recipe: RecipeData) => matchesPreference(recipe, dietPref));
  let relaxedNote: string | null = null;

  if (baseRecipes.length === 0) {
    const preferenceFallback = allRecipes.filter(safe);
    if (preferenceFallback.length > 0) {
      baseRecipes = preferenceFallback;
      relaxedNote =
        'No recipes matched your diet style exactly; showing options that still respect your restrictions.';
    }
  }

  if (query) {
    baseRecipes = baseRecipes.filter((recipe) =>
      [recipe.name, recipe.description, ...recipe.ingredients, ...(recipe.dietaryTags || [])]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }
  if (cuisine) {
    baseRecipes = baseRecipes.filter((recipe) => recipe.description.toLowerCase().includes(cuisine));
  }
  if (Number.isFinite(maxPrep)) {
    baseRecipes = baseRecipes.filter((recipe) => {
      const prep = Number((recipe.prepTime || '').replace(/[^0-9]/g, ''));
      return Number.isFinite(prep) ? prep <= maxPrep : true;
    });
  }

  if (baseRecipes.length === 0) {
    baseRecipes = fallbackRecipes.filter(safe);
    if (baseRecipes.length > 0) {
      relaxedNote =
        'Showing curated defaults that match your safety filters. Adjust profile settings for more variety.';
    }
  }

  const generatedRecipes: RecipeData[] =
    latestMealPlan?.items
      .filter((item) => !!item.recipe)
      .map((item) => {
        const fromPlan = latestPlanMeals.find((m) =>
          String(m.title || '').trim().toLowerCase() === item.title.trim().toLowerCase() &&
          Number(m.dayIndex || 0) === item.dayIndex &&
          String(m.slot || '').toUpperCase() === item.slot
        );
        const planIngredients = Array.isArray(fromPlan?.ingredients)
          ? (fromPlan!.ingredients as Array<string | Record<string, unknown>>).map((ing) => {
              if (typeof ing === 'string') return ing;
              const n = String(ing.name || '').trim();
              const q = Number(ing.quantity || 0);
              const u = String(ing.unit || '').trim();
              return `${q > 0 ? `${q}${u ? ` ${u}` : ''} ` : ''}${n}`.trim();
            }).filter(Boolean)
          : [];
        return {
        id: item.recipe!.id,
        name: item.title,
        description: item.recipe?.source === 'meal_plan_generated' ? 'Generated from your current meal plan' : (item.recipe?.source || 'Meal plan recipe'),
        prepTime: '20 min',
        cookTime: '20 min',
        servings: Math.max(1, Math.round(item.recipe?.servings || 1)),
        ingredients: planIngredients.length > 0 ? planIngredients : ['See meal plan instructions'],
        instructions: item.recipe?.instructions ? item.recipe.instructions.split('\n').filter(Boolean) : ['Follow your meal plan guidance for preparation.'],
        dietaryTags: [dietPref.replace('_', ' ')],
        cookVideoUrl: item.videoUrl || undefined,
        cookVideoTitle: item.videoTitle || undefined,
        cookVideoDuration: item.videoDuration || undefined,
        kcal: item.calories ?? item.recipe?.nutritionFacts?.calories ?? undefined,
        proteinG: item.proteinG ?? item.recipe?.nutritionFacts?.proteinG ?? undefined,
        carbsG: item.carbsG ?? item.recipe?.nutritionFacts?.carbsG ?? undefined,
        fatsG: item.fatsG ?? item.recipe?.nutritionFacts?.fatsG ?? undefined,
      };
      })
      .filter((r, idx, arr) => arr.findIndex((x) => x.id === r.id) === idx) ?? [];
  const generatedRecipeIds = new Set(generatedRecipes.map((recipe) => recipe.id));

  const inspireFoodRecipes = fallbackRecipes.slice(0, 3);
  const inspireNames = new Set(inspireFoodRecipes.map((r) => r.name.toLowerCase()));

  const dedupByName = (recipes: RecipeData[]) => {
    const map = new Map<string, RecipeData>();
    for (const recipe of recipes) {
      const key = recipe.name.toLowerCase().trim();
      if (!map.has(key)) map.set(key, recipe);
    }
    return Array.from(map.values());
  };

  const combinedRecipes = dedupByName([...generatedRecipes, ...baseRecipes]).filter((recipe) => {
    const isInspireDish = inspireNames.has(recipe.name.toLowerCase());
    if (focusRecipe && recipe.name.toLowerCase() === focusRecipe) return true;
    return !isInspireDish;
  });

  const recipeWithVideos = await Promise.all(
    combinedRecipes.map(async (recipe: RecipeData) => {
      if (recipe.cookVideoUrl) return recipe;
      const match = await findYouTubeVideoByQuery(`${recipe.name} full recipe tutorial not shorts`);
      if (!match) return recipe;
      return {
        ...recipe,
        cookVideoUrl: match.url,
        cookVideoTitle: recipe.cookVideoTitle || match.title,
      };
    })
  );

  const durationSources = [
    ...recipeWithVideos.map((r: RecipeData) => r.cookVideoUrl).filter(Boolean) as string[],
  ];
  const durationByUrl = await getYouTubeDurationsByUrl(durationSources);

  const enrichedRecipes = recipeWithVideos.map((recipe: RecipeData) => ({
    ...recipe,
    cookVideoDuration:
      (recipe.cookVideoUrl ? durationByUrl[recipe.cookVideoUrl] : undefined)
      || recipe.cookVideoDuration,
  }));
  const sortedRecipes = focusRecipe
    ? [...enrichedRecipes].sort((a, b) => {
        const af = a.name.toLowerCase() === focusRecipe ? 1 : 0;
        const bf = b.name.toLowerCase() === focusRecipe ? 1 : 0;
        return bf - af;
      })
    : enrichedRecipes;
  const recipeByNormalizedName = new Map<string, RecipeData>();
  const allRecipeSources = dedupByName([
    ...allRecipes,
    ...generatedRecipes,
    ...inspireFoodRecipes,
    ...sortedRecipes,
  ]);
  for (const recipe of allRecipeSources) {
    recipeByNormalizedName.set(normalize(recipe.name), recipe);
  }
  const usingDefaultCatalog =
    !remote?.recipes?.length ||
    (typeof relaxedNote === 'string' && relaxedNote.toLowerCase().includes('curated defaults'));

  return (
    <div className="container max-w-6xl mx-auto py-8 space-y-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight gradient-text">Your Kitchen</h1>
        <p className="text-muted-foreground">
          Showing {dietPref.toLowerCase().replace('_', ' ')} recipes
          {restrictions.length > 0 && ` excluding: ${restrictions.join(', ')}`}.
        </p>
        <p className="text-xs text-muted-foreground">
          Filters: search by `?q=`, cuisine by `?cuisine=`, prep by `?maxPrep=`.
        </p>
      </header>

      <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <h2 className="text-sm font-semibold text-amber-200">Food Safety Note</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-100/90">
          <li>AI can make mistakes, so please recheck all ingredients based on your food dietary restrictions.</li>
          <li>Please review labels and substitutions in your kitchen before cooking.</li>
        </ul>
      </section>

      {relaxedNote && (
        <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary-foreground/90">
          {relaxedNote}
        </div>
      )}

      <main className="space-y-12">
        <section>
          <MealPlanPanel
            initialPlan={
              latestMealPlan
                ? {
                    planJson: latestMealPlan.planJson,
                    fallbackUsed: latestMealPlan.fallbackUsed,
                    createdAt: latestMealPlan.createdAt.toISOString(),
                    modelUsed: latestMealPlan.modelUsed,
                    items: latestMealPlan.items.map((it) => ({
                      dayIndex: it.dayIndex,
                      slot: it.slot,
                      title: it.title,
                      calories: it.calories,
                      proteinG: it.proteinG,
                      carbsG: it.carbsG,
                      fatsG: it.fatsG,
                    })),
                  }
                : null
            }
          />
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Inspire Me - Food</h2>
          <p className="text-sm text-muted-foreground">Light, food-focused inspiration from your intake lane.</p>
          <div className="rounded-xl border border-primary/20 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {inspireFoodRecipes.map((dish) => (
              <div key={dish.id}>
                <RecipeCard recipe={dish} source={{ fallbackUsed: true }} />
              </div>
            ))}
            </div>
          </div>
        </section>
        {plannedMeals.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Planned Meals</h2>
            <p className="text-sm text-muted-foreground">Meals you added with + Meal from today&apos;s meal plan.</p>
            <div className="max-h-[44rem] overflow-y-auto pr-1">
              <div className="space-y-4">
              {plannedMeals.map(({ meal, sourceMealIndex }, idx) => (
                (() => {
                  const matchedRecipe = recipeByNormalizedName.get(normalize(String(meal.title || '')));
                  return (
                <RecipeCard
                  key={`planned-${idx}-${String(meal.title || 'meal')}`}
                  plannedMealIndex={sourceMealIndex}
                  source={{
                    fallbackUsed: latestMealPlan?.fallbackUsed ?? true,
                    modelUsed: latestMealPlan?.modelUsed ?? null,
                  }}
                  recipe={{
                    id: `planned-${idx}-${String(meal.title || 'meal')}`,
                    name: String(meal.title || 'Planned Meal'),
                    description:
                      typeof meal.description === 'string' && meal.description.trim().length > 0
                        ? meal.description
                        : (matchedRecipe?.description || 'Planned meal from your personalized meal planner.'),
                    prepTime: '15 min',
                    cookTime: String(meal.cookTime || '20 min'),
                    servings: Number(meal.servings || 1),
                    ingredients: Array.isArray(meal.ingredients)
                      ? (meal.ingredients as Array<string | Record<string, unknown>>).map((ing) => {
                          if (typeof ing === 'string') return ing;
                          const n = String(ing.name || '').trim();
                          const q = Number(ing.quantity || 0);
                          const u = String(ing.unit || '').trim();
                          return `${q > 0 ? `${q}${u ? ` ${u}` : ''} ` : ''}${n}`.trim();
                        }).filter(Boolean)
                      : (matchedRecipe?.ingredients || []),
                    instructions: Array.isArray(meal.instructions) && meal.instructions.length > 0
                      ? meal.instructions.map(String)
                      : (matchedRecipe?.instructions || ['Follow your planned meal instructions.']),
                    dietaryTags: Array.isArray(meal.dietaryTags) && meal.dietaryTags.length > 0
                      ? meal.dietaryTags.map(String)
                      : (matchedRecipe?.dietaryTags || [dietPref.replace('_', ' ')]),
                    cookVideoUrl:
                      typeof meal.cookVideoUrl === 'string' && meal.cookVideoUrl.length > 0
                        ? meal.cookVideoUrl
                        : matchedRecipe?.cookVideoUrl,
                    cookVideoTitle:
                      typeof meal.cookVideoTitle === 'string' && meal.cookVideoTitle.length > 0
                        ? meal.cookVideoTitle
                        : matchedRecipe?.cookVideoTitle,
                    cookVideoDuration: matchedRecipe?.cookVideoDuration,
                    foodFact:
                      typeof meal.foodFact === 'string' && meal.foodFact.length > 0
                        ? meal.foodFact
                        : matchedRecipe?.foodFact,
                    kcal: typeof meal.nutrition === 'object' && meal.nutrition ? Number((meal.nutrition as Record<string, unknown>).calories || 0) : undefined,
                    proteinG: typeof meal.nutrition === 'object' && meal.nutrition ? Number((meal.nutrition as Record<string, unknown>).protein || 0) : undefined,
                    carbsG: typeof meal.nutrition === 'object' && meal.nutrition ? Number((meal.nutrition as Record<string, unknown>).carbs || 0) : undefined,
                    fatsG: typeof meal.nutrition === 'object' && meal.nutrition ? Number((meal.nutrition as Record<string, unknown>).fats || 0) : undefined,
                  }}
                />
                  );
                })()
              ))}
              </div>
            </div>
          </section>
        ) : null}
        <section>
          <div className="mb-3">
            <h2 className="text-lg font-semibold">
              {usingDefaultCatalog ? 'Default Catalog Recipes' : 'Recommended Recipes'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {usingDefaultCatalog
                ? 'Shown from built-in default catalog because remote feed is unavailable or filtered out.'
                : 'Shown from your personalized recipe feed.'}
            </p>
          </div>
          {sortedRecipes.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {sortedRecipes.map((recipe: RecipeData) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  forceOpen={!!focusRecipe && recipe.name.toLowerCase() === focusRecipe}
                  source={
                    generatedRecipeIds.has(recipe.id)
                      ? {
                          fallbackUsed: latestMealPlan?.fallbackUsed ?? true,
                          modelUsed: latestMealPlan?.modelUsed ?? null,
                        }
                      : {
                          fallbackUsed: usingDefaultCatalog,
                          labelOverride: usingDefaultCatalog ? 'Fallback' : 'Curated',
                        }
                  }
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed p-12 text-center space-y-3">
              <h3 className="text-lg font-medium">No matches found</h3>
              <p className="text-muted-foreground max-w-sm mx-auto">
                We couldn&apos;t find recipes that meet all your dietary restrictions. Try adjusting your profile settings.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}