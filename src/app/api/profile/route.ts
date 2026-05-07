import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { healthProfilePatchSchema, healthProfileSchema } from '@/lib/validations/profile';
import { handleApiError, ApiError } from '@/lib/api-error';
import { rateLimitMutation } from '@/lib/rate-limit';
import { recalculateAndStoreWellnessScore } from '@/lib/wellness-score';
import { decodeHobbyContext, encodeHobbyContext } from '@/lib/hobby-context';
import { stripNullishForProfilePatch } from '@/lib/profile-patch';
import { requireApiUserId } from '@/lib/auth/jwt-session';
import {
  decryptTextForUser,
  encryptJsonForUser,
  encryptTextForUser,
} from '@/lib/security/field-crypto';

function buildSensitiveProfileSnapshot(
  profile: {
    age: number;
    gender: string;
    heightCm: number;
    weightKg: number;
    primaryGoal: string;
    targetDirection: string;
    targetWeightKg: number | null;
    weeklyActivityFrequency: number;
    exerciseTypes: string[];
    avgSessionDuration: string;
    fitnessLevel: string;
    preferredEnvironment: string;
    timeOfDayPreference: string;
    enduranceMinutes: number;
    pushupCount: number | null;
    squatCount: number | null;
    dietaryPreference: string;
    dietaryRestrictions: string[];
    baselineStressLevel: number;
    aiConsentGiven: boolean;
    timezone: string;
  },
  hobbyContext: { hobbyName?: string; hobbyActivityStyle?: string; selectedGoals?: string[] }
) {
  return {
    demographics: {
      age: profile.age,
      gender: profile.gender,
    },
    physicalMetrics: {
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
    },
    goals: {
      primaryGoal: profile.primaryGoal,
      targetDirection: profile.targetDirection,
      targetWeightKg: profile.targetWeightKg,
      selectedGoals: hobbyContext.selectedGoals ?? [],
    },
    lifestyle: {
      weeklyActivityFrequency: profile.weeklyActivityFrequency,
      exerciseTypes: profile.exerciseTypes,
      avgSessionDuration: profile.avgSessionDuration,
      fitnessLevel: profile.fitnessLevel,
      preferredEnvironment: profile.preferredEnvironment,
      timeOfDayPreference: profile.timeOfDayPreference,
      enduranceMinutes: profile.enduranceMinutes,
      pushupCount: profile.pushupCount,
      squatCount: profile.squatCount,
      hobbyName: hobbyContext.hobbyName,
      hobbyActivityStyle: hobbyContext.hobbyActivityStyle,
      baselineStressLevel: profile.baselineStressLevel,
    },
    diet: {
      dietaryPreference: profile.dietaryPreference,
      dietaryRestrictions: profile.dietaryRestrictions,
    },
    privacyAndTime: {
      aiConsentGiven: profile.aiConsentGiven,
      timezone: profile.timezone,
    },
  } satisfies Record<string, unknown>;
}

function stripProfileShadow<T extends Record<string, unknown>>(profile: T): Omit<T, 'sensitiveSnapshotEnc'> {
  const safeProfile = { ...profile };
  delete (safeProfile as { sensitiveSnapshotEnc?: string | null }).sensitiveSnapshotEnc;
  return safeProfile as Omit<T, 'sensitiveSnapshotEnc'>;
}

