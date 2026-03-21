const STORAGE_KEY = "ig_user_id";

/** Stable anonymous id for X-User-Id (dev / no Auth0). */
export function getUserId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
