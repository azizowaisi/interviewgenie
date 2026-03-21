import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Hostnames that serve only the operations UI at `/` (rewritten to `/admin` internally). */
const DEFAULT_ADMIN_HOSTS = "admin.interviewgenie.teckiz.com";

/** Public product URL (main app); used when someone hits a marketing path on the admin host. */
const DEFAULT_PUBLIC_APP_URL = "https://interviewgenie.teckiz.com";

/** Where to send users who open `/admin` on the main app host (when Next.js serves that host). */
const DEFAULT_ADMIN_SITE_URL = "https://admin.interviewgenie.teckiz.com";

const DEFAULT_MAIN_APP_HOSTS = "interviewgenie.teckiz.com,www.interviewgenie.teckiz.com";

function parseHosts(s: string) {
  return s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function hostOnly(h: string | null) {
  return h?.split(":")[0]?.toLowerCase() ?? "";
}

/** FastAPI public prefix (must match k8s ingress + Traefik strip). */
const PUBLIC_API_SVC = "/api/svc";

export function middleware(request: NextRequest) {
  const host = hostOnly(request.headers.get("host"));
  const { pathname, search } = request.nextUrl;

  const adminHosts = parseHosts(process.env.NEXT_PUBLIC_ADMIN_HOSTS || DEFAULT_ADMIN_HOSTS);
  const mainAppBase = (process.env.NEXT_PUBLIC_PUBLIC_APP_URL || DEFAULT_PUBLIC_APP_URL).replace(/\/$/, "");
  const adminSiteBase = (process.env.NEXT_PUBLIC_ADMIN_SITE_URL || DEFAULT_ADMIN_SITE_URL).replace(/\/$/, "");
  const mainAppHosts = parseHosts(process.env.NEXT_PUBLIC_MAIN_APP_HOSTS || DEFAULT_MAIN_APP_HOSTS);

  // Old ingress sent these to FastAPI/audio on bare paths; redirect so / stays the Next.js app only.
  // Omit /history — that path is the Next.js interview history page, not the REST API.
  if (
    mainAppHosts.includes(host) &&
    !adminHosts.includes(host) &&
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

  if (adminHosts.includes(host)) {
    if (pathname === "/" || pathname === "") {
      return NextResponse.rewrite(new URL(`/admin${search}`, request.url));
    }
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL(`${pathname}${search}`, mainAppBase));
  }

  if (mainAppHosts.includes(host) && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    const target = new URL("/", adminSiteBase);
    target.search = request.nextUrl.searchParams.toString();
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
