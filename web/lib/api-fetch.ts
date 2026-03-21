import { getUserId } from "./user-id";

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

export async function monFetch(pathWithQuery: string, init: RequestInit = {}) {
  const raw = pathWithQuery.startsWith("/") ? pathWithQuery.slice(1) : pathWithQuery;
  const [path, qs] = raw.split("?");
  const suffix = qs ? `?${qs}` : "";
  return fetch(`/api/mon/${path}${suffix}`, { ...init, cache: "no-store" });
}

export async function audioFetch(path: string, init: RequestInit = {}) {
  const p = path.startsWith("/") ? path.slice(1) : path;
  return fetch(`/api/audio/${p}`, { ...init, cache: "no-store" });
}
