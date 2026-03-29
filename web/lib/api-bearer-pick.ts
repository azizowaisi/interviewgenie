/**
 * Rules for when the BFF may set Authorization from Auth0 getAccessToken() vs falling
 * back to session id_token (see /api/app/[...path]/route.ts).
 */

export type SdkAccessTokenShape = {
  token?: string;
  audience?: string;
  expiresAt?: number;
};

export function looksLikeJwt(token: string): boolean {
  // JWTs are base64url.base64url.base64url (two dots). Opaque tokens break api-service JWT verification.
  return token.split(".").length === 3;
}

/** Prefer the first candidate that is a JWT (opaque access tokens must not win over id_token). */
export function pickJwtBearer(...candidates: (string | undefined | null)[]): string | undefined {
  for (const c of candidates) {
    const t = typeof c === "string" ? c.trim() : "";
    if (t && looksLikeJwt(t)) return t;
  }
  return undefined;
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
