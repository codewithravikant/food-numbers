import assert from 'node:assert/strict';
import test from 'node:test';
import type { AIContext } from '../../types/ai';
import { verifyDailyPlanOutput } from './hallucination-guard';

const baseContext: AIContext = {
  profile: {
    age: 30,
    gender: 'FEMALE',
    heightCm: 165,
    weightKg: 62,
    primaryGoal: 'GENERAL_FITNESS',
    selectedGoals: ['GENERAL_FITNESS'],
    goalStrategy: 'single_focus',
    targetDirection: 'MAINTAIN',
    dietaryPreference: 'BALANCED',
    dietaryRestrictions: ['dairy'],
    fitnessLevel: 'INTERMEDIATE',
    weeklyActivityFrequency: 4,
    exerciseTypes: ['walking'],
    preferredEnvironment: 'HOME',
    timeOfDayPreference: 'MORNING',
    enduranceMinutes: 30,
    baselineStressLevel: 3,
  },
  recentHabits: { avgStress: 3, avgSleep: 7, avgHydration: 1.8 },
  recentActivity: { totalMinutes: 160, sessionCount: 4, types: ['walk'] },
  recentMeals: { count: 10, types: ['BREAKFAST'] },
  preserveMode: false,
};

test('guard rejects risky medical claims', () => {
  const result = verifyDailyPlanOutput(
    {
      insightText: 'Stop your medication and this will cure your issue.',
      actions: [
        { category: 'movement' },
        { category: 'nutrition' },
        { category: 'mindfulness' },
      ],
      smartMeal: { ingredients: ['oats', 'banana'] },
    },
    baseContext
  );
  assert.equal(result.ok, false);
});

test('guard rejects meal that violates restriction', () => {
  const result = verifyDailyPlanOutput(
    {
      insightText: 'Steady progress this week.',
      actions: [
        { category: 'movement' },
        { category: 'nutrition' },
        { category: 'mindfulness' },
      ],
      smartMeal: { ingredients: ['milk', 'oats'] },
    },
    baseContext
  );
  assert.equal(result.ok, false);
});

test('guard accepts valid structured output', () => {
  const result = verifyDailyPlanOutput(
    {
      insightText: 'Keep your routine steady and increase hydration consistency.',
      actions: [
        { category: 'movement' },
        { category: 'nutrition' },
        { category: 'mindfulness' },
      ],
      smartMeal: { ingredients: ['oats', 'berries'] },
    },
    baseContext
  );
  assert.equal(result.ok, true);
});
