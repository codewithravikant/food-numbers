const HOBBY_BLOCKED_TERMS = [
  'intercourse',
  'sex',
  'porn',
  'nude',
  'naked',
  'xxx',
] as const;

export const HOBBY_MAX_LENGTH = 60;

export function containsBlockedHobbyTerm(value: string): boolean {
  const lower = value.toLowerCase();
  return HOBBY_BLOCKED_TERMS.some((term) => lower.includes(term));
}

export function sanitizeHobbyInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9\s'&/-]/g, '').trim().slice(0, HOBBY_MAX_LENGTH);
}

export function sanitizeCommaSeparatedEntries(value: string, maxEntries = 10): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.slice(0, 60))
    .slice(0, maxEntries);
}
