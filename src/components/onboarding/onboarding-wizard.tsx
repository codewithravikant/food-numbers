'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ProgressIndicator } from './progress-indicator';
import { StepBasics } from './step-basics';
import { StepGoals } from './step-goals';
import { StepFitness } from './step-fitness';
import { StepDiet } from './step-diet';
import { StepStress } from './step-stress';
import { StepFitNexusReveal } from './step-fitnexus-reveal';
import { toast } from '@/hooks/use-toast';
import type { HealthProfileFormData } from '@/types/health';
import type { WellnessScoreData } from '@/types/health';
import { PROFILE_LIMITS } from '@/lib/validations/profile';
import { calculateBMI } from '@/lib/calculations';
import { containsBlockedHobbyTerm } from '@/lib/input-safety';

const TOTAL_STEPS = 6;

interface OnboardingWizardProps {
  mode?: 'onboarding' | 'recalibrate';
  initialData?: Partial<HealthProfileFormData>;
}

function normalizeWellnessScore(raw: unknown): WellnessScoreData | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, number | string | undefined>;
  const score = Number(data.score);
  const habitsScore = Number(data.habitsScore);
  const activityScore = Number(data.activityScore);
  const progressScore = Number(data.progressScore);
  const metabolicScore = Number(data.metabolicScore ?? data.bmiScore);
  const bmi = Number(data.bmi);
  const bmiCategory = String(data.bmiCategory ?? '');

  if (
    Number.isNaN(score) ||
    Number.isNaN(habitsScore) ||
    Number.isNaN(activityScore) ||
    Number.isNaN(progressScore) ||
    Number.isNaN(metabolicScore) ||
    Number.isNaN(bmi) ||
    !bmiCategory
  ) {
    return null;
  }

  return {
    score,
    habitsScore,
    activityScore,
    progressScore,
    metabolicScore,
    bmi,
    bmiCategory: bmiCategory as WellnessScoreData['bmiCategory'],
  };
}

