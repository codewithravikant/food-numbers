import 'server-only';

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type AiIoLogEntry = {
  id: string;
  ts: number;
  scope: string; // e.g. "daily-plan", "meal-plan.step3", "weekly-insight"
  model?: string;
  ms?: number;
  request: JsonValue;
  response?: JsonValue;
  error?: { message: string; name?: string; stack?: string };
};

const MAX_ENTRIES = 50;

declare global {
  // eslint-disable-next-line no-var
  var __AI_IO_LOG__: AiIoLogEntry[] | undefined;
}

function isEnabled(): boolean {
  // Only ever log in dev, and only when explicitly enabled.
  return process.env.NODE_ENV === 'development' && (process.env.AI_IO_LOG === '1' || process.env.AI_IO_LOG === 'true');
}

function safeJson(value: unknown): JsonValue {
  // Best-effort JSON-serializable value for debugging.
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return { _type: typeof value, _value: String(value) };
  }
}

function makeId(): string {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function addAiIoLog(entry: Omit<AiIoLogEntry, 'id' | 'ts'>): void {
  if (!isEnabled()) return;
  const arr = (globalThis.__AI_IO_LOG__ ||= []);
  arr.unshift({ ...entry, id: makeId(), ts: Date.now() });
  if (arr.length > MAX_ENTRIES) arr.length = MAX_ENTRIES;
}

export function getAiIoLog(): AiIoLogEntry[] {
  if (!isEnabled()) return [];
  return (globalThis.__AI_IO_LOG__ ||= []);
}

export function clearAiIoLog(): void {
  if (!isEnabled()) return;
  globalThis.__AI_IO_LOG__ = [];
}

export function logAiCall<T>(params: {
  scope: string;
  model?: string;
  request: unknown;
  run: () => Promise<T>;
  pickResponse?: (result: T) => unknown;
}): Promise<T> {
  const started = Date.now();
  return params
    .run()
    .then((result) => {
      addAiIoLog({
        scope: params.scope,
        model: params.model,
        ms: Date.now() - started,
        request: safeJson(params.request),
        response: safeJson(params.pickResponse ? params.pickResponse(result) : result),
      });
      return result;
    })
    .catch((e: unknown) => {
      const err = e instanceof Error ? e : new Error(String(e));
      addAiIoLog({
        scope: params.scope,
        model: params.model,
        ms: Date.now() - started,
        request: safeJson(params.request),
        error: { message: err.message, name: err.name, stack: err.stack },
      });
      throw e;
    });
}

