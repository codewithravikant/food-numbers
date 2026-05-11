'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema, type SignupInput } from '@/lib/validations/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { PressRevealPassword } from '@/components/ui/press-reveal-password';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { OAuthButtons } from './oauth-buttons';
import { toast } from '@/hooks/use-toast';

export type SignupFormProps = {
  showGithub?: boolean;
  showGoogle?: boolean;
};

export function SignupForm({ showGithub = true, showGoogle = true }: SignupFormProps) {
  const hasOAuth = showGithub || showGoogle;
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
  });
  const passwordValue = watch('password') ?? '';
  const confirmPasswordValue = watch('confirmPassword') ?? '';
  const hasConfirmValue = confirmPasswordValue.length > 0;
  const passwordsMatch = passwordValue === confirmPasswordValue;

  const onSubmit = async (data: SignupInput) => {
    setLoading(true);
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (!res.ok) {
        toast({ title: 'Signup failed', description: result.error, variant: 'destructive' });
        return;
      }

      setSuccess(true);
      toast({
        title: 'Account created!',
        description: result.message,
        variant: 'success',
      });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">You&apos;re all set</h3>
          <p className="text-sm text-muted-foreground">
            Your account is ready. Sign in with the email and password you chose.
          </p>
          <Link href="/login">
            <Button variant="outline" className="mt-2">
              Sign in
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center">Create your account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <OAuthButtons showGithub={showGithub} showGoogle={showGoogle} />
        {hasOAuth && (
          <div className="flex items-center gap-3">
            <span className="flex-1 border-t border-border" />
            <span className="text-xs uppercase text-muted-foreground">Or sign up with email</span>
            <span className="flex-1 border-t border-border" />
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Email" error={errors.email?.message} required>
            <Input type="email" placeholder="you@example.com" {...register('email')} />
          </FormField>
          <FormField label="Password" error={errors.password?.message} required hint="Min 8 chars, 1 uppercase, 1 number">
            <PressRevealPassword
              label="password"
              placeholder="Create a password"
              autoComplete="new-password"
              error={errors.password?.message}
              {...register('password')}
            />
          </FormField>
          <FormField label="Confirm Password" error={errors.confirmPassword?.message} required>
            <PressRevealPassword
              label="confirm password"
              placeholder="Confirm your password"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />
          </FormField>
          {!errors.confirmPassword && hasConfirmValue && (
            <p className={passwordsMatch ? 'text-xs text-emerald-400' : 'text-xs text-destructive'}>
              {passwordsMatch ? 'Passwords match.' : 'Passwords do not match.'}
            </p>
          )}
          <Button type="submit" className="w-full" loading={loading} disabled={!passwordsMatch && hasConfirmValue}>
            Create Account
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
