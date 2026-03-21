# AI Real-Time Interview Assistant (Interview Genie)

**Fully offline, open-source** interview assistant: speak a question into your mic, get a **STAR-format** answer (Situation, Task, Action, Result) from a local LLM. No internet required — voice uses **Whisper** (local speech-to-text) and answers use **Ollama** (local LLM). Designed to run on a single machine (laptop or cloud VM) with **Docker** and optionally **Kubernetes (k3s)**.

---

## Architecture

```
Microphone
        |
        v
  Audio stream (WebSocket)
        |
        v
  Backend (Audio Service)
        |
        v
  Whisper Service (local speech-to-text, base/small model)
        |
        v
  STT Service  ------>  Live transcript to UI
        |
        v
  Question Service (concise STAR prompt)
        |
        v
  LLM Service (Ollama + Qwen2.5 0.5B, streaming)
        |
        v
  Answer Formatter (STAR)  ------>  Frontend (tokens + final STAR)
```

### Components

| Component | Role | Tech |
|-----------|------|------|
| **Audio Service** | Receives WebSocket audio, runs pipeline, streams tokens to client | FastAPI, Python |
| **Whisper Service** | Local speech-to-text (faster-whisper, **base** or **small** model) | FastAPI, faster-whisper |
| **STT Service** | Forwards audio to Whisper, returns transcript to pipeline | FastAPI |
| **Question Service** | Builds concise STAR prompt (2–3 lines, interview-style) | FastAPI |
| **LLM Service** | Streams tokens from Ollama (default **Qwen2.5 0.5B**) | FastAPI, Ollama API |
| **Formatter Service** | Parses LLM output into STAR fields | FastAPI |
| **Ollama** | Local LLM; run once (`ollama serve`) so model stays loaded | Ollama (Qwen 0.5B / Llama 3.2 1B / Phi-3) |
| **Ingress** | (Optional) Exposes API and WebSocket | Traefik (k3s default) |
| **Monitoring** | (Optional) Lightweight admin UI + JSON API for pods/services/logs/restart | FastAPI + in-cluster RBAC (`monitoring-service`) |

---

## Quick start (local, fully offline)

### 1. Backend with Docker Compose

All processing runs on your machine. No internet needed after pulling images and models once.

```bash
# From project root (InterviewGenie/)
docker compose build
docker compose --profile ollama up -d

# Pull the LLM model once (Qwen2.5 0.5B for low latency; ~400 MB)
docker compose exec ollama ollama pull qwen2.5:0.5b
```

This starts: **MongoDB** (port 27017), **api-service** (8001), **audio-service** (8000), **whisper**, **stt**, **question**, **llm**, **formatter**, and **Ollama** (11434).

- **Whisper**: **faster-whisper** with the **base** model. Optional: set `WHISPER_MODEL=small` for better accuracy.
- **Ollama**: default model `qwen2.5:0.5b`. Switch via `OLLAMA_MODEL` (e.g. `llama3.2:1b`, `phi3`).

The **audio service** is on **port 8000** (WebSocket: `ws://localhost:8000/ws/audio`). Questions are **transcribed live**; after ~1 s of silence the question is sent to the LLM and the answer **streams back**.

### 2. Full stack + Next.js web (browser UI, `/admin` without Kubernetes)

From the repo root:

```bash
npm run local:up
# First time only:
docker compose --profile ollama exec ollama ollama pull qwen2.5:0.5b
```

- **Web app:** http://localhost:3002 (interview flows, ATS, history)
- **Admin:** same origin `/admin` (uses a **local monitoring stub** — not real cluster metrics)
- **API:** http://localhost:8001

Details, hybrid dev (Docker backends + `npm run dev` in `web/`), and **production** env vars: **[docs/LOCAL-FULL-STACK.md](docs/LOCAL-FULL-STACK.md)**.

### 3. Desktop client (Electron)

Defaults to **production** (`https://interviewgenie.teckiz.com` + `wss://…/ws/audio`). For **local** Docker, set `INTERVIEWGENIE_API_BASE`, `INTERVIEWGENIE_AUDIO_BASE`, and `INTERVIEWGENIE_WS_URL` — see `clients/electron-app/README.md`.

```bash
cd clients/electron-app
npm install
npm start
```

Click **Start recording** — the question appears **live** as you speak. After ~1 s of silence the answer streams in automatically. Click **Stop** to end the session.

