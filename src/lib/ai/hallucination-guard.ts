import type { AIContext } from '@/types/ai';
import { allBannedIngredientTokens } from '@/lib/dietary';

const medicalRiskPhrases = [
  'replace your medication',
  'stop your medication',
  'diagnose',
  'cure',
  'guaranteed result',
];

function textContainsRiskPhrase(text: string): boolean {
  const normalized = text.toLowerCase();
  return medicalRiskPhrases.some((phrase) => normalized.includes(phrase));
}

export function verifyDailyPlanOutput(
  parsed: Record<string, unknown>,
  context: AIContext
): { ok: true } | { ok: false; reason: string } {
  const rawText = String(parsed.insightText ?? '');
  if (!rawText.trim()) {
    return { ok: false, reason: 'empty_insight' };
  }
  if (textContainsRiskPhrase(rawText)) {
    return { ok: false, reason: 'medical_claim_risk' };
  }

  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  if (actions.length !== 3) {
    return { ok: false, reason: 'invalid_action_count' };
  }
  const categories = actions.map((a) => (a as { category?: unknown }).category);
  if (categories.some((c) => c !== 'movement' && c !== 'nutrition' && c !== 'mindfulness')) {
    return { ok: false, reason: 'invalid_action_category' };
  }

  const smartMeal = parsed.smartMeal as { ingredients?: unknown } | undefined;
  const ingredients = Array.isArray(smartMeal?.ingredients)
    ? smartMeal.ingredients.map((i) => String(i).toLowerCase())
    : [];
  const restrictedTokens = allBannedIngredientTokens(context.profile.dietaryRestrictions);
  if (restrictedTokens.some((token) => ingredients.some((ing) => ing.includes(token)))) {
    return { ok: false, reason: 'restriction_conflict' };
  }

  return { ok: true };
}
