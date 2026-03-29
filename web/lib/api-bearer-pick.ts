/**
 * Rules for when the BFF may set Authorization from Auth0 getAccessToken() vs falling
 * back to session id_token (see /api/app/[...path]/route.ts).
 */

export type SdkAccessTokenShape = {
  token?: string;
  audience?: string;
  expiresAt?: number;
};

function looksLikeJwt(token: string): boolean {
  // JWTs are base64url.base64url.base64url (two dots). Opaque tokens break api-service JWT verification.
  return token.split(".").length === 3;
}

/**
 * When AUTH0_AUDIENCE is set, only forward the SDK access token if it reports that
 * audience. Otherwise the SDK often returns the default access token (wrong `aud` or
 * opaque) and we must fall back to id_token for api-service JWT verification.
 */
export function shouldSetAuthorizationFromSdkAccessToken(
  envAudience: string | undefined,
  at: SdkAccessTokenShape | null | undefined,
): boolean {
  const aud = envAudience?.trim();
  const token = at?.token?.trim() ?? "";
  if (!aud) return Boolean(token);
  return Boolean(token && looksLikeJwt(token) && at?.audience?.trim() === aud);
}
