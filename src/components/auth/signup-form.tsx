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
import { Mail } from 'lucide-react';

export type SignupFormProps = {
  showGithub?: boolean;
  showGoogle?: boolean;
};

export function SignupForm({ showGithub = true, showGoogle = true }: SignupFormProps) {
  const hasOAuth = showGithub || showGoogle;
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  /** false when API created the account but outbound email failed (e.g. SMTP not set on Railway). */
  const [verificationEmailSent, setVerificationEmailSent] = useState(true);
  const [resendEmail, setResendEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);

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

      const sent = result.emailSent !== false;
      setVerificationEmailSent(sent);
      setResendEmail(data.email);
      setSuccess(true);
      if (sent) {
        toast({
          title: 'Account created!',
          description: result.message,
          variant: 'success',
        });
      } else {
        toast({
          title: 'Account created — email not sent',
          description: result.message,
          variant: 'default',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = resendEmail.trim();
    if (!email) {
      toast({ title: 'Email required', description: 'Enter the email you signed up with.', variant: 'destructive' });
      return;
    }
    setResendLoading(true);
    try {
      const res = await fetch('/api/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Could not send email',
          description: typeof data.error === 'string' ? data.error : 'Try again later.',
          variant: 'destructive',
        });
        return;
      }

      // API includes `debug` only in development — explains why no mail was sent
      const dbg = data.debug as
        | { sent: true; skipped: null }
        | { sent: false; skipped: 'not_found' | 'oauth_only' | 'already_verified' }
        | undefined;

      if (dbg) {
        if (dbg.sent) {
          toast({
            title: 'Verification email sent',
            description: 'Check your inbox and spam folder.',
          });
        } else if (dbg.skipped === 'not_found') {
          toast({
            title: 'No email sent',
            description: 'No account with that email. Check spelling or sign up first.',
            variant: 'destructive',
          });
        } else if (dbg.skipped === 'oauth_only') {
          toast({
            title: 'No email sent',
            description: 'This email is linked to Google or GitHub only. Sign in with that provider instead.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'No email sent',
            description: 'This email is already verified. Try signing in.',
            variant: 'destructive',
          });
        }
        return;
      }

      toast({
        title: 'Request received',
        description:
          typeof data.message === 'string'
            ? `${data.message} Check spam. If nothing arrives, set SMTP_HOST, SMTP_USER, SMTP_PASS (and EMAIL_FROM) on the server, redeploy, and use the exact email you registered with.`
            : 'Check spam and your server SMTP settings.',
      });
    } catch {
      toast({ title: 'Request failed', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setResendLoading(false);
    }
  };

  if (success) {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-4">
          {verificationEmailSent ? (
            <>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold">Check your email</h3>
              <p className="text-sm text-muted-foreground">
                We&apos;ve sent a verification link to your email address. Click the link to activate your account.
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
                <Mail className="h-6 w-6 text-amber-500" />
              </div>
              <h3 className="text-lg font-semibold">Account created</h3>
              <p className="text-sm text-muted-foreground text-left">
                We couldn&apos;t send the verification email (usually missing or invalid SMTP on the server). Your
                account is saved — after SMTP is configured, use <span className="font-medium text-foreground">Resend
                link</span> with the email below.
              </p>
              <form onSubmit={handleResendVerification} className="flex flex-col gap-2 sm:flex-row sm:items-end text-left">
                <div className="flex-1 min-w-0">
                  <label htmlFor="signup-success-resend-email" className="sr-only">
                    Email for resend verification
                  </label>
                  <Input
                    id="signup-success-resend-email"
                    type="email"
                    autoComplete="email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="outline" loading={resendLoading} className="shrink-0">
                  Resend link
                </Button>
              </form>
            </>
          )}
          <Link href="/login">
            <Button variant="outline" className="mt-2">
              Back to login
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

        <div className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3 space-y-3">
          <div className="flex items-start gap-2">
            <Mail className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">Already registered? Resend a verification link.</p>
          </div>
          <form onSubmit={handleResendVerification} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 min-w-0">
              <label htmlFor="signup-resend-email" className="sr-only">
                Email for resend verification
              </label>
              <Input
                id="signup-resend-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" loading={resendLoading} className="shrink-0">
              Resend link
            </Button>
          </form>
        </div>
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
