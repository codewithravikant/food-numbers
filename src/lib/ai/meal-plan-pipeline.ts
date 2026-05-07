import 'server-only';

import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { prisma } from '@/lib/prisma';
import { getModel, getOpenAI, hasOpenAIKey } from '@/lib/ai/openai-client';
import { logAiCall } from '@/lib/ai/dev-io-log';
import { deriveMacroTargets } from '@/lib/nutrition/tdee';
import { retrieveSimilarRecipes } from '@/lib/nutrition/rag';
import { embedTextOrFallback } from '@/lib/ai/embeddings';
import { calculateNutritionToolDefinition, handleCalculateNutritionToolCall } from '@/lib/ai/tools/nutrition-tools';
import { calculateNutritionFromDb } from '@/lib/nutrition/calculate-nutrition';
import type { MealType } from '@prisma/client';
import { findYouTubeVideoByQuery } from '@/lib/youtube-metadata';
import { allBannedIngredientTokens } from '@/lib/dietary';

const PIPELINE_VERSION = 'meal_plan_v2';
const DEFAULT_FALLBACK_TITLES: Record<string, string[]> = {
  BREAKFAST: [
    'Spinach Egg Scramble with Toast',
    'Greek Yogurt Berry Oats Bowl',
    'Protein Oatmeal with Banana',
  ],
  LUNCH: [
    'Grilled Chicken Quinoa Bowl',
    'Tofu Veggie Rice Bowl',
    'Lentil Chickpea Power Salad',
  ],
  DINNER: [
    'Baked Salmon with Sweet Potato',
    'Turkey Veggie Stir-Fry',
    'Paneer & Mixed Vegetable Skillet',
  ],
  SNACK: ['Apple Peanut Butter Snack', 'Cottage Cheese Fruit Bowl', 'Hummus Veggie Snack Plate'],
};

function parseMealSlot(s: unknown): MealType {
  const u = String(s ?? 'LUNCH').toUpperCase();
  if (u === 'BREAKFAST' || u === 'LUNCH' || u === 'DINNER' || u === 'SNACK') return u;
  return 'LUNCH';
}

export interface MealPlanResult {
  mealPlanId: string;
  strategy: Record<string, unknown>;
  schedule: Record<string, unknown>;
  plan: Record<string, unknown>;
  fallbackUsed: boolean;
  modelUsed: string;
}

