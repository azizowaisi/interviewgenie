import { getUserId } from "./user-id";
import { clientMonHeaders } from "./monitoring-auth";

const appPrefix = "/api/app";

export async function appFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("X-User-Id", getUserId());
  return fetch(`${appPrefix}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

function mergeMonClientHeaders(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(clientMonHeaders() as Record<string, string>)) {
    headers.set(k, v);
  }
  return { ...init, headers, cache: init.cache ?? "no-store" };
}

export async function monFetch(pathWithQuery: string, init: RequestInit = {}) {
  const raw = pathWithQuery.startsWith("/") ? pathWithQuery.slice(1) : pathWithQuery;
  const [path, qs] = raw.split("?");
  const suffix = qs ? `?${qs}` : "";
  return fetch(`/api/mon/${path}${suffix}`, mergeMonClientHeaders(init));
}

/** Same auth headers as monFetch, for raw fetch URLs (e.g. POST /api/mon/restart). */
export function monRequestInit(init: RequestInit = {}): RequestInit {
  return mergeMonClientHeaders(init);
}

export async function audioFetch(path: string, init: RequestInit = {}) {
  const p = path.startsWith("/") ? path.slice(1) : path;
  return fetch(`/api/audio/${p}`, { ...init, cache: "no-store" });
}
