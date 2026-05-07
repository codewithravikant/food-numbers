import type { AIContext } from '@/types/ai';

export function redactContextForAI(context: AIContext) {
  return {
    ...context,
    profile: {
      ...context.profile,
      age: Math.max(0, Math.round(context.profile.age)),
      heightCm: Math.round(context.profile.heightCm),
      weightKg: Math.round(context.profile.weightKg),
      hobbyName: undefined,
    },
  };
}