### 4. Test that it’s working

| Step | What to do | Expected |
|------|------------|----------|
| Backend up | `docker compose --profile ollama ps` | All services (including api-service, mongo, audio-service) running |
| Audio health | `curl -s http://localhost:8000/health` | `{"status":"ok"}` |
| API health | `curl -s http://localhost:8001/health` | `{"status":"ok"}` |
| Voice Q&A | Open Electron app → Start recording → ask “What is your biggest strength?” | Live transcript, then streamed STAR answer |
| Typed Q&A | In the app, type a question in the text box and submit (if UI supports it) | Streamed STAR answer |
| No-login API | `curl -s -X POST http://localhost:8001/cv/upload -H "X-User-Id: default" -F "file=@/path/to/cv.pdf"` | JSON with `id`, `filename` (requires PDF/DOCX/TXT) |
| History | `curl -s "http://localhost:8001/history?limit=5" -H "X-User-Id: default"` | List of recent Q&A (after at least one answer with `user_id` sent over WebSocket) |

For **no-login** use, send **`X-User-Id: default`** on all API requests and, in the client, send `user_id: "default"` in the first WebSocket message to enable saving Q&A to the API.

### 5. Mobile client (Flutter)

```bash
cd clients/flutter-app
flutter pub get
# Generate platform folders if new project:
# flutter create .
flutter run
```

On Android emulator use `ws://10.0.2.2:8000/ws/audio`; on device use your host machine’s IP.

---

## Kubernetes (k3s) deployment

Target: single node (e.g. Oracle Cloud free ARM VM with 24 GB RAM).

### Server requirements to run full Kubernetes stack

To run the **full k8s stack** (all services in this repo: API, Audio, MongoDB, STT, Question, LLM, Formatter, Ollama, Ingress), use a **single node** with at least:

| Resource | Minimum | Recommended | Notes |
|----------|---------|--------------|--------|
| **RAM** | **16 GB** | **24 GB** | Ollama (Qwen 0.5B) can use up to 12 GB; STT/Mongo/API/Audio need ~2–3 GB; 24 GB leaves headroom for OS and larger models. |
| **CPU** | **4 cores** | **6–8 cores** | Ollama and STT are CPU-heavy; more cores improve latency. |
| **Disk** | **40 GB** | **60 GB+** | 20 GB (Ollama models PVC) + 5 GB (CV uploads PVC) + MongoDB + OS and images. |
| **OS** | Linux (x86_64 or ARM64) | — | k3s runs on most Linux distros; ARM64 (e.g. Oracle Cloud free tier) is supported. |

**Example suitable servers:**

- **Oracle Cloud Free Tier**: 4 OCPUs, 24 GB RAM (ARM) — fits the recommended profile.
- **Hetzner / DigitalOcean / AWS**: 8 GB RAM node can run a reduced stack; for **full** stack (all limits as in `k8s/`) use **16–24 GB RAM**, 4+ vCPUs, 40+ GB disk.

**Note:** The manifests in `k8s/` do not include a Whisper deployment; STT service expects a `WHISPER_URL`. For full voice pipeline on k8s you can either run Whisper in-cluster (add a Whisper deployment and point STT to it) or use an external Whisper endpoint.

### Prerequisites

- k3s installed (`curl -sfL https://get.k3s.io | sh`)
- `kubectl` configured
- Optional: Traefik IngressRoute CRD (k3s often includes it)

### Deploy

```bash
# Traefik ACME / TLS (must be kube-system — not part of kustomize namespace)
kubectl apply -f k8s/traefik/helmchartconfig.yaml

# Namespace and app resources
kubectl apply -k k8s/

# Pull LLM model inside cluster (after Ollama pod is running; Qwen 0.5B for low latency)
kubectl exec -n interview-ai deploy/ollama -- ollama pull qwen2.5:0.5b
```

### Rolling updates & autoscaling (k3s)

- Deployments use **readiness probes** and **rolling update** strategies: stateless services allow **`maxSurge: 1`** so traffic can move to a new pod before the old one terminates (when the node has capacity).
- **`api-service`** / **ollama** use **ReadWriteOnce** volumes → **`maxSurge: 0`** (only one pod can mount the volume). There may be a **brief** gap on image updates; for stricter HA use shared/RWX storage or S3 for uploads.
- **HPA** (`k8s/hpa/stateless-services.yaml`) scales **audio, stt, question, llm, formatter** on CPU/memory (needs **metrics-server**, included with k3s). Tune **`maxReplicas`** to your VM size — HPA does **not** grow the VM itself.
- Details: **`docs/K8S-SCALING-AND-ROLLING.md`**.

