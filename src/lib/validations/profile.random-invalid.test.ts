import assert from 'node:assert/strict';
import test from 'node:test';
import { ZodError } from 'zod';
import { healthProfileSchema } from '@/lib/validations/profile';

function baseValidProfile() {
  return {
    age: 30,
    gender: 'MALE',
    heightCm: 180,
    weightKg: 80,
    primaryGoal: 'GENERAL_FITNESS',
    selectedGoals: ['GENERAL_FITNESS'],
    targetDirection: 'MAINTAIN',
    weeklyActivityFrequency: 3,
    exerciseTypes: ['Walking'],
    avgSessionDuration: 'MEDIUM',
    fitnessLevel: 'INTERMEDIATE',
    preferredEnvironment: 'GYM',
    timeOfDayPreference: 'MORNING',
    enduranceMinutes: 30,
    dietaryPreference: 'BALANCED',
    dietaryRestrictions: ['Dairy-free'],
    baselineStressLevel: 3,
    aiConsentGiven: true,
    timezone: 'Europe/Helsinki',
  } as const;
}

test('onboarding rejects 5 extreme/random profiles', () => {
  const base = baseValidProfile();

  const cases: Array<{ label: string; payload: unknown }> = [
    {
      label: 'age_max_height_extreme_underweight_weightloss',
      payload: {
        ...base,
        age: 120,
        heightCm: 250,
        weightKg: 35,
        targetDirection: 'LOSE',
        targetWeightKg: 24,
        primaryGoal: 'WEIGHT_LOSS',
      },
    },
    {
      label: 'weekly_activity_out_of_range',
      payload: {
        ...base,
        weeklyActivityFrequency: 20,
      },
    },
    {
      label: 'unrealistic_strength_counts',
      payload: {
        ...base,
        pushupCount: 10_000,
        squatCount: 150_000,
      },
    },
    {
      label: 'height_out_of_bounds',
      payload: {
        ...base,
        heightCm: 290,
      },
    },
    {
      label: 'target_weight_missing_when_lose',
      payload: {
        ...base,
        targetDirection: 'LOSE',
        targetWeightKg: undefined,
      },
    },
  ];

  cases.forEach((c) => {
    assert.throws(() => healthProfileSchema.parse(c.payload), ZodError, c.label);
  });
});

test('onboarding accepts a realistic profile', () => {
  assert.doesNotThrow(() => healthProfileSchema.parse(baseValidProfile()));
});

