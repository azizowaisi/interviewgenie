import type { NextRequest } from "next/server";

/**
 * Canonical public origin of the Next.js app (links, Auth0 base URL, middleware redirects).
 *
 * Resolution order (set any one; prefer the same value everywhere in a given environment):
 * 1. NEXT_PUBLIC_PUBLIC_APP_URL — primary
 * 2. NEXT_PUBLIC_SITE_URL — alias
 * 3. AUTH0_BASE_URL — server/edge only (not inlined in client bundles)
 * 4. APP_BASE_URL — same as Auth0 “application URL” in many setups
 */

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/** Server / middleware / RSC — can use AUTH0_BASE_URL / APP_BASE_URL. */
export function getPublicAppOriginFromEnv(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.AUTH0_BASE_URL?.trim() ||
    process.env.APP_BASE_URL?.trim();
  return fromEnv ? stripTrailingSlash(fromEnv) : "";
}

/**
 * Client bundle — NEXT_PUBLIC_* only.
 * In `next dev`, falls back to http://localhost:3002 when unset so links work without a build-time env.
 */
export function getPublicAppOriginClient(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);
  if (process.env.NODE_ENV === "development") return "http://localhost:3002";
  return "";
}

export function hostnameFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function parseHostList(s: string | undefined): string[] {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Hostnames that should run “main app” middleware (API path redirects, etc.).
 * If NEXT_PUBLIC_MAIN_APP_HOSTS is set, it wins. Otherwise we derive from the public origin,
 * then fall back to the incoming request host, then localhost-style names for bare local dev.
 */
export function getMainAppHostnames(request?: NextRequest): string[] {
  const explicit = process.env.NEXT_PUBLIC_MAIN_APP_HOSTS?.trim();
  if (explicit) return parseHostList(explicit);

  const pub = getPublicAppOriginFromEnv();
  if (pub) {
    const h = hostnameFromOrigin(pub);
    if (h) return [h];
  }
  if (request) {
    const rh = request.nextUrl.hostname.toLowerCase();
    if (rh) return [rh];
  }
  return ["localhost", "127.0.0.1"];
}

export function getAdminHostnames(): string[] {
  return parseHostList(process.env.NEXT_PUBLIC_ADMIN_HOSTS?.trim());
}

/** Absolute URL for the public marketing / app site (redirects, links). */
export function resolveMiddlewarePublicAppBase(request: NextRequest): string {
  const fromEnv = getPublicAppOriginFromEnv();
  if (fromEnv) return fromEnv;
  return `${request.nextUrl.protocol}//${request.nextUrl.host}`;
}

/**
 * Where the “admin” UI lives when using a separate admin hostname.
 * If unset, callers should not redirect /admin away from the current host (e.g. local dev on one origin).
 */
export function getAdminSiteBaseFromEnv(): string {
  const fromEnv = process.env.NEXT_PUBLIC_ADMIN_SITE_URL?.trim();
  return fromEnv ? stripTrailingSlash(fromEnv) : "";
}
