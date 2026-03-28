import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { shouldSetAuthorizationFromSdkAccessToken } from "@/lib/api-bearer-pick";
import { apiBase } from "@/lib/config";

type Ctx = { params: Promise<{ path: string[] }> };

/** Copy Set-Cookie headers from Auth0 token refresh onto the outgoing BFF response. */
function mergeSetCookieHeaders(from: Headers, to: Headers) {
  const extended = from as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") {
    for (const c of extended.getSetCookie()) {
      to.append("Set-Cookie", c);
    }
    return;
  }
  const single = from.get("set-cookie");
  if (single) to.append("Set-Cookie", single);
}

async function attachBearerForApi(req: NextRequest, headers: Headers, tokenSidecar: NextResponse) {
  try {
    const aud = process.env.AUTH0_AUDIENCE?.trim();
    if (aud) {
      const at = await auth0.getAccessToken(req, tokenSidecar, { audience: aud });
      if (shouldSetAuthorizationFromSdkAccessToken(aud, at) && at?.token) {
        headers.set("Authorization", `Bearer ${at.token}`);
      }
    } else {
      const at = await auth0.getAccessToken(req, tokenSidecar);
      if (shouldSetAuthorizationFromSdkAccessToken(undefined, at) && at?.token) {
        headers.set("Authorization", `Bearer ${at.token}`);
      }
    }
  } catch {
    // getAccessToken may fail if no API access token in session — fall through to session tokens.
  }
  if (headers.has("Authorization")) return;
  try {
    const session = await auth0.getSession(req);
    if (!session) return;
    const aud = process.env.AUTH0_AUDIENCE?.trim();
    const scoped = aud
      ? session.accessTokens?.find((t) => t.audience?.trim() === aud)
      : undefined;
    // Prefer id_token over tokenSet.accessToken when no scoped API token: the default
    // access token may be opaque or wrong aud (decode fails → 401); id_token is a JWT
    // with aud=client_id, which api-service accepts when AUTH0_CLIENT_ID is set.
    const bearer =
      scoped?.accessToken ||
      session.tokenSet?.idToken ||
      session.tokenSet?.accessToken;
    if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  } catch {
    // Ignore — anonymous/dev flows still use X-User-Id.
  }
}

async function forward(req: NextRequest, segments: string[]) {
  const path = segments.join("/");
  let target: URL;
  try {
    target = new URL(`${apiBase.replace(/\/$/, "")}/${path}`);
  } catch {
    return NextResponse.json(
      { error: "bff_bad_api_base", detail: "API_URL / apiBase is not a valid URL" },
      { status: 500 },
    );
  }
  target.search = req.nextUrl.search;

  const headers = new Headers();
  const uid = req.headers.get("x-user-id");
  if (uid) headers.set("X-User-Id", uid);
  const auth = req.headers.get("authorization");
  if (auth) headers.set("Authorization", auth);

  // Pass NextResponse so getAccessToken can persist refreshed tokens (Set-Cookie).
  // Without (req, res), App Router route handlers may not save rotation — Save Job then gets 401.
  const tokenSidecar = new NextResponse();
  try {
    await attachBearerForApi(req, headers, tokenSidecar);
  } catch (e) {
    console.error("[api/app] attachBearerForApi", e);
    return NextResponse.json(
      {
        error: "bff_auth_attach_failed",
        detail: e instanceof Error ? e.message : "unknown",
      },
      { status: 500 },
    );
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.arrayBuffer();
    if (body.byteLength) init.body = body;
    const ct = req.headers.get("content-type");
    if (ct) headers.set("Content-Type", ct);
  }

  let res: Response;
  try {
    res = await fetch(target, init);
  } catch (e) {
    console.error("[api/app] upstream fetch failed", target.href, e);
    return NextResponse.json(
      {
        error: "bff_upstream_unreachable",
        detail: e instanceof Error ? e.message : "fetch failed",
        target: target.origin + target.pathname,
      },
      { status: 502 },
    );
  }
  const outHeaders = new Headers(res.headers);
  outHeaders.delete("content-encoding");
  outHeaders.delete("transfer-encoding");
  const out = new NextResponse(await res.arrayBuffer(), {
    status: res.status,
    headers: outHeaders,
  });
  mergeSetCookieHeaders(tokenSidecar.headers, out.headers);
  return out;
}

async function handle(req: NextRequest, ctx: Ctx) {
  try {
    const { path } = await ctx.params;
    return await forward(req, path);
  } catch (e) {
    console.error("[api/app] unhandled", e);
    return NextResponse.json(
      { error: "bff_internal", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}
