# AI Real-Time Interview Assistant (Interview Genie)

**Offline-capable, open-source** interview assistant: speak into the mic, get a **STAR-format** answer (Situation, Task, Action, Result) from a local LLM. Voice uses **Whisper** (local speech-to-text); answers use **Ollama** (local LLM). Run with **Docker Compose** on one machine, or deploy with **Kubernetes** (e.g. k3s).

---

## How it works

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
      LLM Service (Ollama + Mistral 7B, streaming)
        |
        v
  Answer Formatter (STAR)  ------>  Frontend (tokens + final STAR)
```

### Components

| Component | Role | Tech |
|-----------|------|------|
| **Audio Service** | Receives WebSocket audio, runs pipeline, streams tokens to client | FastAPI, Python |
| **Whisper Service** | Local speech-to-text (faster-whisper, **base** or **small**) | FastAPI, faster-whisper |
| **STT Service** | Forwards audio to Whisper, returns transcript to pipeline | FastAPI |
| **Question Service** | Builds concise STAR prompt (2–3 lines, interview-style) | FastAPI |
| **LLM Service** | Streams tokens from Ollama (default **Mistral 7B**) | FastAPI, Ollama API |
| **Formatter Service** | Parses LLM output into STAR fields | FastAPI |
| **API Service** | CV/topics/history, optional Auth0, MongoDB | FastAPI |
| **Ollama** | Local LLM; keep `ollama serve` running so models stay loaded | Ollama |
| **Web** | Next.js UI (interview flows, ATS, history, BFF proxies) | Next.js |
| **Ingress** | (Optional) TLS and routing | Traefik (common on k3s) |
| **Monitoring** | (Optional) Admin UI + JSON API for cluster ops | FastAPI (`monitoring-service`) |

---

## Quick start (local)

### Backend with Docker Compose

```bash
# From project root
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile ollama up -d --build
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile ollama exec ollama ollama pull mistral
```

Starts **MongoDB** (27017), **RabbitMQ** (5672/15672), **api-service** (8001), **cv-optimize-worker**, **cv-renderer-service**, **audio-service** (8000), **whisper**, **stt**, **question**, **llm-service**, **formatter**, and **Ollama** (11434).

- **WebSocket:** `ws://localhost:8000/ws/audio`
- After ~1 s of silence, the question is sent to the LLM and the answer **streams** back.
- **Whisper:** default **base**; set `WHISPER_MODEL=small` for better accuracy.
- **Ollama:** default `mistral`; override with `OLLAMA_MODEL` if you intentionally want a different model.

### Full stack + Next.js (browser)

```bash
npm run local:up
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile ollama exec ollama ollama pull mistral
```

- **Web:** http://localhost:3002  
- **API:** http://localhost:8001  

More detail: **[docs/LOCAL-FULL-STACK.md](docs/LOCAL-FULL-STACK.md)**.

### Desktop (Electron)
Removed from this project. This repository focuses on the **website**.

---

## Verify it’s working

| Step | What to do | Expected |
|------|------------|----------|
| Backend up | `docker compose -f docker-compose.yml -f docker-compose.local.yml --profile ollama ps` | Core services running |
| Audio health | `curl -s http://localhost:8000/health` | `{"status":"ok"}` |
| API health | `curl -s http://localhost:8001/health` | `{"status":"ok"}` |
| Voice Q&A | Electron or web → record → ask a question | Transcript, then streamed STAR answer |
| No-login API | `curl -s -X POST http://localhost:8001/cv/upload -H "X-User-Id: default" -F "file=@/path/to/cv.pdf"` | JSON with `id`, `filename` |
| ATS CV optimizer | Open **`/ats`** → click **Generate ATS CV (.docx)** | Progress updates, then **Download ATS CV (.docx)** |

For **no-login** mode, send **`X-User-Id: default`** on API requests and `user_id: "default"` in the first WebSocket message where the protocol expects it.

---

## ATS CV optimizer (local-only)

The ATS optimizer runs **locally** (Ollama + worker queue):

- **UI**: `http://localhost:3002/ats`
- **Generate flow**: click **Generate ATS CV (.docx)** → UI polls a background job until it’s done → download appears.
- **Refresh-safe**: if you refresh the page mid-generation, the UI **resumes the same job** and continues polling (so you don’t generate twice).

Notes:
- `llm-service` is **internal-only** (no host port published). Other containers call it via `http://llm-service:8000`.
- `cv-renderer-service` is **internal-only** and deterministically renders CV JSON → DOCX (no LLM).
- Ollama is available on the host at `http://localhost:11434`.

---

## Kubernetes (k3s)

**Rough sizing for the full in-repo stack** (API, audio, MongoDB, STT, question, LLM, formatter, Ollama, ingress): single node on the order of **16–24 GB RAM**, **4+ CPU**, **40+ GB disk** (models and uploads dominate). Smaller nodes suit trimmed or Docker-only setups.

