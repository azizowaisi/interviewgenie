/**
 * Server-side URLs for BFF proxies (no CORS from browser).
 * Public site can call /api/mon/* and /api/app/* which forward here.
 */
export const monitoringBase =
  process.env.MONITORING_URL ||
  process.env.NEXT_PUBLIC_MONITORING_URL ||
  "http://127.0.0.1:3001";

export const apiBase =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8001";

export const audioBase =
  process.env.AUDIO_URL ||
  process.env.NEXT_PUBLIC_AUDIO_URL ||
  "http://127.0.0.1:8000";
