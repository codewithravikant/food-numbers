/** Non-empty trimmed env; empty string in .env disables OAuth for that provider. */
export function oauthEnv(
  name: 'GITHUB_CLIENT_ID' | 'GITHUB_CLIENT_SECRET' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'
): string | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export function githubOAuthEnabled(): boolean {
  return Boolean(oauthEnv('GITHUB_CLIENT_ID') && oauthEnv('GITHUB_CLIENT_SECRET'));
}

export function googleOAuthEnabled(): boolean {
  return Boolean(oauthEnv('GOOGLE_CLIENT_ID') && oauthEnv('GOOGLE_CLIENT_SECRET'));
}

/** For server pages: pass to OAuthButtons / forms. */
export function getOAuthProviderFlags() {
  return {
    showGithub: githubOAuthEnabled(),
    showGoogle: googleOAuthEnabled(),
  };
}
