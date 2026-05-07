'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { PressRevealPassword } from '@/components/ui/press-reveal-password';
import { toast } from '@/hooks/use-toast';
import { TwoFactorSetup } from '@/components/settings/two-factor-setup';
import { parseFloatOrOmit, parseIntOrOmit, stripNullishForProfilePatch } from '@/lib/profile-patch';
import { cn } from '@/lib/utils';
import {
  ADDITIONAL_DIETARY_TAGS,
  DIETARY_RESTRICTION_OPTIONS,
  prefTag,
  isKnownDietRestrictionEntry,
} from '@/lib/dietary';
import { PROFILE_LIMITS } from '@/lib/validations/profile';
import {
  containsBlockedHobbyTerm,
  sanitizeCommaSeparatedEntries,
  sanitizeHobbyInput,
} from '@/lib/input-safety';

type AccountState = {
  name: string;
  email: string;
  hasPassword: boolean;
  twoFactorEnabled: boolean;
};

export default function ProfilePage() {
  const { update: updateSession } = useSession();
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      fetch('/api/profile').then((r) => {
        if (!r.ok) throw new Error('profile');
        return r.json();
      }),
      fetch('/api/account').then((r) => {
        if (!r.ok) throw new Error('account');
        return r.json();
      }),
    ])
      .then(([p, a]) => {
        setProfile(p);
        setAccount(a as AccountState);
      })
      .catch(() => toast({ title: 'Failed to load profile', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, []);

  const handleSavePersonal = async () => {
    if (!profile || !account) return;
    setSaving(true);
    try {
      // JSON.stringify omits keys whose value is undefined — server must always receive `name`.
      const displayName = account.name ?? '';
      const accRes = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: displayName }),
      });
      if (!accRes.ok) {
        const err = await accRes.json().catch(() => ({}));
        throw new Error(err.error || 'Could not update display name');
      }
      const accJson = (await accRes.json()) as AccountState;
      setAccount(accJson);

      try {
        await updateSession({ name: accJson.name || null });
      } catch {
        // Session refresh is best-effort; DB update already succeeded
      }

      const profRes = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stripNullishForProfilePatch(profile as Record<string, unknown>)),
      });
      if (!profRes.ok) {
        const err = await profRes.json().catch(() => ({}));
        const fieldErrors = (err as { fieldErrors?: Record<string, string[]> }).fieldErrors
          ?? (err as { details?: { fieldErrors?: Record<string, string[]> } }).details?.fieldErrors
          ?? {};
        if (Object.keys(fieldErrors).length > 0) {
          const nextErrors: Record<string, string> = {};
          Object.entries(fieldErrors).forEach(([field, messages]) => {
            if (messages?.[0]) nextErrors[field] = messages[0];
          });
          setProfileErrors(nextErrors);
        }
        const firstValidationMessage = Object.values(fieldErrors).flat().find(Boolean);
        throw new Error(
          firstValidationMessage
          || (err as { message?: string }).message
          || (err as { error?: string }).error
          || 'Could not update health profile'
        );
      }

      setProfileErrors({});
      toast({ title: 'Profile updated', description: 'Changes may affect your daily plan', variant: 'success' });
    } catch (e) {
      toast({
        title: 'Failed to save',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account?.hasPassword) return;
    setPasswordSaving(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update password');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: 'Password updated', description: 'Use your new password next time you sign in.', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Could not change password',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setPasswordSaving(false);
    }
  };


  if (loading) return <LoadingSpinner size="lg" className="py-16" />;
  if (!profile || !account) return <p className="text-center text-muted-foreground py-8">Profile not found</p>;
  const hasConfirmPasswordValue = confirmPassword.length > 0;
  const passwordValuesMatch = newPassword === confirmPassword;

  const dietaryRestrictionsList = Array.isArray(profile.dietaryRestrictions)
    ? (profile.dietaryRestrictions as string[])
    : [];
  const otherDietaryFreeText = dietaryRestrictionsList.filter((r) => !isKnownDietRestrictionEntry(r)).join(', ');

  const toggleKnownDietEntry = (key: string) => {
    const known = dietaryRestrictionsList.filter(isKnownDietRestrictionEntry);
    const other = dietaryRestrictionsList.filter((r) => !isKnownDietRestrictionEntry(r));
    const nextKnown = known.includes(key) ? known.filter((k) => k !== key) : [...known, key];
    setProfile({ ...profile, dietaryRestrictions: [...nextKnown, ...other] });
    setProfileErrors((prev) => {
      const next = { ...prev };
      delete next.dietaryRestrictions;
      return next;
    });
  };

  const setOtherDietary = (text: string) => {
    const known = dietaryRestrictionsList.filter(isKnownDietRestrictionEntry);
    const parsed = sanitizeCommaSeparatedEntries(text, 8);
    setProfile({ ...profile, dietaryRestrictions: [...known, ...parsed] });
    setProfileErrors((prev) => {
      const next = { ...prev };
      delete next.dietaryRestrictions;
      return next;
    });
  };

  const updateProfileFields = (updates: Record<string, unknown>) => {
    setProfile({ ...profile, ...updates });
    setProfileErrors((prev) => {
      const next = { ...prev };
      Object.keys(updates).forEach((key) => delete next[key]);
      return next;
    });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold gradient-text">Profile</h1>
        <p className="text-muted-foreground mt-1">View and edit your account and health profile</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Re-calibrate your plan</CardTitle>
          <CardDescription>
            Re-run the assessment questionnaire to refresh your personalized recommendations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/onboarding?mode=recalibrate">Start Re-calibration</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal Info</CardTitle>
          <CardDescription>Changes will affect your daily plan recommendations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Display name">
            <Input
              value={account.name}
              onChange={(e) => setAccount({ ...account, name: e.target.value })}
              placeholder="Your name"
              autoComplete="name"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="Age"
              error={profileErrors.age}
              hint={`${PROFILE_LIMITS.age.min}-${PROFILE_LIMITS.age.max} years`}
            >
              <Input
                type="number"
                min={PROFILE_LIMITS.age.min}
                max={PROFILE_LIMITS.age.max}
                value={typeof profile.age === 'number' && !Number.isNaN(profile.age) ? profile.age : ''}
                onChange={(e) => updateProfileFields({ age: parseIntOrOmit(e.target.value) })}
              />
            </FormField>
            <FormField label="Gender">
              <Select value={profile.gender as string || ''} onValueChange={(v) => updateProfileFields({ gender: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                  <SelectItem value="NON_BINARY">Non-binary</SelectItem>
                  <SelectItem value="PREFER_NOT_TO_SAY">Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="Height (cm)"
              error={profileErrors.heightCm}
              hint={`${PROFILE_LIMITS.heightCm.min}-${PROFILE_LIMITS.heightCm.max} cm`}
            >
              <Input
                type="number"
                min={PROFILE_LIMITS.heightCm.min}
                max={PROFILE_LIMITS.heightCm.max}
                value={
                  typeof profile.heightCm === 'number' && !Number.isNaN(profile.heightCm)
                    ? profile.heightCm
                    : ''
                }
                onChange={(e) => updateProfileFields({ heightCm: parseFloatOrOmit(e.target.value) })}
              />
            </FormField>
            <FormField label="Fitness Level">
              <Select value={profile.fitnessLevel as string || ''} onValueChange={(v) => updateProfileFields({ fitnessLevel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BEGINNER">Beginner</SelectItem>
                  <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
                  <SelectItem value="ADVANCED">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField label="Primary Goal">
            <Select value={profile.primaryGoal as string || ''} onValueChange={(v) => updateProfileFields({ primaryGoal: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WEIGHT_LOSS">Weight Loss</SelectItem>
                <SelectItem value="MUSCLE_GAIN">Muscle Gain</SelectItem>
                <SelectItem value="GENERAL_FITNESS">General Fitness</SelectItem>
                <SelectItem value="METABOLIC_HEALTH">Metabolic Health</SelectItem>
                <SelectItem value="MENTAL_FOCUS">Mental Focus</SelectItem>
                <SelectItem value="BURNOUT_PREVENTION">Burnout Prevention</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Diet Preference">
            <Select value={profile.dietaryPreference as string || ''} onValueChange={(v) => updateProfileFields({ dietaryPreference: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="HIGH_PROTEIN">High Protein</SelectItem>
                <SelectItem value="PLANT_BASED">Plant-Based</SelectItem>
                <SelectItem value="LOW_CARB">Low-Carb</SelectItem>
                <SelectItem value="BALANCED">Balanced</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <div className="space-y-2">
            <p className="text-sm font-medium">Additional dietary preference tags</p>
            <div className="flex flex-wrap gap-2">
              {ADDITIONAL_DIETARY_TAGS.map((pref) => {
                const key = prefTag(pref);
                return (
                  <button
                    key={pref}
                    type="button"
                    onClick={() => toggleKnownDietEntry(key)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs transition-all',
                      dietaryRestrictionsList.includes(key)
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border hover:border-primary/50'
                    )}
                  >
                    {pref}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Dietary restrictions and food allergies (optional)</p>
            <div className="flex flex-wrap gap-2">
              {DIETARY_RESTRICTION_OPTIONS.map((restriction) => (
                <button
                  key={restriction}
                  type="button"
                  onClick={() => toggleKnownDietEntry(restriction)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs transition-all',
                    dietaryRestrictionsList.includes(restriction)
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border hover:border-primary/50'
                  )}
                >
                  {restriction}
                </button>
              ))}
            </div>
          </div>
          <FormField
            label="Other dietary notes (comma separated, optional)"
            error={profileErrors.dietaryRestrictions}
          >
            <Input
              value={otherDietaryFreeText}
              onChange={(e) => setOtherDietary(e.target.value)}
              placeholder="Custom items your clinician asked you to track"
            />
          </FormField>
          <FormField label="Timezone (IANA)" error={profileErrors.timezone}>
            <Input
              value={profile.timezone as string || ''}
              onChange={(e) => updateProfileFields({ timezone: e.target.value })}
              placeholder="Europe/Helsinki"
            />
          </FormField>
          <FormField
            label="Primary Hobby (optional)"
            error={profileErrors.hobbyName}
            hint={`${PROFILE_LIMITS.hobbyName.min}-${PROFILE_LIMITS.hobbyName.max} characters`}
          >
            <Input
              value={profile.hobbyName as string || ''}
              maxLength={PROFILE_LIMITS.hobbyName.max}
              onChange={(e) => {
                const hobbyName = sanitizeHobbyInput(e.target.value);
                updateProfileFields({ hobbyName });
                if (hobbyName && containsBlockedHobbyTerm(hobbyName)) {
                  setProfileErrors((prev) => ({ ...prev, hobbyName: 'Please enter a safe and appropriate hobby' }));
                }
              }}
              placeholder="e.g. Photography"
            />
          </FormField>
          <FormField label="Hobby Activity Style (optional)">
            <Select value={profile.hobbyActivityStyle as string || ''} onValueChange={(v) => updateProfileFields({ hobbyActivityStyle: v })}>
              <SelectTrigger><SelectValue placeholder="Select style" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SEATED">Mostly seated</SelectItem>
                <SelectItem value="MIXED">Mixed movement</SelectItem>
                <SelectItem value="ACTIVE">Mostly active</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <Button onClick={handleSavePersonal} loading={saving} className="w-full">
            Save Changes
          </Button>
        </CardContent>
      </Card>

      <Card id="sign-in">
        <CardHeader>
          <CardTitle className="text-base">Email &amp; password</CardTitle>
          <CardDescription>Your sign-in email and password for this account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Email">
            <Input type="email" value={account.email} readOnly className="bg-muted/40 text-muted-foreground" />
          </FormField>
          {account.hasPassword ? (
            <form onSubmit={handleChangePassword} className="space-y-4 border-t border-border pt-4">
              <p className="text-sm font-medium text-foreground">Change password</p>
              <FormField label="Current password">
                <PressRevealPassword
                  label="current password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </FormField>
              <FormField label="New password">
                <PressRevealPassword
                  label="new password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </FormField>
              <FormField label="Confirm new password">
                <PressRevealPassword
                  label="confirm new password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </FormField>
              {hasConfirmPasswordValue && (
                <p className={cn('text-xs', passwordValuesMatch ? 'text-emerald-400' : 'text-destructive')}>
                  {passwordValuesMatch ? 'Passwords match.' : 'Passwords do not match.'}
                </p>
              )}
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                loading={passwordSaving}
                disabled={!currentPassword || !newPassword || !confirmPassword || !passwordValuesMatch}
              >
                Update password
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground border-t border-border pt-4">
              Password sign-in is not set for this account. You signed in with Google, GitHub, or another provider.
            </p>
          )}
        </CardContent>
      </Card>

      <div id="two-factor">
        <TwoFactorSetup
          initialEnabled={account.twoFactorEnabled}
          onStatusChange={(isEnabled) => {
            setAccount((prev) => (prev ? { ...prev, twoFactorEnabled: isEnabled } : prev));
            void updateSession({ twoFactorEnabled: isEnabled });
          }}
        />
      </div>
    </div>
  );
}