export function OnboardingWizard({ mode = 'onboarding', initialData }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [goalWarning, setGoalWarning] = useState<string>('');
  const [goalWarningAccepted, setGoalWarningAccepted] = useState(false);
  const [wellnessScore, setWellnessScore] = useState<WellnessScoreData | null>(null);
  const [data, setData] = useState<Partial<HealthProfileFormData>>({
    exerciseTypes: [],
    selectedGoals: initialData?.selectedGoals || (initialData?.primaryGoal ? [initialData.primaryGoal] : []),
    dietaryRestrictions: [],
    dietaryPreference: 'BALANCED',
    baselineStressLevel: 3,
    weeklyActivityFrequency: 3,
    aiConsentGiven: false,
    ...initialData,
  });

  const updateData = (updates: Partial<HealthProfileFormData>) => {
    setData((prev) => ({ ...prev, ...updates }));
    // Clear related errors
    const keys = Object.keys(updates);
    setErrors((prev) => {
      const next = { ...prev };
      keys.forEach((k) => delete next[k]);
      if (keys.some((k) => ['selectedGoals', 'primaryGoal', 'targetDirection', 'targetWeightKg', 'weightKg', 'heightCm'].includes(k))) {
        delete next.goalConcern;
      }
      return next;
    });
    if (keys.some((k) => ['selectedGoals', 'primaryGoal', 'targetDirection', 'targetWeightKg', 'weightKg', 'heightCm'].includes(k))) {
      setGoalWarning('');
      setGoalWarningAccepted(false);
    }
  };

  const validateStep = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 1) {
      if (!data.age || data.age < PROFILE_LIMITS.age.min) {
        newErrors.age = `Age must be at least ${PROFILE_LIMITS.age.min}`;
      }
      if (data.age && data.age > PROFILE_LIMITS.age.max) {
        newErrors.age = `Age must be ${PROFILE_LIMITS.age.max} or less`;
      }
      if (!data.gender) newErrors.gender = 'Please select a gender';
      if (!data.heightCm || data.heightCm < PROFILE_LIMITS.heightCm.min) {
        newErrors.heightCm = `Height must be at least ${PROFILE_LIMITS.heightCm.min} cm`;
      }
      if (data.heightCm && data.heightCm > PROFILE_LIMITS.heightCm.max) {
        newErrors.heightCm = `Height must be ${PROFILE_LIMITS.heightCm.max} cm or less`;
      }
      if (!data.weightKg || data.weightKg < PROFILE_LIMITS.weightKg.min) {
        newErrors.weightKg = `Weight must be at least ${PROFILE_LIMITS.weightKg.min} kg`;
      }
      if (data.weightKg && data.weightKg > PROFILE_LIMITS.weightKg.max) {
        newErrors.weightKg = `Weight must be ${PROFILE_LIMITS.weightKg.max} kg or less`;
      }
    } else if (step === 2) {
      const selectedGoals = data.selectedGoals || (data.primaryGoal ? [data.primaryGoal] : []);
      if (selectedGoals.length < 1 || selectedGoals.length > 3) newErrors.selectedGoals = 'Please select 1 to 3 goals';
      if (!data.targetDirection) newErrors.targetDirection = 'Please select a direction';
      if (data.targetDirection === 'LOSE' && typeof data.targetWeightKg !== 'number') {
        newErrors.targetWeightKg = 'Target weight is required when choosing weight loss';
      }
      const hasBodyMetrics = typeof data.heightCm === 'number' && typeof data.weightKg === 'number';
      if (hasBodyMetrics) {
        const bmi = calculateBMI(data.heightCm as number, data.weightKg as number);
        if (bmi < 18.5 && data.targetDirection === 'LOSE') {
          newErrors.targetDirection = 'Weight loss is not recommended while underweight';
        }
        if (bmi < 18.5 && selectedGoals.includes('WEIGHT_LOSS')) {
          newErrors.selectedGoals = 'Weight loss goal is unsafe while underweight';
        }
        if (typeof data.targetWeightKg === 'number') {
          const targetBmi = calculateBMI(data.heightCm as number, data.targetWeightKg);
          if (targetBmi < 18.5) {
            newErrors.targetWeightKg = 'Target weight must remain in a healthy BMI range';
          }
        }
        if (!newErrors.selectedGoals && !newErrors.targetDirection && !newErrors.targetWeightKg) {
          let warning = '';
          if (bmi >= 18.5 && bmi < 20 && data.targetDirection === 'LOSE') {
            warning = 'Your BMI is near the underweight threshold. Weight loss should be approached with caution.';
          }
          if (
            !warning
            && typeof data.targetWeightKg === 'number'
            && calculateBMI(data.heightCm as number, data.targetWeightKg) < 20
          ) {
            warning = 'Your target weight is close to the underweight threshold. Consider a less aggressive target.';
          }
          setGoalWarning(warning);
          if (warning && !goalWarningAccepted) {
            newErrors.goalConcern = 'Please confirm you understand this concern before continuing.';
          }
        } else {
          setGoalWarning('');
          setGoalWarningAccepted(false);
        }
      }
    } else if (step === 3) {
      if (
        typeof data.weeklyActivityFrequency !== 'number'
        || data.weeklyActivityFrequency < PROFILE_LIMITS.weeklyActivityFrequency.min
        || data.weeklyActivityFrequency > PROFILE_LIMITS.weeklyActivityFrequency.max
      ) {
        newErrors.weeklyActivityFrequency = `Weekly activity must be between ${PROFILE_LIMITS.weeklyActivityFrequency.min} and ${PROFILE_LIMITS.weeklyActivityFrequency.max} days`;
      }
      if (!data.exerciseTypes?.length) newErrors.exerciseTypes = 'Select at least one exercise type';
      if (!data.avgSessionDuration) newErrors.avgSessionDuration = 'Please select session duration';
      if (!data.fitnessLevel) newErrors.fitnessLevel = 'Please select fitness level';
      if (!data.preferredEnvironment) newErrors.preferredEnvironment = 'Please select environment';
      if (!data.timeOfDayPreference) newErrors.timeOfDayPreference = 'Please select time preference';
      if (!data.enduranceMinutes && data.enduranceMinutes !== 0) newErrors.enduranceMinutes = 'Please enter endurance minutes';
      if (typeof data.enduranceMinutes === 'number' && data.enduranceMinutes > PROFILE_LIMITS.enduranceMinutes.max) {
        newErrors.enduranceMinutes = `Endurance minutes must be ${PROFILE_LIMITS.enduranceMinutes.max} or less`;
      }
      if (typeof data.pushupCount === 'number' && data.pushupCount > PROFILE_LIMITS.pushupCount.max) {
        newErrors.pushupCount = `Push-ups must be ${PROFILE_LIMITS.pushupCount.max} or less`;
      }
      if (typeof data.squatCount === 'number' && data.squatCount > PROFILE_LIMITS.squatCount.max) {
        newErrors.squatCount = `Squats must be ${PROFILE_LIMITS.squatCount.max} or less`;
      }
      if (typeof data.hobbyName === 'string') {
        const hobbyName = data.hobbyName.trim();
        if (hobbyName && hobbyName.length < PROFILE_LIMITS.hobbyName.min) {
          newErrors.hobbyName = `Hobby must be at least ${PROFILE_LIMITS.hobbyName.min} characters`;
        }
        if (hobbyName && containsBlockedHobbyTerm(hobbyName)) {
          newErrors.hobbyName = 'Please enter a safe and appropriate hobby';
        }
      }
    } else if (step === 4) {
      if (!data.dietaryPreference) newErrors.dietaryPreference = 'Please select a diet preference';
    } else if (step === 5) {
      if (!data.baselineStressLevel) newErrors.baselineStressLevel = 'Please select your stress level';
      if (!data.aiConsentGiven) newErrors.aiConsentGiven = 'Please confirm how your data will be used';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = async () => {
    if (!validateStep()) return;

    if (step === 5) {
      // Submit profile
      setLoading(true);
      try {
        const selectedGoals = data.selectedGoals || (data.primaryGoal ? [data.primaryGoal] : []);
        const payload = {
          ...data,
          selectedGoals,
          primaryGoal: selectedGoals[0],
          exerciseTypes: data.exerciseTypes || [],
          dietaryRestrictions: data.dietaryRestrictions || [],
          timezone: typeof data.timezone === 'string' && data.timezone.trim() ? data.timezone.trim() : undefined,
          targetWeightKg:
            data.targetDirection === 'LOSE' && typeof data.targetWeightKg === 'number'
              ? data.targetWeightKg
              : undefined,
        };
        const res = await fetch('/api/profile', {
          method: mode === 'recalibrate' ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const result = await res.json().catch(() => ({}));
          const fieldErrors = (result as { fieldErrors?: Record<string, string[]> }).fieldErrors
            ?? (result as { details?: { fieldErrors?: Record<string, string[]> } }).details?.fieldErrors
            ?? {};
          const firstValidationMessage = Object.values(fieldErrors).flat().find(Boolean);
          if (res.status === 401) {
            toast({
              title: 'Session expired',
              description: (result as { error?: string }).error ?? 'Signing you out…',
              variant: 'destructive',
            });
            await signOut({ callbackUrl: '/login' });
            return;
          }
          if (Object.keys(fieldErrors).length > 0) {
            const nextErrors: Record<string, string> = {};
            Object.entries(fieldErrors).forEach(([field, messages]) => {
              if (messages?.[0]) nextErrors[field] = messages[0];
            });
            setErrors(nextErrors);
          }
          toast({
            title: 'Error',
            description:
              firstValidationMessage
              || (result as { error?: string }).error
              || 'Request failed',
            variant: 'destructive',
          });
          return;
        }

        const result = await res.json();
        setWellnessScore(normalizeWellnessScore(result.wellnessScore));
        setStep(6);
      } catch (error) {
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to save profile. Please try again.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleComplete = () => {
    router.push('/home');
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-lg space-y-8 pb-12 pt-8">
      <ProgressIndicator currentStep={step} totalSteps={TOTAL_STEPS} />

      <Card className="border-primary/20 shadow-glow relative overflow-hidden bg-black/40">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
        <CardContent className="p-8 relative z-10">
          {step === 1 && <StepBasics data={data} onChange={updateData} errors={errors} />}
          {step === 2 && (
            <StepGoals
              data={data}
              onChange={updateData}
              errors={errors}
              goalWarning={goalWarning}
              goalWarningAccepted={goalWarningAccepted}
              onGoalWarningAcceptedChange={setGoalWarningAccepted}
            />
          )}
          {step === 3 && <StepFitness data={data} onChange={updateData} errors={errors} />}
          {step === 4 && <StepDiet data={data} onChange={updateData} errors={errors} />}
          {step === 5 && <StepStress data={data} onChange={updateData} errors={errors} />}
          {step === 6 && (
            <StepFitNexusReveal
              wellnessScore={wellnessScore}
              onComplete={handleComplete}
              loading={false}
            />
          )}
        </CardContent>
      </Card>

      {step < 6 && (
        <div className="flex gap-4">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} className="flex-1 glass-panel border-primary/20 hover:bg-primary/10">
              Back
            </Button>
          )}
          <Button onClick={handleNext} loading={loading} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-[0_0_15px_rgba(139,92,246,0.3)] hover:shadow-[0_0_25px_rgba(139,92,246,0.5)] transition-all">
            {step === 5 ? (mode === 'recalibrate' ? 'Re-calibrate Plan' : 'Complete Setup') : 'Continue'}
          </Button>
        </div>
      )}
    </div>
  );
}
