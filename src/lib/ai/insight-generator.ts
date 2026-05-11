import { prisma } from '@/lib/prisma';
import { buildAIContext } from '@/lib/ai/context-builder';
import { buildDailyPlanPrompt, PROMPT_VERSION } from '@/lib/ai/prompts';
import { getModel, getOpenAI, hasOpenAIKey } from '@/lib/ai/openai-client';
import { verifyDailyPlanOutput } from '@/lib/ai/hallucination-guard';
import { redactContextForAI } from '@/lib/ai/privacy';
import { logAiCall } from '@/lib/ai/dev-io-log';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import {
  getCachedDailyPlan,
  makeDailyPlanCacheKey,
  setCachedDailyPlan,
  type CachedDailyPlanPayload,
} from '@/lib/ai/response-cache';
import type { DailyAction, DailyPlan, SmartMeal } from '@/types/ai';

const FALLBACK_MODEL = 'fallback_rules_v1';

function normalizeActions(raw: unknown): DailyAction[] {
  if (!Array.isArray(raw)) return [];
  const out: DailyAction[] = [];
  for (let i = 0; i < Math.min(3, raw.length); i++) {
    const a = raw[i] as Record<string, unknown>;
    const cat = a.category;
    const category =
      cat === 'movement' || cat === 'nutrition' || cat === 'mindfulness' ? cat : 'movement';
    out.push({
      id: String(a.id ?? `a${i + 1}`),
      title: String(a.title ?? 'Daily action'),
      description: String(a.description ?? ''),
      category,
      completed: !!a.completed,
    });
  }
  return out;
}

function normalizeSmartMeal(raw: unknown, dietary: string): SmartMeal {
  if (!raw || typeof raw !== 'object') {
    return {
      name: 'Balanced plate',
      description: 'Protein, vegetables, and whole grains.',
      prepTime: '25 min',
      ingredients: ['Seasonal vegetables', 'Lean protein', 'Whole grain'],
      macroHighlights: 'Balanced',
      dietaryTags: [dietary.replace('_', ' ')],
    };
  }
  const m = raw as Record<string, unknown>;
  return {
    name: String(m.name ?? 'Balanced plate'),
    description: String(m.description ?? ''),
    prepTime: String(m.prepTime ?? '25 min'),
    ingredients: Array.isArray(m.ingredients) ? m.ingredients.map(String) : [],
    macroHighlights: m.macroHighlights ? String(m.macroHighlights) : undefined,
    dietaryTags: Array.isArray(m.dietaryTags) ? m.dietaryTags.map(String) : [dietary.replace('_', ' ')],
  };
}

function normalizePriority(raw: unknown): 'high' | 'medium' | 'low' {
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw;
  return 'medium';
}

function parseJsonObjectFromContent(content: string): Record<string, unknown> {
  const tryParse = (raw: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(content);
  if (direct) return direct;

  const withoutFence = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const fenced = tryParse(withoutFence);
  if (fenced) return fenced;

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = withoutFence.slice(firstBrace, lastBrace + 1);
    const slicedParsed = tryParse(sliced);
    if (slicedParsed) return slicedParsed;
  }

  throw new Error('Invalid JSON response from AI provider');
}

