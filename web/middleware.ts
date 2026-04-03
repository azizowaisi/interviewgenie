import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth0 } from "@/lib/auth0";
import { isAuth0Configured } from "@/lib/auth0-config";
import {
  getAdminHostnames,
  getAdminSiteBaseFromEnv,
  getMainAppHostnames,
  resolveMiddlewarePublicAppBase,
} from "@/lib/site-url";

function hostOnly(h: string | null) {
  return h?.split(":")[0]?.toLowerCase() ?? "";
}

function isLocalHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function stripAdminPrefix(host: string) {
  return host.startsWith("admin.") ? host.slice("admin.".length) : host;
}

function deriveAdminSiteBase(request: NextRequest, host: string, adminSiteBaseFromEnv: string) {
  if (adminSiteBaseFromEnv) return adminSiteBaseFromEnv;
  const baseHost = stripAdminPrefix(host);
  if (!baseHost || isLocalHost(baseHost)) return "";
  return `${request.nextUrl.protocol}//admin.${baseHost}`;
}

/** FastAPI public prefix (must match k8s ingress + Traefik strip). */
const PUBLIC_API_SVC = "/api/svc";

export async function middleware(request: NextRequest) {
  const host = hostOnly(request.headers.get("host"));
  const { pathname, search } = request.nextUrl;

  // Auth0 mounts /auth/* endpoints and needs to run on all routes to keep session cookies in sync.
  if (pathname.startsWith("/auth")) {
    if (!isAuth0Configured()) {
      const exampleOrigin = resolveMiddlewarePublicAppBase(request).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Sign-in unavailable</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1>Sign-in is not configured</h1>
<p>This server is missing Auth0 environment variables, so <code>/auth/login</code> cannot start a login. Copy values from <code>web/.env.example</code> into your environment (at least <code>AUTH0_DOMAIN</code>, <code>AUTH0_CLIENT_ID</code>, <code>AUTH0_CLIENT_SECRET</code>, <code>AUTH0_SECRET</code>, and a single public app URL via <code>AUTH0_BASE_URL</code> or <code>NEXT_PUBLIC_PUBLIC_APP_URL</code> — for this request that should match <code>${exampleOrigin}</code>).</p>
<p>After updating env, restart the Next.js process.</p>
</body></html>`;
      return new NextResponse(body, {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return await auth0.middleware(request);
  }

  const adminHosts = getAdminHostnames();
  const mainAppBase = resolveMiddlewarePublicAppBase(request);
  const adminSiteBase = deriveAdminSiteBase(request, host, getAdminSiteBaseFromEnv());
  const mainAppHosts = getMainAppHostnames(request);
  const isAdminHost = adminHosts.includes(host) || host.startsWith("admin.");
  const normalizedMainHost = stripAdminPrefix(host);

  // Old ingress sent these to FastAPI/audio on bare paths; redirect so / stays the Next.js app only.
  // Omit /history — that path is the Next.js interview history page, not the REST API.
  if (
    (mainAppHosts.includes(host) || (!isAdminHost && mainAppHosts.includes(normalizedMainHost))) &&
    !isAdminHost &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/_next") &&
    pathname !== "/favicon.ico" &&
    !/\.[a-z0-9]+$/i.test(pathname)
  ) {
    const perm = 308;
    if (
      pathname === "/health" ||
      pathname === "/docs" ||
      pathname === "/openapi.json" ||
      pathname === "/redoc" ||
      pathname === "/app" ||
      pathname.startsWith("/app/")
    ) {
      return NextResponse.redirect(new URL(`${PUBLIC_API_SVC}${pathname}${search}`, request.url), perm);
    }
    if (pathname.startsWith("/assets") || pathname === "/static" || pathname.startsWith("/static/")) {
      return NextResponse.redirect(new URL(`${PUBLIC_API_SVC}${pathname}${search}`, request.url), perm);
    }
    const svcPrefixes = ["/cv", "/sessions", "/topics", "/attempts", "/ats", "/users"];
    if (svcPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NextResponse.redirect(new URL(`${PUBLIC_API_SVC}${pathname}${search}`, request.url), perm);
    }
    // Do not redirect /mock — Next.js serves the browser mock interview UI at /mock.
  }

  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    /\.[a-z0-9]+$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (isAdminHost) {
    if (pathname === "/" || pathname === "") {
      return NextResponse.rewrite(new URL(`/admin${search}`, request.url));
    }
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL(`${pathname}${search}`, mainAppBase));
  }

  if (
    adminSiteBase &&
    !isAdminHost &&
    (pathname === "/admin" || pathname.startsWith("/admin/"))
  ) {
    const targetPath = pathname === "/admin" ? "/admin" : pathname;
    const target = new URL(targetPath, adminSiteBase);
    target.search = request.nextUrl.searchParams.toString();
    return NextResponse.redirect(target, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
