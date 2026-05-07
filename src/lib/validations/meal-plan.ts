import { z } from 'zod';

export const mealPlanRequestSchema = z.object({
  user_preferences: z.object({
    dietary_restrictions: z.array(z.string()).default([]),
    cuisine_preferences: z.array(z.string()).default([]),
    disliked_ingredients: z.array(z.string()).default([]),
    calorie_target: z.number().positive().optional(),
    macronutrient_targets: z
      .object({
        protein: z.number().nonnegative(),
        carbs: z.number().nonnegative(),
        fats: z.number().nonnegative(),
      })
      .optional(),
    meals_per_day: z.number().int().min(1).max(6).default(3),
    preferred_meal_times: z.record(z.string(), z.string().datetime()).optional(),
    timezone: z.string().optional(),
  }),
  meal_plan_request: z.object({
    duration: z.enum(['daily', 'weekly']).default('daily'),
    date: z.string().optional(),
    version: z.string().default('1.0'),
    created_at: z.string().datetime().optional(),
  }),
});