function buildFallbackPlan(
  context: Awaited<ReturnType<typeof buildAIContext>>,
  preserveMode: boolean,
  reason:
    | 'no_key'
    | 'privacy'
    | 'error'
    | 'invalid_model'
    | 'truncated'
    | 'model_missing'
    | 'auth'
    | 'rate_limited'
    | 'network'
): {
  insightText: string;
  recommendations: Record<string, unknown>;
  modelUsed: string;
} {
  const p = context.profile;
  const pm = preserveMode || context.preserveMode;
  const actions: DailyAction[] = [
    {
      id: '1',
      title: pm ? 'Gentle walk or mobility flow' : 'Brisk walk or easy cardio',
      description: pm
        ? '15–20 minutes at an easy pace — keep it restorative.'
        : '20–30 minutes to lift energy and support your goal.',
      category: 'movement',
      completed: false,
    },
    {
      id: '2',
      title: 'Hydration rhythm',
      description: 'Space water across the day — aim for steady sips, not chugging.',
      category: 'nutrition',
      completed: false,
    },
    {
      id: '3',
      title: 'Nervous-system reset',
      description: '5 minutes of slow breathing or a short body scan.',
      category: 'mindfulness',
      completed: false,
    },
  ];

  const smartMeal = normalizeSmartMeal(null, p.dietaryPreference);

  let insightText: string;
  if (reason === 'privacy') {
    insightText =
      'AI personalization is turned off in your privacy settings. Here is a safe, general plan for today.';
  } else if (reason === 'no_key') {
    insightText =
      'Add OPENROUTER_API_KEY (optional: OPENROUTER_MODEL). You can also use OPENAI_API_KEY as a fallback provider. If you just updated .env, restart the dev server, then regenerate the plan.';
  } else if (reason === 'model_missing') {
    insightText =
      'API key exists but model is not configured. Set OPENROUTER_MODEL or OPENAI_MODEL, restart the server, then regenerate.';
  } else if (reason === 'invalid_model') {
    insightText =
      'Your configured AI model is not compatible with daily plan generation (OCR/vision model). Switch OPENROUTER_MODEL to a chat/instruction model and try again.';
  } else if (reason === 'auth') {
    insightText =
      'AI provider rejected credentials (invalid/expired key). Update API key and regenerate.';
  } else if (reason === 'rate_limited') {
    insightText =
      'AI provider rate-limited or quota-limited this request. Retry shortly or check provider quota.';
  } else if (reason === 'network') {
    insightText =
      'Could not reach the AI provider (network/DNS/timeout). Using offline plan until connectivity recovers.';
  } else if (reason === 'truncated') {
    insightText =
      'AI provider response was truncated before a valid plan was produced. Retrying with another compatible model is recommended.';
  } else {
    insightText =
      'We could not reach the AI service (network or provider issue). Using a reliable offline plan until the next successful sync.';
  }

  return {
    insightText,
    recommendations: {
      actions,
      smartMeal,
      preserveMode: pm,
      insightExpanded: '',
      priority: 'medium',
    },
    modelUsed: FALLBACK_MODEL,
  };
}

function currentDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function persistCachedPlan(
  userId: string,
  payload: CachedDailyPlanPayload,
  preserveMode: boolean
): Promise<DailyPlan> {
  const row = await prisma.aIInsight.create({
    data: {
      userId,
      insightText: payload.insightText,
      recommendations: JSON.parse(
        JSON.stringify({
          ...payload.recommendations,
          preserveMode,
        })
      ),
      weeklyFocus: null,
      fallbackUsed: true,
      promptVersion: payload.promptVersion || PROMPT_VERSION,
      modelUsed: 'cached_response_v1',
      contextHash: null,
    },
  });
  return mapRowToDailyPlan(row, preserveMode);
}

async function callLlmForPlan(prompt: string): Promise<Record<string, unknown>> {
  const openai = getOpenAI();
  const model = getModel();
  // Uses the provider's chat-completions endpoint as a structured text generation API.
  // This powers "Insight of the Day" generation, not a user-facing chat UI feature.
  const request: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [{ role: 'user', content: prompt }] as ChatCompletionMessageParam[],
    temperature: 0.65,
    max_tokens: 1200,
    response_format: { type: 'json_object' as const },
  };
  const completion = await logAiCall({
    scope: 'daily-plan',
    model,
    request,
    run: () => openai.chat.completions.create(request),
    pickResponse: (c) => ({
      id: (c as { id?: string }).id,
      model: (c as { model?: string }).model,
      usage: (c as { usage?: unknown }).usage,
      choice0: (c as { choices?: unknown[] }).choices?.[0],
    }),
  });
  const firstChoice = completion.choices[0];
  if (firstChoice?.finish_reason === 'length') {
    throw new Error('provider_truncated_response');
  }
  const content = firstChoice?.message?.content;
  if (!content) throw new Error('Empty AI response');
  return parseJsonObjectFromContent(content);
}

function isUnsupportedDailyPlanModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('ocr') || m.includes('vision');
}

function classifyPlanError(error: unknown):
  | 'error'
  | 'invalid_model'
  | 'truncated'
  | 'model_missing'
  | 'auth'
  | 'rate_limited'
  | 'network' {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();

  if (lower.startsWith('unsupported_model:')) return 'invalid_model';
  if (message === 'provider_truncated_response') return 'truncated';
  if (lower.includes('openrouter_model or openai_model is not configured')) return 'model_missing';
  if (
    lower.includes('unauthorized')
    || lower.includes('invalid api key')
    || lower.includes('incorrect api key')
    || lower.includes('authentication')
    || lower.includes('status code 401')
  ) {
    return 'auth';
  }
  if (
    lower.includes('rate limit')
    || lower.includes('too many requests')
    || lower.includes('quota')
    || lower.includes('credits')
    || lower.includes('status code 429')
  ) {
    return 'rate_limited';
  }
  if (
    lower.includes('fetch failed')
    || lower.includes('network')
    || lower.includes('timeout')
    || lower.includes('econnreset')
    || lower.includes('enotfound')
    || lower.includes('socket hang up')
  ) {
    return 'network';
  }
  return 'error';
}

const DEFAULT_ACTIONS: DailyAction[] = [
  { id: '1', title: 'Take a 20-minute walk', description: 'Easy pace, breathe steadily.', category: 'movement', completed: false },
  { id: '2', title: 'Hydrate through the day', description: 'Steady water intake.', category: 'nutrition', completed: false },
  { id: '3', title: '5-minute breathing', description: 'Slow exhale-focused breathing.', category: 'mindfulness', completed: false },
];

function mapRowToDailyPlan(
  row: {
    id: string;
    generatedAt: Date;
    insightText: string;
    recommendations: unknown;
    fallbackUsed: boolean;
  },
  preserveMode: boolean
): DailyPlan {
  const recs = row.recommendations as Record<string, unknown>;
  let actions = normalizeActions(recs?.actions);
  if (actions.length < 3) actions = DEFAULT_ACTIONS;
  const smartMeal = normalizeSmartMeal(recs?.smartMeal, 'BALANCED');
  const insightExpanded =
    typeof recs?.insightExpanded === 'string' ? recs.insightExpanded : undefined;
  const priority = normalizePriority(recs?.priority);
  return {
    id: row.id,
    date: row.generatedAt.toISOString().slice(0, 10),
    actions,
    smartMeal,
    insightText: row.insightText,
    insightExpanded,
    priority,
    preserveMode,
    fallbackUsed: row.fallbackUsed,
  };
}

export type GeneratePlanTrigger = 'manual' | 'auto-home';

