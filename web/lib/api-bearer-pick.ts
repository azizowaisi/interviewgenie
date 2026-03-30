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
  if (!token || !looksLikeJwt(token)) return false;
  // Auth0 SDK sometimes omits the `audience` field on the access token object; fall back to the JWT payload `aud`.
  const sdkAud = at?.audience?.trim();
  if (sdkAud) return sdkAud === aud;
  return jwtAudiences(token).includes(aud);
}
