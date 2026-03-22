/**
 * Same localStorage key as backend/monitoring-service Vue admin UI (monitorLogic.js).
 * Used when the web pod has no MONITORING_ADMIN_TOKEN but monitoring-service enforces ADMIN_TOKEN.
 */
export const MONITORING_ADMIN_TOKEN_LS = "adminToken";

export function readClientMonitoringToken(): string {
  if (typeof window === "undefined") return "";
  return (localStorage.getItem(MONITORING_ADMIN_TOKEN_LS) || "").trim();
}

/** Headers to send from the browser to our Next.js /api/mon BFF (forwarded upstream when server env is unset). */
export function clientMonHeaders(): HeadersInit {
  const t = readClientMonitoringToken();
  return t ? { "X-Admin-Token": t } : {};
}
