import { Auth0Client } from "@auth0/nextjs-auth0/server";
import type { SdkError } from "@auth0/nextjs-auth0/errors";
import { NextResponse } from "next/server";

/**
 * Auth0 v4 does not read AUTH0_AUDIENCE from the environment. The BFF passes
 * `getAccessToken({ audience: AUTH0_AUDIENCE })` in `/api/app/*`.
 *
 * We do **not** put `audience` on the default `/authorize` request: if that identifier
 * is not created under Auth0 → APIs, Auth0 returns `access_denied` / "Service not found"
 * and login never completes. ID tokens still work for api-service when AUTH0_CLIENT_ID matches.
 *
 * Opt in to audience on authorize only after the API exists: `AUTH0_AUTHORIZE_AUDIENCE=true`.
 */

const GENERIC_AUTH0_MESSAGES = new Set([
  "An error occurred during the authorization flow.",
  "An error occurred while trying to exchange the authorization code.",
  "An error occurred while preparing or performing the authorization code grant request.",
]);

function extractAuthErrorDetail(error: Error): string {
  let cur: unknown = error;
  const seen = new Set<unknown>();
  for (let i = 0; i < 8 && cur && typeof cur === "object" && !seen.has(cur); i++) {
    seen.add(cur);
    const o = cur as { message?: string; cause?: unknown };
    if (typeof o.message === "string") {
      const m = o.message.trim();
      if (m && !GENERIC_AUTH0_MESSAGES.has(m)) return m;
    }
    cur = o.cause;
  }
  const top = error.message?.trim();
  if (top && !GENERIC_AUTH0_MESSAGES.has(top)) return top;
  return "Sign-in failed. In Auth0, check Allowed Callback URLs include {your origin}/auth/callback, and set AUTH0_BASE_URL / APP_BASE_URL to this site’s origin (https, no trailing slash). If you use an API audience, authorize that API for this application.";
}

async function onCallback(
  error: SdkError | null,
  ctx: { appBaseUrl?: string; returnTo?: string },
  session: unknown,
): Promise<NextResponse> {
  // Auth0 SDK provides the new session object; we only care about redirect behavior here.
  // Keep reference so TS/linters don't treat it as unused.
  if (session) {
    // no-op
  }
  if (error) {
    const base = ctx.appBaseUrl;
    if (!base) {
      return new NextResponse(
        "Auth misconfiguration: app base URL is missing. Set AUTH0_BASE_URL or APP_BASE_URL to your public site origin.",
        { status: 500 },
      );
    }
    const detail = extractAuthErrorDetail(error);
    const loginUrl = new URL("/login", base);
    const returnTo = ctx.returnTo?.startsWith("/") ? ctx.returnTo : "/interview";
    loginUrl.searchParams.set("returnTo", returnTo);
    loginUrl.searchParams.set("error_description", detail.slice(0, 1200));
    return NextResponse.redirect(loginUrl);
  }

  const appBaseUrl = ctx.appBaseUrl;
  if (!appBaseUrl) {
    return new NextResponse(
      "Auth misconfiguration: app base URL is missing. Set AUTH0_BASE_URL or APP_BASE_URL.",
      { status: 500 },
    );
  }
  let path = "/";
  if (ctx.returnTo?.startsWith("/")) path = ctx.returnTo;
  else if (ctx.returnTo) path = `/${ctx.returnTo}`;
  return NextResponse.redirect(new URL(path, appBaseUrl));
}

function createClient(): Auth0Client {
  const audience = process.env.AUTH0_AUDIENCE?.trim();
  // In production we want an API access token available immediately for BFF → api-service calls (Save Job).
  // Keep local/dev safe: do not force audience unless explicitly enabled.
  const includeAudienceOnAuthorize =
    process.env.AUTH0_AUTHORIZE_AUDIENCE === "true" || (process.env.NODE_ENV === "production" && Boolean(audience));
  const authorizationParameters: { audience?: string; scope: string } = {
    scope: "openid profile email offline_access",
  };
  if (includeAudienceOnAuthorize && audience) {
    authorizationParameters.audience = audience;
  }
  return new Auth0Client({
    onCallback,
    authorizationParameters,
  });
}

export const auth0 = createClient();
