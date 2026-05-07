import type { RecipeData } from '@/types/ai';
import { allBannedIngredientTokens } from '@/lib/dietary';

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLoose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

export function isRecipeSafe(recipe: RecipeData, userRestrictions: string[]): boolean {
  if (!userRestrictions.length) return true;

  const recipeContent = normalizeLoose([
    recipe.name,
    recipe.description,
    ...recipe.ingredients,
    ...recipe.dietaryTags,
  ].join(' '));

  const banned = allBannedIngredientTokens(userRestrictions);
  if (!banned.length) return true;
  return !banned.some((term) => recipeContent.includes(normalizeLoose(term)));
}

export function matchesPreference(recipe: RecipeData, preference: string): boolean {
  if (preference === 'BALANCED') return true;
  const pref = normalizeToken(preference);
  const tags = recipe.dietaryTags.map((t) => normalizeToken(t));

  if (tags.some((t) => t.includes('balanced'))) return true;

  return recipe.dietaryTags.some((t) => {
    const tag = normalizeToken(t);
    if (tag.includes(pref) || (pref.length > 2 && pref.includes(tag))) return true;
    const words = pref.split(' ').filter((w) => w.length > 2);
    return words.length > 0 && words.every((w) => tag.includes(w));
  });
}
