const aiCache = new Map<string, { expiresAt: number; value: unknown }>();

export function getCachedAI<T>(key: string): T | null {
  const hit = aiCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    aiCache.delete(key);
    return null;
  }
  return hit.value as T;
}

export function setCachedAI(key: string, value: unknown, ttlMs = 1000 * 60 * 30) {
  aiCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