### Admin monitoring dashboard

- **Host**: `https://admin.interviewgenie.teckiz.com` (add DNS **A** record → same IP as the main site; Traefik IngressRoute: `k8s/ingress/admin-ingressroute.yaml`).
- **Stack**: single pod **`monitoring-service`** (FastAPI + **Vue**-built admin UI), **metrics-server** for CPU/RAM columns, **no** Prometheus/Grafana.
- **Security**: optional `kubectl create secret generic monitoring-admin -n interview-ai --from-literal=ADMIN_TOKEN=...` — then set the token in the UI header.
- Full setup: **`docs/MONITORING-ADMIN.md`**.

### Web UI (same flows as Electron)

- **Vue 3 + Vite** apps: **`backend/api-service/frontend/`** (marketing + `/app` shell) and **`backend/monitoring-service/frontend/`** (admin). See **`docs/VUE-FRONTENDS.md`**.
- **`/`** — Landing (Vue); CTA → **`/app`**.
- **`/app`** — Interview workspace (Vue route; loads **`workspace.js`** + **`web-bridge.js`** — same behavior as the former single `app.html`).

### Expose the API

- **Option A – Traefik IngressRoute** (if CRD exists): Already applied via `k8s/ingress/ingressroute.yaml`. Point your host (e.g. `interview-ai.local`) to the node IP and use `http://interview-ai.local/ws/audio` for WebSocket.
- **Option B – Standard Ingress**: Apply `k8s/ingress/ingress-v1.yaml` and use the same host/path.

### Resource summary (per service)

| Service | RAM (approx) | Notes |
|---------|----------------|-------|
| Ollama (Qwen 0.5B) | ~1–4 GB | k8s limits: up to 12 GB; larger models need 4–6 GB. |
| STT | ~1 GB | k8s: 512Mi–1Gi. |
| Mongo + API + Audio + LLM + Formatter + Question | ~500 MB–1 GB | Combined. |
| **Total (full k8s)** | **16–24 GB node** | See “Server requirements to run full Kubernetes stack” above. |

A **4 GB VM** is only enough for a minimal Docker setup (Ollama + STT + one backend); for the **full k8s** stack use **16–24 GB RAM**, 4+ CPU, 40+ GB disk.

---

## Performance (real-time targets)

With **Qwen2.5 0.5B** and **Whisper base/small**:

| Step | Target |
|------|--------|
| Speech recognition | 500–800 ms |
| LLM first token | &lt; 1 s |
| Full answer (concise STAR) | 1–2 s |

Answers are **streamed** to the client as tokens are generated. The prompt asks for **2–3 short lines** (interview-style, not a speech) to keep latency low. Run `ollama serve` once; the audio-service calls `GET /warmup` on startup to keep the model loaded and avoid cold starts.

**Recommended stack for lowest latency:** faster-whisper (base/small) + Qwen2.5 0.5B + Ollama streaming.

### Hardware requirements (local / offline)

- **CPU**: Modern x86_64 or ARM64 (e.g. Apple Silicon, AMD64).
- **RAM**: ~4 GB minimum (Whisper base ~1–2 GB, Ollama Qwen 0.5B ~1 GB, rest for OS and other services). For Whisper **small** or LLM **phi3**, use 8 GB+.
- **Disk**: ~2 GB for Docker images and Ollama model (qwen2.5:0.5b).
- **No GPU required**; everything runs on CPU. GPU can speed up Whisper/Ollama if configured.

---

## Configuration

### Environment variables

- **Audio Service**: `STT_SERVICE_URL`, `QUESTION_SERVICE_URL`, `LLM_SERVICE_URL`, `FORMATTER_SERVICE_URL`. Calls LLM `/warmup` on startup to keep the model loaded.
- **STT Service**: `WHISPER_URL` – if set, POSTs audio to this URL for transcription; otherwise no speech is recognized (user sees “No speech detected” until you configure Whisper).
- **LLM Service**: `OLLAMA_HOST` (default `http://ollama:11434`), `OLLAMA_MODEL` (default `qwen2.5:0.5b`). Alternatives: `llama3.2:1b` (better reasoning), `phi3` (stronger, slower).