function startEndWindow(timezone: string, days = 1) {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (!y || !m || !d) throw new Error('date');
    const start = new Date(`${y}-${m}-${d}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + Math.max(1, days) - 1);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  } catch {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
}

async function callJsonModel(system: string, user: string): Promise<Record<string, unknown>> {
  const openai = getOpenAI();
  const model = getModel();
  const request: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ] as ChatCompletionMessageParam[],
    temperature: 0.4,
    max_tokens: 2000,
    response_format: { type: 'json_object' as const },
  };
  const completion = await logAiCall({
    scope: 'meal-plan.json',
    model,
    request,
    run: () => openai.chat.completions.create(request),
    pickResponse: (c) => ({
      id: (c as { id?: string }).id,
      model: (c as { model?: string }).model,
      usage: (c as { usage?: unknown }).usage,
      choice0: (c as { choices?: any[] }).choices?.[0],
    }),
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Empty AI response');
  return JSON.parse(content) as Record<string, unknown>;
}

async function runToolLoop(
  system: string,
  user: string,
  maxRounds = 6
): Promise<{ text: string; modelUsed: string }> {
  const openai = getOpenAI();
  const model = getModel();
  const tools: ChatCompletionTool[] = [calculateNutritionToolDefinition];
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  let sawAnyToolCalls = false;
  let rounds = 0;
  while (rounds < maxRounds) {
    rounds++;
    const forceFinalize = sawAnyToolCalls && rounds >= 4;
    const request = {
      model,
      messages,
      tools,
      tool_choice: (forceFinalize ? 'none' : 'auto') as 'auto' | 'none',
      temperature: 0.35,
      max_tokens: 2500,
      ...(forceFinalize ? { response_format: { type: 'json_object' as const } } : {}),
    };
    const completion = await logAiCall({
      scope: `meal-plan.tools.round${rounds}`,
      model,
      request,
      run: () => openai.chat.completions.create(request),
      pickResponse: (c) => ({
        id: (c as { id?: string }).id,
        model: (c as { model?: string }).model,
        usage: (c as { usage?: unknown }).usage,
        choice0: (c as { choices?: any[] }).choices?.[0],
      }),
    });
    const msg = completion.choices[0]?.message;
    if (!msg) throw new Error('No message');
    messages.push(msg);

    const calls = msg.tool_calls;
    if (calls?.length) {
      sawAnyToolCalls = true;
      for (const tc of calls) {
        if (tc.type !== 'function') continue;
        const name = tc.function.name;
        const args = tc.function.arguments || '{}';
        let result = '{}';
        if (name === 'calculate_nutrition') {
          result = await handleCalculateNutritionToolCall(args);
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      if (forceFinalize) {
        messages.push({
          role: 'user',
          content:
            'Stop calling tools now. Output the final plan JSON only, using the tool results already provided.',
        });
      }
      continue;
    }

    const text = msg.content || '';
    return { text, modelUsed: model };
  }

  throw new Error('tool_loop_exhausted');
}

function extractJsonObject(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  // Prefer fenced JSON blocks if present.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) {
    const inner = fence[1].trim();
    const start = inner.indexOf('{');
    const end = inner.lastIndexOf('}');
    if (start >= 0 && end > start) return inner.slice(start, end + 1);
  }
  // Otherwise take the outermost object.
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) return t.slice(start, end + 1);
  return null;
}

function buildFallbackPlan(
  targets: ReturnType<typeof deriveMacroTargets>,
  rag: Awaited<ReturnType<typeof retrieveSimilarRecipes>>,
  days = 1,
  mealsPerDay = 3,
  bannedTokens: string[] = []
): Record<string, unknown> {
  const slots = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] as const;
  const safeRag = rag.filter((recipe) => !textContainsBannedToken(recipe.title, bannedTokens));
  const meals = Array.from({ length: days }).flatMap((_, dayIndex) =>
    Array.from({ length: mealsPerDay }).map((__, i) => {
      const slot = slots[i] ?? 'SNACK';
      const ragCandidate = safeRag[(dayIndex * mealsPerDay + i) % Math.max(safeRag.length, 1)];
      const fallbackTitle = DEFAULT_FALLBACK_TITLES[slot][(dayIndex + i) % DEFAULT_FALLBACK_TITLES[slot].length];
      const safeFallbackTitle = textContainsBannedToken(fallbackTitle, bannedTokens)
        ? `${slot[0]}${slot.slice(1).toLowerCase()} Balanced Plate`
        : fallbackTitle;
      return {
        // Keep legacy top-level macro keys for compatibility and include
        // normalized nutrition object expected by current UI.
        dayIndex,
        slot,
        title: ragCandidate?.title ?? safeFallbackTitle,
        recipeId: ragCandidate?.id ?? null,
        calories: Math.round(targets.calorieTarget / mealsPerDay),
        proteinG: Math.round(targets.proteinG / mealsPerDay),
        carbsG: Math.round(targets.carbsG / mealsPerDay),
        fatsG: Math.round(targets.fatsG / mealsPerDay),
        nutrition: {
          calories: Math.round(targets.calorieTarget / mealsPerDay),
          protein: Math.round(targets.proteinG / mealsPerDay),
          carbs: Math.round(targets.carbsG / mealsPerDay),
          fats: Math.round(targets.fatsG / mealsPerDay),
        },
        ingredients: [
          { name: 'olive oil', quantity: 10, unit: 'g' },
          { name: 'mixed vegetables', quantity: 180, unit: 'g' },
          { name: 'safe protein source', quantity: 120, unit: 'g' },
        ],
        cookVideoSuggestion: {
          query: `${slot.toLowerCase()} ${ragCandidate?.title ?? 'healthy meal'} recipe`,
        },
      };
    })
  );
  const dayBuckets = Array.from({ length: days }, (_, dayIndex) => ({
    dayIndex,
    meals: meals.filter((m) => m.dayIndex === dayIndex),
  }));
  return {
    meals,
    days: dayBuckets,
    note: 'Offline catalog plan — configure OPENROUTER_API_KEY for AI-generated recipes with tool-validated nutrition.',
  };
}

function textContainsBannedToken(text: string, bannedTokens: string[]): boolean {
  if (!text.trim() || bannedTokens.length === 0) return false;
  const normalized = text.toLowerCase();
  return bannedTokens.some((token) => normalized.includes(token.toLowerCase()));
}

function mealContainsBannedTokens(meal: Record<string, unknown>, bannedTokens: string[]): boolean {
  if (bannedTokens.length === 0) return false;
  const title = String(meal.title ?? '');
  if (textContainsBannedToken(title, bannedTokens)) return true;
  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  for (const ingredient of ingredients) {
    if (ingredient && typeof ingredient === 'object') {
      const name = String((ingredient as Record<string, unknown>).name ?? '');
      if (textContainsBannedToken(name, bannedTokens)) return true;
    }
  }
  return false;
}

function sanitizePlanForRestrictions(
  plan: Record<string, unknown>,
  bannedTokens: string[]
): Record<string, unknown> {
  if (bannedTokens.length === 0 || !Array.isArray(plan.meals)) return plan;
  const meals = (plan.meals as Record<string, unknown>[]).map((meal) => {
    if (!mealContainsBannedTokens(meal, bannedTokens)) return meal;
    const slot = normalizeSlot(meal.slot);
    return {
      ...meal,
      title: `${slot[0]}${slot.slice(1).toLowerCase()} Allergy-Safe Plate`,
      recipeId: null,
      ingredients: [
        { name: 'olive oil', quantity: 10, unit: 'g' },
        { name: 'mixed vegetables', quantity: 180, unit: 'g' },
        { name: 'safe protein source', quantity: 120, unit: 'g' },
      ],
      instructions: ['This meal was adjusted to avoid your listed restrictions.'],
    };
  });
  const days = Array.isArray(plan.days)
    ? (plan.days as Record<string, unknown>[]).map((day) => {
      const dayIndex = toNumber(day.dayIndex) ?? 0;
      return {
        ...day,
        meals: meals.filter((meal) => (toNumber(meal.dayIndex) ?? 0) === dayIndex),
      };
    })
    : plan.days;
  return { ...plan, meals, days };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, '').trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function estimateCaloriesFromMacros(protein: number, carbs: number, fats: number): number {
  return Math.max(1, Math.round(protein * 4 + carbs * 4 + fats * 9));
}

function normalizeSlot(value: unknown): MealType {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'BREAKFAST' || raw === 'LUNCH' || raw === 'DINNER' || raw === 'SNACK') return raw;
  if (raw === 'SNACKS') return 'SNACK';
  return 'LUNCH';
}

function buildPlanFromMealScheduleObject(
  schedule: Record<string, unknown>,
  options: { days: number; mealsPerDay: number },
  targets: ReturnType<typeof deriveMacroTargets>
): Record<string, unknown> | null {
  const mealSchedule =
    typeof schedule.mealSchedule === 'object' && schedule.mealSchedule
      ? (schedule.mealSchedule as Record<string, unknown>)
      : null;
  if (!mealSchedule) return null;

  const meals: Record<string, unknown>[] = [];
  const orderedDayKeys = Object.keys(mealSchedule).sort((a, b) => {
    const ai = toNumber(a.replace(/[^\d]/g, '')) ?? 0;
    const bi = toNumber(b.replace(/[^\d]/g, '')) ?? 0;
    return ai - bi;
  });

  for (const dayKey of orderedDayKeys) {
    const dayNode = mealSchedule[dayKey];
    if (!dayNode || typeof dayNode !== 'object') continue;
    const dayObj = dayNode as Record<string, unknown>;
    const inferredDay = Math.max(0, (toNumber(dayKey.replace(/[^\d]/g, '')) ?? 1) - 1);
    const slots = ['breakfast', 'lunch', 'dinner', 'snacks'];
    for (const slotKey of slots) {
      const slotNode = dayObj[slotKey];
      if (!slotNode || typeof slotNode !== 'object') continue;
      const slotObj = slotNode as Record<string, unknown>;
      const total = (slotObj.total as Record<string, unknown> | undefined) ?? {};
      const protein = Math.max(0, toNumber(total.proteinG) ?? 0);
      const carbs = Math.max(0, toNumber(total.carbsG) ?? 0);
      const fats = Math.max(0, toNumber(total.fatsG) ?? 0);
      const calories = estimateCaloriesFromMacros(protein, carbs, fats);
      const foodItems = Array.isArray(slotObj.foodItems) ? slotObj.foodItems : [];
      const title = (() => {
        const first = foodItems[0];
        if (typeof first === 'object' && first) {
          const name = String((first as Record<string, unknown>).name ?? '').trim();
          if (name) return name;
        }
        return `${slotKey[0]?.toUpperCase() ?? ''}${slotKey.slice(1)} meal`;
      })();
      const ingredients = foodItems
        .map((it) => {
          if (!it || typeof it !== 'object') return null;
          const item = it as Record<string, unknown>;
          const name = String(item.name ?? '').trim();
          if (!name) return null;
          return {
            name,
            quantity: item.quantity ?? '1 serving',
          };
        })
        .filter((v): v is { name: string; quantity: string | number } => v !== null);
      meals.push({
        dayIndex: inferredDay,
        slot: normalizeSlot(slotKey),
        title,
        nutrition: {
          calories,
          protein,
          carbs,
          fats,
        },
        ingredients,
        instructions: [],
      });
    }
  }

  if (meals.length === 0) return null;
  const dayCount = Math.max(1, options.days);
  const days = Array.from({ length: dayCount }, (_, dayIndex) => ({
    dayIndex,
    meals: meals.filter((m) => (toNumber(m.dayIndex) ?? 0) === dayIndex),
  }));
  return {
    meals,
    days,
    note:
      'AI schedule was converted to display format; recipe/tool enrichment may be partial for this run.',
    serverTargets: {
      calorieTarget: targets.calorieTarget,
      proteinG: targets.proteinG,
      carbsG: targets.carbsG,
      fatsG: targets.fatsG,
    },
  };
}

async function recoverPlanFromSchedule(
  schedule: Record<string, unknown>,
  options: { days: number; mealsPerDay: number },
  targets: ReturnType<typeof deriveMacroTargets>
): Promise<Record<string, unknown> | null> {
  const directNormalized = await normalizeAiPlan(schedule, options);
  if (hasUsablePlan(directNormalized, options.days)) return directNormalized;
  const converted = buildPlanFromMealScheduleObject(schedule, options, targets);
  if (!converted) return null;
  const convertedNormalized = await normalizeAiPlan(converted, options);
  return hasUsablePlan(convertedNormalized, options.days) ? convertedNormalized : null;
}

async function normalizeAiPlan(
  plan: Record<string, unknown>,
  options: { days: number; mealsPerDay: number }
): Promise<Record<string, unknown>> {
  const sourceMeals: Record<string, unknown>[] = [];
  if (Array.isArray(plan.days)) {
    (plan.days as Record<string, unknown>[]).forEach((day, idx) => {
      const dayMeals = Array.isArray(day.meals) ? (day.meals as Record<string, unknown>[]) : [];
      dayMeals.forEach((meal) => sourceMeals.push({ ...meal, dayIndex: toNumber(meal.dayIndex) ?? idx }));
    });
  } else if (Array.isArray(plan.meals)) {
    (plan.meals as Record<string, unknown>[]).forEach((meal, idx) => {
      const inferredDay =
        toNumber(meal.dayIndex) ??
        (options.days > 1 ? Math.min(options.days - 1, Math.floor(idx / Math.max(options.mealsPerDay, 1))) : 0);
      sourceMeals.push({ ...meal, dayIndex: inferredDay });
    });
  }
  if (sourceMeals.length === 0) return plan;

  const normalizedMeals = await Promise.all(
    sourceMeals.map(async (meal) => {
      const nutrition = (meal.nutrition as Record<string, unknown> | undefined) ?? {};
      const title = String(meal.title ?? '').trim() || `Meal ${Math.max(1, (toNumber(meal.dayIndex) ?? 0) * options.mealsPerDay + 1)}`;
      let calories =
        toNumber(nutrition.calories) ??
        toNumber(meal.calories) ??
        toNumber((meal as Record<string, unknown>).kcal);
      let protein = toNumber(nutrition.protein) ?? toNumber(nutrition.proteinG) ?? toNumber(meal.proteinG);
      let carbs = toNumber(nutrition.carbs) ?? toNumber(nutrition.carbsG) ?? toNumber(meal.carbsG);
      let fats = toNumber(nutrition.fats) ?? toNumber(nutrition.fatsG) ?? toNumber(meal.fatsG);

      const ingredientsRaw = Array.isArray(meal.ingredients) ? meal.ingredients : [];
      const normalizedIngredients = ingredientsRaw
        .map((ing) => {
          if (typeof ing !== 'object' || !ing) return null;
          const i = ing as Record<string, unknown>;
          const name = String(i.name ?? '').trim();
          const quantity = toNumber(i.quantity);
          const unit = i.unit === 'ml' ? 'ml' : 'g';
          if (!name || quantity == null || quantity <= 0) return null;
          return { name, quantity, unit } as { name: string; quantity: number; unit: 'g' | 'ml' };
        })
        .filter((v): v is { name: string; quantity: number; unit: 'g' | 'ml' } => v !== null);

      const needsToolBackfill =
        normalizedIngredients.length > 0 &&
        (calories == null ||
          calories <= 0 ||
          protein == null ||
          protein < 0 ||
          carbs == null ||
          carbs < 0 ||
          fats == null ||
          fats < 0);

      if (needsToolBackfill) {
        const servings = Math.max(0.1, toNumber(meal.servings) ?? 1);
        const computed = await calculateNutritionFromDb({ ingredients: normalizedIngredients, servings });
        calories = computed.calories;
        protein = computed.protein;
        carbs = computed.carbs;
        fats = computed.fats;
      }

      return {
        ...meal,
        title,
        dayIndex: Math.max(0, Math.floor(toNumber(meal.dayIndex) ?? 0)),
        nutrition: {
          calories: Math.max(1, calories ?? 0),
          protein: Math.max(0, protein ?? 0),
          carbs: Math.max(0, carbs ?? 0),
          fats: Math.max(0, fats ?? 0),
        },
      };
    })
  );

  const dayCount = Math.max(1, options.days);
  const dayBuckets = Array.from({ length: dayCount }, (_, dayIndex) => ({
    dayIndex,
    meals: normalizedMeals.filter((m) => (toNumber(m.dayIndex) ?? 0) === dayIndex),
  }));
  return { ...plan, meals: normalizedMeals, days: dayBuckets };
}

async function persistGeneratedRecipes(params: {
  mealPlanId: string;
  meals: Record<string, unknown>[];
  modelUsed: string;
}) {
  const itemRows = await prisma.mealPlanItem.findMany({
    where: { mealPlanId: params.mealPlanId },
    orderBy: [{ dayIndex: 'asc' }, { id: 'asc' }],
  });
  const usableMeals = params.meals;
  for (let i = 0; i < Math.min(itemRows.length, usableMeals.length); i++) {
    const item = itemRows[i];
    const meal = usableMeals[i];
    const nutrition = (meal.nutrition as Record<string, unknown> | undefined) ?? {};
    const instructions = Array.isArray(meal.instructions) ? meal.instructions.map(String).join('\n') : null;
    const title = String((meal.title ?? item.title) || `Meal ${i + 1}`);
    const servings = Math.max(1, toNumber(meal.servings) ?? 1);
    const recipe = await prisma.recipe.create({
      data: {
        title,
        servings,
        source: 'meal_plan_generated',
        instructions,
      },
    });
    await prisma.nutritionFacts.create({
      data: {
        recipeId: recipe.id,
        calories: Math.max(1, toNumber(nutrition.calories) ?? toNumber(meal.calories) ?? item.calories ?? 1),
        proteinG: Math.max(0, toNumber(nutrition.protein) ?? item.proteinG ?? 0),
        carbsG: Math.max(0, toNumber(nutrition.carbs) ?? item.carbsG ?? 0),
        fatsG: Math.max(0, toNumber(nutrition.fats) ?? item.fatsG ?? 0),
        perServing: true,
      },
    });

    const suggestion = (meal.cookVideoSuggestion as Record<string, unknown> | undefined) ?? {};
    const query = String(suggestion.query ?? `${title} recipe tutorial`);
    const yt = await findYouTubeVideoByQuery(query).catch(() => null);
    await prisma.mealPlanItem.update({
      where: { id: item.id },
      data: {
        recipeId: recipe.id,
        videoUrl: yt?.url ?? (typeof suggestion.urlCandidate === 'string' ? suggestion.urlCandidate : null),
        videoTitle: yt?.title ?? (typeof suggestion.titleCandidate === 'string' ? suggestion.titleCandidate : null),
      },
    });
    await prisma.generatedRecipeLink.create({
      data: {
        mealPlanId: params.mealPlanId,
        mealItemId: item.id,
        recipeId: recipe.id,
        source: 'meal_plan_pipeline',
        version: params.modelUsed,
      },
    });
  }
}

function hasUsablePlan(plan: Record<string, unknown>, expectedDays: number): boolean {
  const meals = Array.isArray(plan.meals) ? (plan.meals as Record<string, unknown>[]) : [];
  const days = Array.isArray(plan.days) ? (plan.days as Record<string, unknown>[]) : [];
  if (meals.length === 0) return false;
  if (expectedDays <= 1) return true;
  const distinctDayIndexes = new Set(
    meals.map((m) => Math.max(0, Math.floor(toNumber((m as Record<string, unknown>).dayIndex) ?? 0)))
  );
  const coveredDays = Math.max(distinctDayIndexes.size, days.length);
  return coveredDays >= Math.min(expectedDays, 2);
}

export async function generateMealPlanForUser(
  userId: string,
  options?: { days?: number; mealsPerDay?: number }
): Promise<MealPlanResult> {
  const profile = await prisma.healthProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error('Health profile required');

  const privacy = await prisma.privacySettings.findUnique({ where: { userId } });
  if (privacy && !privacy.allowAiDataUsage) {
    throw new Error('AI meal planning is disabled in privacy settings');
  }

  const days = Math.min(7, Math.max(1, options?.days ?? 1));
  const mealsPerDay = Math.min(6, Math.max(1, options?.mealsPerDay ?? 3));
  const tz = profile.timezone || 'UTC';
  const { start, end } = startEndWindow(tz, days);

  const targets = deriveMacroTargets(
    profile.weightKg,
    profile.heightCm,
    profile.age,
    profile.gender,
    profile.weeklyActivityFrequency,
    profile.primaryGoal,
    profile.targetDirection
  );

  const q = `${profile.primaryGoal} ${profile.dietaryPreference} ${profile.dietaryRestrictions.join(' ')}`;
  const emb = await embedTextOrFallback(q);
  const rag = await retrieveSimilarRecipes(emb, 6);
  const bannedTokens = allBannedIngredientTokens(profile.dietaryRestrictions);

  const strategyFallback = {
    calorieTarget: targets.calorieTarget,
    proteinG: targets.proteinG,
    carbsG: targets.carbsG,
    fatsG: targets.fatsG,
    dietaryNotes: profile.dietaryRestrictions,
    ragTitles: rag.map((r) => r.title),
  };

  if (!hasOpenAIKey()) {
    const plan = buildFallbackPlan(targets, rag, days, mealsPerDay, bannedTokens);
    const row = await prisma.mealPlan.create({
      data: {
        userId,
        startDate: start,
        endDate: end,
        calorieTarget: targets.calorieTarget,
        proteinTargetG: targets.proteinG,
        carbsTargetG: targets.carbsG,
        fatsTargetG: targets.fatsG,
        mealsPerDay,
        strategyJson: strategyFallback,
        scheduleJson: { mealsPerDay, days, slots: ['BREAKFAST', 'LUNCH', 'DINNER'] },
        planJson: JSON.parse(JSON.stringify(plan)) as object,
        promptVersion: PIPELINE_VERSION,
        modelUsed: 'fallback_catalog_v1',
        fallbackUsed: true,
        items: {
          create: (plan.meals as Record<string, unknown>[]).map((m) => ({
            dayIndex: 0,
            slot: parseMealSlot(m.slot),
            title: String(m.title),
            recipeId: (m.recipeId as string | null) || null,
            calories: Number(m.calories) || null,
            proteinG: Number(m.proteinG) || null,
            carbsG: Number(m.carbsG) || null,
            fatsG: Number(m.fatsG) || null,
          })),
        },
      },
    });
    return {
      mealPlanId: row.id,
      strategy: strategyFallback,
      schedule: { mealsPerDay, days },
      plan,
      fallbackUsed: true,
      modelUsed: 'fallback_catalog_v1',
    };
  }

  let strategy: Record<string, unknown>;
  let schedule: Record<string, unknown> = { mealsPerDay, days, slots: ['BREAKFAST', 'LUNCH', 'DINNER'] };
  let plan: Record<string, unknown>;
  let modelUsed = '';
  let usedFallback = false;

  try {
    modelUsed = getModel();
    const sys1 =
      'You are a nutrition strategist. Output strict JSON only. Use targets as guidance; respect dietary restrictions. Few-shot style: {"strategy":"high-protein vegetarian","macroSplit":{"protein":30,"carbs":40,"fats":30},"notes":["meal timing consistency"]}.';
    const user1 = JSON.stringify({
      profile: {
        age: profile.age,
        gender: profile.gender,
        goal: profile.primaryGoal,
        activityDays: profile.weeklyActivityFrequency,
        restrictions: profile.dietaryRestrictions,
        preference: profile.dietaryPreference,
      },
      serverTargets: targets,
      ragRecipes: rag,
    });
    strategy = await callJsonModel(sys1, user1);

    const sys2 =
      `You are a meal scheduler. For ${days} day(s), split serverTargets into meals (breakfast, lunch, dinner, optional snack). Return JSON with days and meal times. Iteratively refine if per-day calories deviate by >10%.`;
    const user2 = JSON.stringify({ strategy, serverTargets: targets, mealsPerDay, days, timezone: tz });
    schedule = await callJsonModel(sys2, user2);

    const sys3 = `You are a recipe writer. For each meal in the schedule, propose realistic ingredient lines using ONLY ingredient names that could exist in a food database (short plain English). You MUST call calculate_nutrition for each meal's ingredients with correct g/ml. After tools, output strict JSON with weekly-aware shape: { "days": [ { "dayIndex": number, "meals": [ { "slot", "title", "ingredients": [{ "name", "quantity", "unit": "g"|"ml" }], "servings": number, "instructions": string[], "cookVideoSuggestion": { "query": string, "urlCandidate": string, "titleCandidate": string }, "nutrition": { "calories", "protein", "carbs", "fats" } } ] } ] } where dayIndex starts at 0. Also include top-level "meals" flat array for compatibility. Title and calories are mandatory for every meal. Use ONLY tool-computed nutrition values.`;
    const user3 = JSON.stringify({ schedule, serverTargets: targets, ragRecipes: rag });

    const { text: step3text, modelUsed: m3 } = await runToolLoop(sys3, user3, 10);
    modelUsed = m3;
    try {
      const json = extractJsonObject(step3text);
      const rawPlan = JSON.parse(json ?? step3text) as Record<string, unknown>;
      const normalized = await normalizeAiPlan(rawPlan, { days, mealsPerDay });
      if (!hasUsablePlan(normalized, days)) {
        const recovered = await recoverPlanFromSchedule(schedule, { days, mealsPerDay }, targets);
        if (recovered) {
          plan = recovered;
          usedFallback = false;
        } else {
          plan = buildFallbackPlan(targets, rag, days, mealsPerDay, bannedTokens);
          usedFallback = true;
          modelUsed = 'fallback_catalog_v1';
        }
      } else {
        plan = normalized;
      }
    } catch {
      const recovered = await recoverPlanFromSchedule(schedule, { days, mealsPerDay }, targets);
      if (recovered) {
        plan = recovered;
        usedFallback = false;
      } else {
        plan = buildFallbackPlan(targets, rag, days, mealsPerDay, bannedTokens);
        usedFallback = true;
      }
    }
  } catch (e) {
    console.error('[meal-plan-pipeline]', e);
    strategy = strategyFallback;
    const safeSchedule = typeof schedule === 'object' && schedule ? schedule : { mealsPerDay, days, slots: ['BREAKFAST', 'LUNCH', 'DINNER'] };
    schedule = safeSchedule;
    const recovered = await recoverPlanFromSchedule(safeSchedule, { days, mealsPerDay }, targets);
    if (recovered) {
      plan = recovered;
      usedFallback = false;
    } else {
      plan = buildFallbackPlan(targets, rag, days, mealsPerDay, bannedTokens);
      modelUsed = 'fallback_catalog_v1';
      usedFallback = true;
    }
  }
  plan = sanitizePlanForRestrictions(plan, bannedTokens);

  const row = await prisma.mealPlan.create({
    data: {
      userId,
      startDate: start,
      endDate: end,
      calorieTarget: targets.calorieTarget,
      proteinTargetG: targets.proteinG,
      carbsTargetG: targets.carbsG,
      fatsTargetG: targets.fatsG,
      mealsPerDay,
      strategyJson: JSON.parse(JSON.stringify(strategy)) as object,
      scheduleJson: JSON.parse(JSON.stringify(schedule)) as object,
      planJson: JSON.parse(JSON.stringify(plan)) as object,
      promptVersion: PIPELINE_VERSION,
      modelUsed,
      fallbackUsed: usedFallback,
      items: {
          create: Array.isArray(plan.meals)
          ? (plan.meals as Record<string, unknown>[]).map((m, idx) => ({
              dayIndex: Math.max(0, Math.floor(toNumber(m.dayIndex) ?? 0)),
              slot: parseMealSlot(m.slot),
              title: String(m.title || `Meal ${idx + 1}`),
              recipeId: null,
              calories: typeof m.nutrition === 'object' && m.nutrition
                ? toNumber((m.nutrition as Record<string, unknown>).calories)
                : null,
              proteinG:
                typeof m.nutrition === 'object' && m.nutrition
                  ? toNumber((m.nutrition as Record<string, unknown>).protein)
                  : null,
              carbsG:
                typeof m.nutrition === 'object' && m.nutrition
                  ? toNumber((m.nutrition as Record<string, unknown>).carbs)
                  : null,
              fatsG:
                typeof m.nutrition === 'object' && m.nutrition
                  ? toNumber((m.nutrition as Record<string, unknown>).fats)
                  : null,
            }))
          : [],
      },
    },
  });

  const mealsForPersistence = Array.isArray(plan.meals) ? (plan.meals as Record<string, unknown>[]) : [];
  if (mealsForPersistence.length > 0) {
    await persistGeneratedRecipes({
      mealPlanId: row.id,
      meals: mealsForPersistence,
      modelUsed,
    });
  }

  return {
    mealPlanId: row.id,
    strategy,
    schedule,
    plan,
    fallbackUsed: usedFallback,
    modelUsed,
  };
}