function mergeProfileForValidation(
  existing: Awaited<ReturnType<typeof prisma.healthProfile.findUnique>>,
  patch: z.infer<typeof healthProfilePatchSchema>
) {
  if (!existing) {
    throw new ApiError(404, 'Profile not found');
  }
  const hobbyContext = decodeHobbyContext(existing.occupationType ? decryptTextForUser(existing.userId, existing.occupationType) : null);
  return {
    age: existing.age,
    gender: existing.gender,
    heightCm: existing.heightCm,
    weightKg: existing.weightKg,
    primaryGoal: existing.primaryGoal,
    selectedGoals: hobbyContext.selectedGoals ?? undefined,
    targetDirection: existing.targetDirection,
    targetWeightKg: existing.targetWeightKg ?? undefined,
    weeklyActivityFrequency: existing.weeklyActivityFrequency,
    exerciseTypes: existing.exerciseTypes,
    avgSessionDuration: existing.avgSessionDuration,
    fitnessLevel: existing.fitnessLevel,
    preferredEnvironment: existing.preferredEnvironment,
    timeOfDayPreference: existing.timeOfDayPreference,
    enduranceMinutes: existing.enduranceMinutes,
    pushupCount: existing.pushupCount ?? undefined,
    squatCount: existing.squatCount ?? undefined,
    hobbyName: hobbyContext.hobbyName ?? undefined,
    hobbyActivityStyle: hobbyContext.hobbyActivityStyle ?? undefined,
    dietaryPreference: existing.dietaryPreference,
    dietaryRestrictions: existing.dietaryRestrictions,
    baselineStressLevel: existing.baselineStressLevel,
    sleepQuality: undefined,
    stressNote: undefined,
    aiConsentGiven: existing.aiConsentGiven,
    timezone: existing.timezone,
    ...patch,
  };
}

