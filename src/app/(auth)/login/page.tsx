import { LoginForm } from '@/components/auth/login-form';
import { getOAuthProviderFlags } from '@/lib/oauth-config';

export const metadata = { title: 'Sign In - FitNexus' };

export default function LoginPage() {
  const { showGithub, showGoogle } = getOAuthProviderFlags();
  return <LoginForm showGithub={showGithub} showGoogle={showGoogle} />;
}