```bash
kubectl apply -f k8s/traefik/helmchartconfig.yaml   # TLS — adjust for your cluster
kubectl apply -k k8s/
kubectl exec -n interview-ai deploy/ollama -- ollama pull mistral
```

Manifests under **`k8s/`** define routing: web BFF, WebSocket to audio, API paths to **api-service**, optional admin host. STT expects a **Whisper** endpoint (`WHISPER_URL`); add a Whisper workload or an external URL as needed.

**Further reading:** [docs/DEPLOY-GIT-K8S.md](docs/DEPLOY-GIT-K8S.md), [docs/DEPLOY-WEB-ADMIN-GIT.md](docs/DEPLOY-WEB-ADMIN-GIT.md), [docs/AUTH0-WEBSITE.md](docs/AUTH0-WEBSITE.md), [docs/MONITORING-ADMIN.md](docs/MONITORING-ADMIN.md), [docs/VUE-FRONTENDS.md](docs/VUE-FRONTENDS.md), [docs/K8S-SCALING-AND-ROLLING.md](docs/K8S-SCALING-AND-ROLLING.md), [docs/K8S-LLM-FULL-ARCHITECTURE.md](docs/K8S-LLM-FULL-ARCHITECTURE.md) (LLM/Ollama resource path on one node).

---

## Performance (typical targets)

With **Mistral 7B** and **Whisper base/small**:

| Step | Target |
|------|--------|
| Speech recognition | ~500–800 ms |
| LLM first token | ~1–3 s |
| Full answer (short STAR) | ~2–6 s |

Answers **stream** to the client. **Audio service** can call LLM **`/warmup`** on startup to reduce cold starts.

**Local/offline hardware (indicative):** modern **x86_64** or **ARM64**; plan for **12 GB+ RAM** for the default Mistral path, with **16–24 GB** preferred for the full stack. **No GPU required** for the default path.

---

## Configuration

- **Audio Service:** `STT_SERVICE_URL`, `QUESTION_SERVICE_URL`, `LLM_SERVICE_URL`, `FORMATTER_SERVICE_URL`
- **STT Service:** `WHISPER_URL` — must point at a working Whisper-compatible HTTP API for speech to work
- **LLM Service:** `OLLAMA_HOST` (default `http://ollama:11434`), `OLLAMA_MODEL` (default `mistral`)
- **Whisper Service:** `WHISPER_MODEL` — `base` (default) or `small`

Auth0 for the **website** (callbacks, API audience, social logins): **`docs/AUTH0-WEBSITE.md`**. If login or **Save Job** has failed for days: **`docs/AUTH0-END-TO-END-FIX.md`** (ordered kubectl + secret patch). CI and Kubernetes secrets: **`docs/GITHUB-ENVIRONMENT.md`**. Local: copy **`web/.env.local.example`** → **`web/.env.local`** (and see **`web/.env.example`**).

---

## Project layout

```
InterviewGenie/
├── backend/
│   ├── audio-service/
│   ├── whisper-service/
│   ├── stt-service/
│   ├── question-service/
│   ├── llm-service/
│   ├── formatter-service/
│   ├── api-service/          # REST, CV, topics, Auth0 optional
│   └── monitoring-service/   # optional cluster admin API
├── web/                      # Next.js UI + BFF
├── k8s/
├── docker-compose.yml
└── .github/workflows/
```

---

## Testing

```bash
./scripts/run_tests.sh
```

Or per service: `cd backend/<service> && pip install -r requirements.txt && pytest tests/ -v`  
Tests mock HTTP peers (Whisper, Ollama) and run offline.

---

## CI/CD

- **Pull requests:** `.github/workflows/ci.yml` — backend pytest, frontend builds, Docker builds.
- **Main branch:** `.github/workflows/build-and-deploy.yml` — images and optional cluster deploy.

Details: **[docs/DEPLOY-GIT-K8S.md](docs/DEPLOY-GIT-K8S.md)**, **[docs/BRANCH-PROTECTION.md](docs/BRANCH-PROTECTION.md)**, **[docs/DEVOPS-RUNBOOK.md](docs/DEVOPS-RUNBOOK.md)** (CI/CD, secrets, k8s ops, Dependabot).

---

## Security notes

- Use **TLS** and **`wss://`** when exposing the stack publicly.
- Keep secrets in env / Kubernetes Secrets, not in git.
- Restrict or authenticate admin and API surfaces as needed.

---

## Troubleshooting

- **`llm_failed:`** — Ollama not running, model not pulled, or `OLLAMA_HOST` unreachable. Check `docker compose logs llm-service` and `ollama`.
- **No speech** — Ensure **`WHISPER_URL`** is set for STT and Whisper is running.
- **`curl http://localhost:8000/ready` is 404** — that port is **audio-service**. `llm-service` is internal-only; check readiness via `docker compose exec llm-service python3 -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/ready').read().decode())"`.

---

## Possible extensions

- Interview simulation (LLM as interviewer with follow-ups).
- Stronger resume/CV context in prompts.
- Text-to-speech for answers.

---

## License

See the license file in the repository root if present.