export async function POST(request: Request) {
  try {
    const userId = await requireApiUserId(request);

    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!userRow) {
      throw new ApiError(
        401,
        'Your session is out of date (no matching account). Sign out and sign in again.'
      );
    }

    const { success } = await rateLimitMutation(userId, 'profile-create');
    if (!success) throw new ApiError(429, 'Too many requests');

    const body = await request.json();
    const data = healthProfileSchema.parse(body);

    const existing = await prisma.healthProfile.findUnique({
      where: { userId },
      select: { id: true, onboardingCompleted: true },
    });
    if (existing?.onboardingCompleted) throw new ApiError(409, 'Profile already exists');

    const {
      sleepQuality: _sleepQuality,
      stressNote: _stressNote,
      hobbyName: _hobbyName,
      hobbyActivityStyle: _hobbyActivityStyle,
      selectedGoals: _selectedGoals,
      ...profileData
    } = data;

    const hobbyContext = encodeHobbyContext({
      hobbyName: _hobbyName,
      hobbyActivityStyle: _hobbyActivityStyle,
      selectedGoals: _selectedGoals,
    });

    const profile = existing
      ? await prisma.healthProfile.update({
          where: { userId },
          data: {
            ...profileData,
            occupationType: hobbyContext ? encryptTextForUser(userId, hobbyContext) : null,
            onboardingCompleted: true,
          },
        })
      : await prisma.healthProfile.create({
          data: {
            ...profileData,
            occupationType: hobbyContext ? encryptTextForUser(userId, hobbyContext) : undefined,
            userId,
            onboardingCompleted: true,
          },
        });
    const snapshot = buildSensitiveProfileSnapshot(
      profile,
      decodeHobbyContext(decryptTextForUser(userId, profile.occupationType))
    );
    await prisma.healthProfile.update({
      where: { id: profile.id },
      data: { sensitiveSnapshotEnc: encryptJsonForUser(userId, snapshot) },
    });

    const wellnessScore = await recalculateAndStoreWellnessScore(userId);

    // Ensure privacy settings exist (safe on retries/legacy partial data).
    await prisma.privacySettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    // Create initial stress log
    if (_sleepQuality || _stressNote) {
      await prisma.habitLog.create({
        data: {
          userId,
          stressLevel: profile.baselineStressLevel,
          sleepQuality: _sleepQuality,
          notes: _stressNote,
        },
      });
    }

    return NextResponse.json({
      profile: {
        ...stripProfileShadow(profile),
        ...decodeHobbyContext(decryptTextForUser(userId, profile.occupationType)),
      },
      wellnessScore: {
        score: wellnessScore.score,
        habitsScore: wellnessScore.habitsScore,
        activityScore: wellnessScore.activityScore,
        progressScore: wellnessScore.progressScore,
        metabolicScore: wellnessScore.bmiScore,
        bmi: wellnessScore.bmi,
        bmiCategory: wellnessScore.bmiCategory,
      },
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const userId = await requireApiUserId(request);

    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!userRow) {
      throw new ApiError(
        401,
        'Your session is out of date (no matching account). Sign out and sign in again.'
      );
    }

    const profile = await prisma.healthProfile.findUnique({
      where: { userId },
    });

    if (!profile) throw new ApiError(404, 'Profile not found');
    const hobbyContext = decodeHobbyContext(decryptTextForUser(userId, profile.occupationType));
    return NextResponse.json({
      ...stripProfileShadow(profile),
      ...hobbyContext,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireApiUserId(request);

    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!userRow) {
      throw new ApiError(
        401,
        'Your session is out of date (no matching account). Sign out and sign in again.'
      );
    }

    const body = await request.json();
    if (!body || typeof body !== 'object') {
      throw new ApiError(400, 'Invalid JSON body');
    }
    const cleaned = stripNullishForProfilePatch(body as Record<string, unknown>);
    if (Object.prototype.hasOwnProperty.call(cleaned, 'hobbyName') && cleaned.hobbyName === '') {
      cleaned.hobbyName = undefined;
    }
    const parsed = healthProfilePatchSchema.parse(cleaned);
    const existingProfile = await prisma.healthProfile.findUnique({
      where: { userId },
    });
    const mergedForValidation = mergeProfileForValidation(existingProfile, parsed);
    healthProfileSchema.parse(mergedForValidation);
    const {
      hobbyName,
      hobbyActivityStyle,
      selectedGoals,
      ...baseData
    } = parsed;

    const data: Record<string, unknown> = { ...baseData };
    const wantsHobbyUpdate = Object.prototype.hasOwnProperty.call(parsed, 'hobbyName')
      || Object.prototype.hasOwnProperty.call(parsed, 'hobbyActivityStyle')
      || Object.prototype.hasOwnProperty.call(parsed, 'selectedGoals');

    if (wantsHobbyUpdate) {
      const currentHobby = decodeHobbyContext(decryptTextForUser(userId, existingProfile?.occupationType));
      const encodedHobby = encodeHobbyContext({
        hobbyName: Object.prototype.hasOwnProperty.call(parsed, 'hobbyName')
          ? hobbyName
          : currentHobby.hobbyName,
        hobbyActivityStyle: Object.prototype.hasOwnProperty.call(parsed, 'hobbyActivityStyle')
          ? hobbyActivityStyle
          : currentHobby.hobbyActivityStyle,
        selectedGoals: Object.prototype.hasOwnProperty.call(parsed, 'selectedGoals')
          ? selectedGoals
          : currentHobby.selectedGoals,
      });
      data.occupationType = encodedHobby ? encryptTextForUser(userId, encodedHobby) : null;
    }

    if (Object.keys(data).length === 0) {
      if (!existingProfile) throw new ApiError(404, 'Profile not found');
      const wellnessScore = await recalculateAndStoreWellnessScore(userId);
      return NextResponse.json({
        profile: {
          ...stripProfileShadow(existingProfile),
          ...decodeHobbyContext(decryptTextForUser(userId, existingProfile.occupationType)),
        },
        wellnessScore,
      });
    }

    const profile = await prisma.healthProfile.update({
      where: { userId },
      data: data as Parameters<typeof prisma.healthProfile.update>[0]['data'],
    });
    const hobbyContext = decodeHobbyContext(decryptTextForUser(userId, profile.occupationType));
    const snapshot = buildSensitiveProfileSnapshot(profile, hobbyContext);
    await prisma.healthProfile.update({
      where: { id: profile.id },
      data: { sensitiveSnapshotEnc: encryptJsonForUser(userId, snapshot) },
    });

    const wellnessScore = await recalculateAndStoreWellnessScore(userId);
    return NextResponse.json({
      profile: {
        ...stripProfileShadow(profile),
        ...hobbyContext,
      },
      wellnessScore,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
