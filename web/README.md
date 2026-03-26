# InterviewGenie — Next.js web app

Production-style frontend: **Next.js 15 (App Router)**, **Tailwind CSS**, **shadcn/ui-style** components, **TypeScript**.

## Routes

| Path | Purpose |
|------|---------|
| `/` | Landing (marketing) |
| `/interview` | Dashboard: CV, JD, type, duration → start mock |
| `/upload` | CV + JD → ATS analysis + simple charts |
| `/mock` | Timed mock interview (text answers; voice later) |
| `/result` | Scores & feedback (`?attempt=` loads from API) |
| `/history` | Topics & attempts |
| `/admin` | Monitoring UI (cluster, services, pods, logs, restart) |

Marketing pages use the global header/footer; **admin** uses its own sidebar + top bar (no marketing chrome).

## Local dev

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

App runs on **http://localhost:3002** (avoids clashing with other services on 3000).

### Environment

- **`API_URL`** — FastAPI `api-service` (default `http://127.0.0.1:8001`). Browser calls are proxied via **`/api/app/*`** (adds `X-User-Id` from `localStorage` for dev without Auth0).
- **`AUDIO_URL`** — `audio-service` for `/mock/generate-questions` and `/mock/evaluate-attempt` via **`/api/audio/*`**.
- **`MONITORING_URL`** — monitoring FastAPI (default `http://127.0.0.1:3001`) via **`/api/mon/*`**.
- **`MONITORING_ADMIN_TOKEN`** — sent server-side as `X-Admin-Token` when the monitoring API requires it.

Auth0 (login / signup)
- Auth0 config is optional (`AUTH0_*`). When configured, the website requires login for the interview flows.
- Environment variables live in `web/.env.example`.

### Spec-style endpoints (same origin)

- `POST /api/start-interview` — creates topic + attempt (CV still via `POST /api/app/topics/{id}/cv`).
- `POST /api/evaluate` — forwards body to audio `mock/evaluate-attempt`.

## Docker (production / local full stack)

The repo root can start this app with **`docker-compose.local.yml`** (see `docs/LOCAL-FULL-STACK.md`).  
Image is built from `web/Dockerfile` using Next **standalone** output.

## Build

```bash
npm run build
npm start
```

## Structure

- `app/(site)/` — public marketing + interview flows
- `app/admin/` — monitoring dashboard
- `app/api/app|audio|mon/` — BFF proxies (CORS-free)
- `components/ui/` — shadcn-style primitives
- `components/interview/`, `components/dashboard/`, `components/charts/`
