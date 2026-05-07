import OpenAI from 'openai';

/** OpenRouter uses the OpenAI-compatible API at this base URL. */
const OPENROUTER_DEFAULT_BASE = 'https://openrouter.ai/api/v1';

let client: OpenAI | null = null;

function trimEnv(name: string): string | undefined {
  const v = process.env[name];
  const t = v?.trim();
  return t || undefined;
}

function resolveApiKey(): string {
  const openAiKey = trimEnv('OPENAI_API_KEY');
  const openRouterKey = trimEnv('OPENROUTER_API_KEY');
  return openRouterKey || openAiKey || '';
}

function resolveBaseUrl(usingDedicatedOpenRouterKey: boolean): string | undefined {
  const explicitBase = trimEnv('OPENAI_BASE_URL');
  return explicitBase || (usingDedicatedOpenRouterKey ? OPENROUTER_DEFAULT_BASE : undefined);
}

function resolveModel(): string {
  return trimEnv('OPENROUTER_MODEL') || trimEnv('OPENAI_MODEL') || '';
}

/**
 * Resolves LLM config from env. Supports:
 * - OpenRouter (primary): `OPENROUTER_API_KEY` + optional `OPENROUTER_MODEL` (defaults base URL to OpenRouter)
 * - OpenAI: `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`, `OPENAI_MODEL`)
 * - OpenRouter with `OPENAI_API_KEY` + `OPENAI_BASE_URL` (common alias pattern)
 */
export function getResolvedLlmConfig(): { apiKey: string; baseURL: string | undefined; model: string } {
  const openRouterKey = trimEnv('OPENROUTER_API_KEY');
  const apiKey = resolveApiKey();
  const baseURL = resolveBaseUrl(!!openRouterKey);
  const model = resolveModel();

  return { apiKey, baseURL, model };
}

/** Resolve model id when you actually need to call the provider. */
export function getModel(): string {
  const apiKey = resolveApiKey();
  const model = resolveModel();
  if (apiKey && !model) {
    throw new Error('OPENROUTER_MODEL or OPENAI_MODEL is not configured');
  }
  return model;
}

export function hasOpenAIKey(): boolean {
  return !!resolveApiKey();
}

export function getOpenAI(): OpenAI {
  const openRouterKey = trimEnv('OPENROUTER_API_KEY');
  const apiKey = resolveApiKey();
  const baseURL = resolveBaseUrl(!!openRouterKey);
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY or OPENAI_API_KEY is not configured');
  }
  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL,
    });
  }
  return client;
}
