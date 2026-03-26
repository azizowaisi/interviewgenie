/**
 * Matches required Auth0Client env expectations so we can respond clearly
 * before the SDK returns a generic 500 from /auth/login.
 */
export function isAuth0Configured(): boolean {
  const domain = process.env.AUTH0_DOMAIN?.trim();
  const clientId = process.env.AUTH0_CLIENT_ID?.trim();
  const secret = process.env.AUTH0_SECRET?.trim();
  const hasClientAuth = Boolean(
    process.env.AUTH0_CLIENT_SECRET?.trim() ||
      process.env.AUTH0_CLIENT_ASSERTION_SIGNING_KEY?.trim(),
  );
  return Boolean(domain && clientId && secret && hasClientAuth);
}
