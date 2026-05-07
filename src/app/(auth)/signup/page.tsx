import { SignupForm } from '@/components/auth/signup-form';
import { getOAuthProviderFlags } from '@/lib/oauth-config';

export const metadata = { title: 'Sign Up - FitNexus' };

export default function SignupPage() {
  const { showGithub, showGoogle } = getOAuthProviderFlags();
  return <SignupForm showGithub={showGithub} showGoogle={showGoogle} />;
}
