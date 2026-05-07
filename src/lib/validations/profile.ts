import { z } from 'zod';
import { calculateBMI } from '@/lib/calculations';
import {
  ADDITIONAL_DIETARY_TAGS,
  DIETARY_RESTRICTION_OPTIONS,
  PREF_PREFIX,
} from '@/lib/dietary';

const gender = z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY']);
const primaryGoal = z.enum([
  'WEIGHT_LOSS',
  'MUSCLE_GAIN',
  'GENERAL_FITNESS',
  'METABOLIC_HEALTH',
  'MENTAL_FOCUS',
  'BURNOUT_PREVENTION',
]);
const targetDirection = z.enum(['LOSE', 'MAINTAIN', 'IMPROVE_PERFORMANCE']);
const dietaryPreference = z.enum(['HIGH_PROTEIN', 'PLANT_BASED', 'LOW_CARB', 'BALANCED']);
const fitnessLevel = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
const exerciseEnvironment = z.enum(['HOME', 'GYM', 'OUTDOORS', 'MIXED']);
const timeOfDay = z.enum(['MORNING', 'AFTERNOON', 'EVENING', 'NO_PREFERENCE']);
const sessionDuration = z.enum(['SHORT', 'MEDIUM', 'LONG']);

export const PROFILE_LIMITS = {
  age: { min: 13, max: 120 },
  heightCm: { min: 100, max: 250 },
  weightKg: { min: 30, max: 300 },
  targetWeightKg: { min: 30, max: 300 },
  weeklyActivityFrequency: { min: 0, max: 7 },
  enduranceMinutes: { min: 0, max: 180 },
  pushupCount: { min: 0, max: 200 },
  squatCount: { min: 0, max: 500 },
  hobbyName: { min: 2, max: 60 },
} as const;

const knownRestrictionEntries = new Set<string>(DIETARY_RESTRICTION_OPTIONS as readonly string[]);
const knownPrefLabels = new Set<string>(ADDITIONAL_DIETARY_TAGS as readonly string[]);
const hobbyBlockedTerms = [
  'intercourse',
  'sex',
  'porn',
  'nude',
  'naked',
  'xxx',
] as const;

function isValidRestrictionEntry(value: string): boolean {
  if (!value) return false;
  if (knownRestrictionEntries.has(value)) return true;
  if (value.startsWith(PREF_PREFIX)) {
    const label = value.slice(PREF_PREFIX.length);
    return knownPrefLabels.has(label);
  }
  return /^[a-zA-Z0-9\s'()/-]{2,60}$/.test(value);
}

function isCleanHobbyName(value: string): boolean {
  const lower = value.toLowerCase();
  return hobbyBlockedTerms.every((term) => !lower.includes(term));
}

const healthProfileBaseSchema = z.object({
  age: z.number().int().min(PROFILE_LIMITS.age.min).max(PROFILE_LIMITS.age.max),
  gender,
  heightCm: z.number().min(PROFILE_LIMITS.heightCm.min).max(PROFILE_LIMITS.heightCm.max),
  weightKg: z.number().min(PROFILE_LIMITS.weightKg.min).max(PROFILE_LIMITS.weightKg.max),
  primaryGoal,
  selectedGoals: z.array(primaryGoal).optional(),
  targetDirection,
  targetWeightKg: z
    .number()
    .min(PROFILE_LIMITS.targetWeightKg.min)
    .max(PROFILE_LIMITS.targetWeightKg.max)
    .optional(),
  weeklyActivityFrequency: z
    .number()
    .int()
    .min(PROFILE_LIMITS.weeklyActivityFrequency.min)
    .max(PROFILE_LIMITS.weeklyActivityFrequency.max),
  exerciseTypes: z.array(z.string().min(2).max(40)).min(1),
  avgSessionDuration: sessionDuration,
  fitnessLevel,
  preferredEnvironment: exerciseEnvironment,
  timeOfDayPreference: timeOfDay,
  enduranceMinutes: z
    .number()
    .int()
    .min(PROFILE_LIMITS.enduranceMinutes.min)
    .max(PROFILE_LIMITS.enduranceMinutes.max),
  pushupCount: z
    .number()
    .int()
    .min(PROFILE_LIMITS.pushupCount.min)
    .max(PROFILE_LIMITS.pushupCount.max)
    .optional(),
  squatCount: z
    .number()
    .int()
    .min(PROFILE_LIMITS.squatCount.min)
    .max(PROFILE_LIMITS.squatCount.max)
    .optional(),
  hobbyName: z
    .string()
    .trim()
    .min(PROFILE_LIMITS.hobbyName.min)
    .max(PROFILE_LIMITS.hobbyName.max)
    .refine((value) => isCleanHobbyName(value), 'Please enter a safe and appropriate hobby')
    .optional(),
  hobbyActivityStyle: z.enum(['SEATED', 'MIXED', 'ACTIVE']).optional(),
  dietaryPreference,
  dietaryRestrictions: z.array(z.string().trim()).max(16).refine(
    (entries) => entries.every((entry) => isValidRestrictionEntry(entry)),
    'Use valid allergy/restriction entries only'
  ),
  baselineStressLevel: z.number().int().min(1).max(10),
  sleepQuality: z.number().optional(),
  stressNote: z.string().optional(),
  aiConsentGiven: z.boolean(),
  /** IANA timezone for meal timing / summaries */
  timezone: z.string().max(100).optional(),
});

export const healthProfilePatchSchema = healthProfileBaseSchema.partial();

export const healthProfileSchema = healthProfileBaseSchema.superRefine((data, ctx) => {
  if (data.targetDirection === 'LOSE' && typeof data.targetWeightKg !== 'number') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetWeightKg'],
      message: 'Target weight is required when choosing weight loss',
    });
  }

  if (typeof data.targetWeightKg === 'number') {
    if (data.targetDirection === 'LOSE' && data.targetWeightKg >= data.weightKg) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetWeightKg'],
        message: 'For weight loss, target weight must be below current weight',
      });
    }
    if (data.targetDirection !== 'LOSE' && data.targetWeightKg < data.weightKg) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetWeightKg'],
        message: 'Target weight below current weight requires selecting weight loss',
      });
    }
  }

  const bmi = calculateBMI(data.heightCm, data.weightKg);
  if (!Number.isFinite(bmi) || bmi <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['weightKg'],
      message: 'Height and weight combination is invalid',
    });
    return;
  }

  if (bmi < 18.5 && data.targetDirection === 'LOSE') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetDirection'],
      message: 'Weight loss is not recommended while underweight',
    });
  }

  if (bmi < 18.5 && data.primaryGoal === 'WEIGHT_LOSS') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primaryGoal'],
      message: 'Weight loss goal is unsafe while underweight',
    });
  }

  if (bmi < 18.5 && typeof data.targetWeightKg === 'number') {
    const targetBmi = calculateBMI(data.heightCm, data.targetWeightKg);
    if (targetBmi < 18.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetWeightKg'],
        message: 'Target weight must remain in a healthy BMI range',
      });
    }
  }
});

export const privacySettingsSchema = z.object({
  allowAiDataUsage: z.boolean().optional(),
  allowAnonymizedSharing: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  weeklyEmailSummary: z.boolean().optional(),
  marketingEmails: z.boolean().optional(),
});
