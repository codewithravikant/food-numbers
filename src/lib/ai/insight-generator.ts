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

export type DailyPlanFallbackReason =
  | 'no_key'
  | 'no_model'
  | 'privacy'
  | 'invalid_model'
  | 'truncated'
  | 'auth_error'
  | 'rate_limit'
  | 'network'
  | 'parse_error'
  | 'guardrail'
  | 'error';

/** Extract a JSON object from model text (bare JSON, ```json fences, or leading/trailing prose). */
export function parseJsonObjectFromContent(content: string): Record<string, unknown> {
  const tryParse = (raw: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  const trimmed = content.trim();
  const direct = tryParse(trimmed);
  if (direct) return direct;

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) {
    const fromFence = tryParse(fence[1].trim());
    if (fromFence) return fromFence;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const extracted = tryParse(trimmed.slice(firstBrace, lastBrace + 1));
    if (extracted) return extracted;
  }

  throw new Error('ai_response_not_json');
}

function classifyProviderFailure(e: unknown): DailyPlanFallbackReason {
  const msg = e instanceof Error ? e.message : String(e);

  if (msg === 'OPENROUTER_MODEL or OPENAI_MODEL is not configured' || /OPENROUTER_MODEL|OPENAI_MODEL.*not configured/i.test(msg)) {
    return 'no_model';
  }
  if (msg.startsWith('unsupported_model:')) return 'invalid_model';
  if (msg === 'provider_truncated_response') return 'truncated';
  if (msg === 'ai_response_not_json') return 'parse_error';
  if (msg.startsWith('hallucination_guard_failed:')) return 'guardrail';

  if (typeof e === 'object' && e !== null && 'status' in e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) return 'auth_error';
    if (status === 429) return 'rate_limit';
    if (typeof status === 'number' && status >= 500) return 'network';
  }

  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|socket|network/i.test(msg)) {
    return 'network';
  }
  if (/401|403|unauthorized|invalid api key|incorrect api key|authentication/i.test(msg)) {
    return 'auth_error';
  }
  if (/429|rate limit|quota|too many requests/i.test(msg)) {
    return 'rate_limit';
  }

  return 'error';
}

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

function buildFallbackPlan(
  context: Awaited<ReturnType<typeof buildAIContext>>,
  preserveMode: boolean,
  reason: DailyPlanFallbackReason
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
      'Add OPENROUTER_API_KEY (optional: OPENROUTER_MODEL). You can also use OPENAI_API_KEY as a fallback provider. Restart the server after changing .env. Showing an offline-safe plan for now.';
  } else if (reason === 'no_model') {
    insightText =
      'Set OPENROUTER_MODEL or OPENAI_MODEL for your provider. Restart the app after updating environment variables.';
  } else if (reason === 'invalid_model') {
    insightText =
      'Your configured AI model is not compatible with daily plan generation (OCR/vision model). Switch OPENROUTER_MODEL to a chat/instruction model and try again.';
  } else if (reason === 'truncated') {
    insightText =
      'AI provider response was truncated before a valid plan was produced. Retrying with another compatible model is recommended.';
  } else if (reason === 'auth_error') {
    insightText =
      'The AI provider rejected the API key (unauthorized). Verify OPENROUTER_API_KEY or OPENAI_API_KEY, redeploy or restart after .env changes.';
  } else if (reason === 'rate_limit') {
    insightText =
      'The AI provider rate-limited or exceeded quota for this request. Wait a few minutes or check your provider plan limits.';
  } else if (reason === 'network') {
    insightText =
      'Could not reach the AI provider (network or server error). Check connectivity and provider status; using an offline plan for now.';
  } else if (reason === 'parse_error') {
    insightText =
      'The model returned text we could not parse as JSON. Try another chat model or generate again.';
  } else if (reason === 'guardrail') {
    insightText =
      'The model output did not pass safety validation. Regenerate or try a different model.';
  } else {
    insightText =
      'We could not produce a live AI plan (unexpected error). Using a reliable offline plan until the next successful sync.';
  }

  return {
    insightText,
    recommendations: {
      actions,
      smartMeal,
      preserveMode: pm,
      insightExpanded: '',
      priority: 'medium',
      fallbackReason: reason,
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
    const reason = classifyProviderFailure(e);
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
