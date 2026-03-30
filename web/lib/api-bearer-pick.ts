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

function b64UrlToJson(s: string): unknown {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = (s + pad).replaceAll("-", "+").replaceAll("_", "/");
    const raw = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function jwtAudiences(token: string): string[] {
  if (!looksLikeJwt(token)) return [];
  const payloadSeg = token.split(".")[1] ?? "";
  const payload = b64UrlToJson(payloadSeg) as { aud?: unknown } | null;
  const aud = payload?.aud;
  if (typeof aud === "string") return [aud];
  if (Array.isArray(aud)) return aud.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return [];
}

function jwtExpSeconds(token: string): number | null {
  if (!looksLikeJwt(token)) return null;
  const payloadSeg = token.split(".")[1] ?? "";
  const payload = b64UrlToJson(payloadSeg) as { exp?: unknown } | null;
  const exp = payload?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
}

function jwtIsExpired(token: string, skewSeconds = 60): boolean {
  const exp = jwtExpSeconds(token);
  if (!exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + skewSeconds;
}

function jwtHasAudience(token: string, requiredAudience: string | undefined): boolean {
  const req = requiredAudience?.trim();
  if (!req) return true;
  return jwtAudiences(token).includes(req);
}

/** Prefer the first candidate that is a non-expired JWT (opaque access tokens must not win over id_token). */
export function pickJwtBearer(...candidates: (string | undefined | null)[]): string | undefined {
  for (const c of candidates) {
    const t = typeof c === "string" ? c.trim() : "";
    if (t && looksLikeJwt(t) && !jwtIsExpired(t)) return t;
  }
  return undefined;
}

/**
 * API-specific bearer picking.
 *
 * - Prefer a non-expired id_token first (api-service accepts aud=AUTH0_CLIENT_ID).
 * - Only use access tokens when they are non-expired JWTs whose aud includes the API identifier.
 *
 * This avoids forwarding a JWT that "looks valid" but has the wrong audience (401 Invalid token).
 */
export function pickJwtBearerForApi(
  apiAudience: string | undefined,
  idToken: string | undefined | null,
  scopedAccessToken: string | undefined | null,
  fallbackAccessToken: string | undefined | null,
): string | undefined {
  const id = pickJwtBearer(idToken);
  if (id) return id;

  const scoped = pickJwtBearer(scopedAccessToken);
  if (scoped && jwtHasAudience(scoped, apiAudience)) return scoped;

  const fallback = pickJwtBearer(fallbackAccessToken);
  if (fallback && jwtHasAudience(fallback, apiAudience)) return fallback;

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
  if (!token || !looksLikeJwt(token)) return false;
  // Auth0 SDK sometimes omits the `audience` field on the access token object; fall back to the JWT payload `aud`.
  const sdkAud = at?.audience?.trim();
  if (sdkAud) return sdkAud === aud;
  return jwtAudiences(token).includes(aud);
}