### Speech-to-Text (local, offline)

The **whisper-service** (faster-whisper) runs in Docker and is used by the STT service. No internet or cloud APIs. Use **base** (default) for lowest latency or **small** for better transcription; set `WHISPER_MODEL=base` or `WHISPER_MODEL=small` in the whisper-service environment.

---

## Project layout

```
InterviewGenie/
├── backend/
│   ├── audio-service/      # WebSocket pipeline: STT → Question → LLM → Formatter
│   ├── whisper-service/    # Local STT (faster-whisper, base/small)
│   ├── stt-service/        # Forwards audio to Whisper, returns transcript
│   ├── question-service/    # Interview question → STAR prompt
│   ├── llm-service/         # Ollama client
│   └── formatter-service/   # STAR parser
├── clients/
│   ├── electron-app/        # Desktop (mic → WebSocket → STAR UI)
│   └── flutter-app/         # Mobile (same flow)
├── k8s/
│   ├── namespace.yaml
│   ├── ingress/
│   ├── audio-service/
│   ├── stt-service/
│   ├── question-service/
│   ├── llm-service/
│   ├── formatter-service/
│   ├── ollama/              # Deployment + PVC for models
│   └── kustomization.yaml
├── docker-compose.yml       # Local stack
└── .github/workflows/       # Build (and optional push/deploy)
```

---

## Testing

Backend services include unit and mock tests (pytest).

```bash
# Run all backend tests (from repo root; requires Python 3.11+ and pip)
./scripts/run_tests.sh

# Or run per service
cd backend/question-service && pip install -r requirements.txt && pytest tests/ -v
cd backend/formatter-service && pip install -r requirements.txt && pytest tests/ -v
cd backend/llm-service && pip install -r requirements.txt && pytest tests/ -v
cd backend/stt-service && pip install -r requirements.txt && pytest tests/ -v
cd backend/audio-service && pip install -r requirements.txt && pytest tests/ -v
```

Tests mock external HTTP (e.g. Whisper, Ollama) so they run offline.

---

## CI/CD (GitHub Actions)

- **Test**: On push/PR, runs backend unit tests (pytest) then builds.
- **Build**: Builds all backend Docker images.
- **Push**: On push to `main`, logs in to Docker Hub (if `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` are set) and pushes images.
- **Deploy**: Set repository **variable** `DEPLOY_MODE` to `ssh`, `remote`, or `self_hosted` (GitHub does not allow `secrets` in workflow `if:`). Add matching secrets (`KUBE_CONFIG`, SSH secrets, or a self-hosted runner). See [Deploy through Git to Kubernetes (single VM)](docs/DEPLOY-GIT-K8S.md).

---

## Security (recommendations)

- Use **TLS** (e.g. Let’s Encrypt) and **wss://** in production.
- Add **API authentication** (e.g. API key or JWT) in front of the audio service or at the ingress.
- Store secrets in **Kubernetes Secrets** (or a vault), not in manifests.

---

## Troubleshooting

- **`llm_failed:`** – The LLM step failed. Common causes:
  - **Ollama not running**: Start with `docker compose --profile ollama up -d`.
  - **Model not pulled**: Run `docker compose exec ollama ollama pull qwen2.5:0.5b` (or the model set in `OLLAMA_MODEL`).
  - **Connection refused / timeout**: Ensure the `llm-service` container can reach `OLLAMA_HOST` (default `http://ollama:11434`). Check `docker compose logs llm-service` and `docker compose logs ollama`.

- **App “doesn’t listen” / always the same question (“Tell me about a time you led a project”)** – The app was using a fixed mock when no speech-to-text was configured. That mock is removed: if STT is not set up, you now get “No speech detected” instead. To have the app transcribe your voice, set **`WHISPER_URL`** for the STT service to a Whisper-compatible API (see “Speech-to-Text (Whisper.cpp)” above).

---

## Possible extensions

- **Interview simulation**: LLM acts as interviewer and asks follow-up questions.
- **Resume injection**: Include the user’s CV in the prompt for tailored answers.
- **Voice output**: Add text-to-speech (e.g. Coqui TTS) to read answers aloud.

---

## License

Open source; use the license file in the repo if present.

# interviewgenie
