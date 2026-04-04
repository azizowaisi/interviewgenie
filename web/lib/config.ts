/**
 * Server-side URLs for BFF proxies (no CORS from browser).
 * Public site can call /api/mon/* and /api/app/* which forward here.
 * 
 * In Docker: use service names (api-service, monitoring-local, audio-service)
 * In Kubernetes: use k8s DNS (api-service.default.svc.cluster.local, etc.)
 * Locally: can use localhost (but docker-compose.local.yml overrides with service names)
 */
export const monitoringBase =
  process.env.MONITORING_URL ||
  process.env.NEXT_PUBLIC_MONITORING_URL ||
  "http://monitoring-local:3001";

export const apiBase =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://api-service:8001";

export const audioBase =
  process.env.AUDIO_URL ||
  process.env.NEXT_PUBLIC_AUDIO_URL ||
  "http://audio-service:8000";
