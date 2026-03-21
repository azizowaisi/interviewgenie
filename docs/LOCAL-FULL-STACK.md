# Run the full stack locally (Docker + Next.js)

Use this when you want **API + audio pipeline + Mongo + Ollama + Next.js web + /admin**, without Kubernetes.

## One command (recommended)

From the **repository root** (uses root `package.json` scripts only; no install required):

```bash
npm run local:up
```

Equivalent Docker command:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile ollama up -d --build
```

**First time only** — pull the small LLM (inside the Ollama container):

```bash
docker compose --profile ollama exec ollama ollama pull qwen2.5:0.5b
```

## URLs

| Service | URL |
|--------|-----|
| **Web app (Next.js)** | http://localhost:3002 |
| API (FastAPI) | http://localhost:8001 |
| Audio (WebSocket) | `ws://localhost:8000/ws/audio` |
| Monitoring **stub** (for /admin in Docker) | http://localhost:3001 |
| MongoDB | `mongodb://localhost:27017` |

## Stop

```bash
npm run local:down
```

## Hybrid dev (hot reload on the web UI)

Keep backends in Docker, run Next on the host:

```bash
docker compose --profile ollama up -d
# do NOT start the `web` service from docker-compose.local.yml
```

Create `web/.env.local`:

```env
API_URL=http://127.0.0.1:8001
AUDIO_URL=http://127.0.0.1:8000
MONITORING_URL=http://127.0.0.1:3001
```

Start the stub monitoring API (so /admin has data) **or** run only backends and accept empty admin:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d monitoring-local
```

Then:

```bash
cd web && npm install && npm run dev
```

Open http://localhost:3002.

## Production

- Build and run the same **`web/Dockerfile`** image in your environment.
- Set **`API_URL`**, **`AUDIO_URL`**, **`MONITORING_URL`** to your real services (Kubernetes monitoring service, not the stub).
- If monitoring enforces auth, set **`MONITORING_ADMIN_TOKEN`** on the web container (server-side only).

The **monitoring-local-stub** exists only for **local Docker** where there is no cluster API.