export async function generateDailyPlan(
  userId: string,
  preserveMode: boolean,
  opts?: { trigger?: GeneratePlanTrigger }
): Promise<DailyPlan> {
  const context = await buildAIContext(userId);
  const redactedContext = redactContextForAI(context);
  const cacheKey = makeDailyPlanCacheKey(userId, currentDateKey());

  const privacy = await prisma.privacySettings.findUnique({ where: { userId } });
  if (privacy && !privacy.allowAiDataUsage) {
    const fb = buildFallbackPlan(context, preserveMode, 'privacy');
    const row = await prisma.aIInsight.create({
      data: {
        userId,
        insightText: fb.insightText,
        recommendations: JSON.parse(JSON.stringify(fb.recommendations)),
        weeklyFocus: null,
        fallbackUsed: true,
        promptVersion: PROMPT_VERSION,
        modelUsed: fb.modelUsed,
        contextHash: null,
      },
    });
    return mapRowToDailyPlan(row, preserveMode);
  }

  const prompt = buildDailyPlanPrompt(redactedContext, preserveMode);

  if (!hasOpenAIKey()) {
    const cached = await getCachedDailyPlan(cacheKey);
    if (cached) return await persistCachedPlan(userId, cached, preserveMode);

    const fb = buildFallbackPlan(context, preserveMode, 'no_key');
    const row = await prisma.aIInsight.create({
      data: {
        userId,
        insightText: fb.insightText,
        recommendations: JSON.parse(JSON.stringify(fb.recommendations)),
        weeklyFocus: null,
        fallbackUsed: true,
        promptVersion: PROMPT_VERSION,
        modelUsed: fb.modelUsed,
        contextHash: null,
      },
    });
    return mapRowToDailyPlan(row, preserveMode);
  }

  try {
    const model = getModel();
    if (isUnsupportedDailyPlanModel(model)) {
      throw new Error(`unsupported_model:${model}`);
    }
    const parsed = await callLlmForPlan(prompt);
    const verification = verifyDailyPlanOutput(parsed, redactedContext);
    if (!verification.ok) {
      throw new Error(`hallucination_guard_failed:${verification.reason}`);
    }
    const actions = normalizeActions(parsed.actions);
    if (actions.length < 3) {
      throw new Error('Invalid AI actions shape');
    }
    const smartMeal = normalizeSmartMeal(parsed.smartMeal, context.profile.dietaryPreference);
    const insightText = String(parsed.insightText || 'Your personalized plan for today.');
    const insightExpanded = String(parsed.insightExpanded ?? '');
    const priority = normalizePriority(parsed.priority);

    const recommendations = {
      actions,
      smartMeal,
      preserveMode: preserveMode || context.preserveMode,
      insightExpanded,
      priority,
    };

    const row = await prisma.aIInsight.create({
      data: {
        userId,
        insightText,
        recommendations: JSON.parse(JSON.stringify(recommendations)),
        weeklyFocus: null,
        fallbackUsed: false,
        promptVersion: PROMPT_VERSION,
        modelUsed: model,
        contextHash: JSON.stringify({ trigger: opts?.trigger ?? 'manual' }),
      },
    });
    await setCachedDailyPlan(cacheKey, {
      insightText,
      recommendations: {
        actions,
        smartMeal,
        preserveMode: preserveMode || context.preserveMode,
        insightExpanded,
        priority,
      },
      modelUsed: model,
      promptVersion: PROMPT_VERSION,
      fallbackUsed: false,
    });
    return mapRowToDailyPlan(row, preserveMode);
  } catch (e) {
    console.error('[ai] daily plan generation failed', e);
    const cached = await getCachedDailyPlan(cacheKey);
    if (cached) return await persistCachedPlan(userId, cached, preserveMode);
    const reason = classifyPlanError(e);
    const fb = buildFallbackPlan(context, preserveMode, reason);
    const row = await prisma.aIInsight.create({
      data: {
        userId,
        insightText: fb.insightText,
        recommendations: JSON.parse(JSON.stringify(fb.recommendations)),
        weeklyFocus: null,
        fallbackUsed: true,
        promptVersion: PROMPT_VERSION,
        modelUsed: fb.modelUsed,
        contextHash: null,
      },
    });
    return mapRowToDailyPlan(row, preserveMode);
  }
}

/**
 * Ensures a non-observation daily plan exists for today (logged-in server context only).
 * Skips if one already exists. Uses the same pipeline as manual generation, including AI when configured.
 */
export async function ensureTodaysAiPlan(userId: string): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const existing = await prisma.aIInsight.findFirst({
    where: {
      userId,
      generatedAt: { gte: today },
      modelUsed: { not: 'observation_summary_v1' },
    },
  });
  if (existing) return;
  await generateDailyPlan(userId, false, { trigger: 'auto-home' });
}
