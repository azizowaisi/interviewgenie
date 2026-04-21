import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import {
  looksLikeJwt,
  pickJwtBearer,
  pickJwtBearerForApi,
  shouldSetAuthorizationFromSdkAccessToken,
} from "@/lib/api-bearer-pick";
import { apiBase } from "@/lib/config";

type Ctx = { params: Promise<{ path?: string[] | string }> };

/** Next may pass catch-all `path` as string[] or, in edge cases, a single string. */
function normalizePathSegments(path: string[] | string | undefined): string[] {
  if (path == null) return [];
  return Array.isArray(path) ? path : [path];
}

function b64UrlToJson(seg: string): unknown {
  try {
    const pad = seg.length % 4 === 0 ? "" : "=".repeat(4 - (seg.length % 4));
    const b64 = (seg + pad).replaceAll("-", "+").replaceAll("_", "/");
    const raw = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function jwtMeta(token: string): { aud?: unknown; exp?: unknown; iss?: unknown; sub?: unknown } | null {
  if (!looksLikeJwt(token)) return null;
  const payloadSeg = token.split(".")[1] ?? "";
  const payload = b64UrlToJson(payloadSeg);
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  return { aud: o.aud, exp: o.exp, iss: o.iss, sub: o.sub };
}

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

async function attachBearerForApi(
  req: NextRequest,
  headers: Headers,
  tokenSidecar: NextResponse,
): Promise<{ source: "sdk" | "session" | "none"; meta: ReturnType<typeof jwtMeta> }> {
  const aud = process.env.AUTH0_AUDIENCE?.trim();

  const fromSdk = await (async () => {
    try {
      const at = aud
        ? await auth0.getAccessToken(req, tokenSidecar, { audience: aud })
        : await auth0.getAccessToken(req, tokenSidecar);
      if (shouldSetAuthorizationFromSdkAccessToken(aud, at) && at?.token) return at.token;
    } catch {
      // getAccessToken may fail if no API access token in session — fall through to session tokens.
    }
    return undefined;
  })();

  // getAccessToken may refresh tokens; the returned JWT is fresh. getSession(req) still reads
  // request cookies, which can hold an expired id_token — prefer SDK JWT when it is a JWT.
  if (fromSdk && looksLikeJwt(fromSdk)) {
    headers.set("Authorization", `Bearer ${fromSdk}`);
    return { source: "sdk", meta: jwtMeta(fromSdk) };
  }

  const fromSession = await (async () => {
    try {
      const session = await auth0.getSession(req);
      if (!session) return undefined;
      const scoped = aud ? session.accessTokens?.find((t) => t.audience?.trim() === aud) : undefined;
      return aud
        ? pickJwtBearerForApi(aud, session.tokenSet?.idToken, scoped?.accessToken, session.tokenSet?.accessToken)
        : pickJwtBearer(session.tokenSet?.idToken, scoped?.accessToken, session.tokenSet?.accessToken);
    } catch {
      return undefined;
    }
  })();

  if (fromSession) {
    headers.set("Authorization", `Bearer ${fromSession}`);
    return { source: "session", meta: jwtMeta(fromSession) };
  }
  return { source: "none", meta: null };
}

async function forward(req: NextRequest, segments: string[]) {
  const path = segments.filter(Boolean).join("/");
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

  async function upstreamOnce(target: URL, headers: Headers): Promise<Response> {
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
    return fetch(target, init);
  }

  async function upstream(target: URL, headers: Headers): Promise<Response> {
    // During local dev we rebuild/restart api-service frequently; a short retry makes status polling resilient.
    const canRetry = req.method === "GET" || req.method === "HEAD";
    const attempts = canRetry ? 4 : 1;
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await upstreamOnce(target, headers);
      } catch (e) {
        lastErr = e;
        // Only retry on "network-ish" errors (ECONNREFUSED / fetch failed).
        const msg = e instanceof Error ? e.message : "";
        if (!canRetry) break;
        if (msg && !msg.includes("ECONNREFUSED") && !msg.includes("fetch failed")) break;
        const delayMs = 150 * Math.pow(2, i); // 150, 300, 600, 1200ms
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
  }

  const headers = new Headers();
  const uid = req.headers.get("x-user-id");
  if (uid) headers.set("X-User-Id", uid);
  const auth = req.headers.get("authorization");
  if (auth) headers.set("Authorization", auth);

  // Pass NextResponse so getAccessToken can persist refreshed tokens (Set-Cookie).
  // Without (req, res), App Router route handlers may not save rotation — Save Job then gets 401.
  const tokenSidecar = new NextResponse();
  let authInfo: Awaited<ReturnType<typeof attachBearerForApi>>;
  try {
    authInfo = await attachBearerForApi(req, headers, tokenSidecar);
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

  let res: Response;
  try {
    res = await upstream(target, headers);
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
  if (res.status === 401) {
    // Diagnose intermittent 401s: log claim-level token info without printing the token itself.
    console.warn("[api/app] upstream 401", {
      path,
      target: target.origin + target.pathname,
      auth_source: authInfo.source,
      jwt: authInfo.meta,
    });
  }
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
    return await forward(req, normalizePathSegments(path));
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
