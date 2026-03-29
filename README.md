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
  LLM Service (Ollama + Qwen2.5 0.5B, streaming)
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
| **LLM Service** | Streams tokens from Ollama (default **Qwen2.5 0.5B**) | FastAPI, Ollama API |
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
docker compose build
docker compose --profile ollama up -d

docker compose exec ollama ollama pull qwen2.5:0.5b
```

Starts **MongoDB** (27017), **api-service** (8001), **audio-service** (8000), **whisper**, **stt**, **question**, **llm**, **formatter**, and **Ollama** (11434).

- **WebSocket:** `ws://localhost:8000/ws/audio`
- After ~1 s of silence, the question is sent to the LLM and the answer **streams** back.
- **Whisper:** default **base**; set `WHISPER_MODEL=small` for better accuracy.
- **Ollama:** default `qwen2.5:0.5b`; override with `OLLAMA_MODEL` (e.g. `llama3.2:1b`, `phi3`).

### Full stack + Next.js (browser)

```bash
npm run local:up
docker compose --profile ollama exec ollama ollama pull qwen2.5:0.5b
```

- **Web:** http://localhost:3002  
- **API:** http://localhost:8001  

More detail: **[docs/LOCAL-FULL-STACK.md](docs/LOCAL-FULL-STACK.md)**.

### Desktop (Electron)

```bash
cd clients/electron-app
npm install
npm start
```

Configure API/audio/WebSocket base URLs for your environment — see **`clients/electron-app/README.md`**.

### Mobile (Flutter)

```bash
cd clients/flutter-app
flutter pub get
flutter run
```

On Android emulator, `ws://10.0.2.2:8000/ws/audio`; on a device, use your host machine’s IP.

---

## Verify it’s working

| Step | What to do | Expected |
|------|------------|----------|
| Backend up | `docker compose --profile ollama ps` | Core services running |
| Audio health | `curl -s http://localhost:8000/health` | `{"status":"ok"}` |
| API health | `curl -s http://localhost:8001/health` | `{"status":"ok"}` |
| Voice Q&A | Electron or web → record → ask a question | Transcript, then streamed STAR answer |
| No-login API | `curl -s -X POST http://localhost:8001/cv/upload -H "X-User-Id: default" -F "file=@/path/to/cv.pdf"` | JSON with `id`, `filename` |

For **no-login** mode, send **`X-User-Id: default`** on API requests and `user_id: "default"` in the first WebSocket message where the protocol expects it.

---

## Kubernetes (k3s)

**Rough sizing for the full in-repo stack** (API, audio, MongoDB, STT, question, LLM, formatter, Ollama, ingress): single node on the order of **16–24 GB RAM**, **4+ CPU**, **40+ GB disk** (models and uploads dominate). Smaller nodes suit trimmed or Docker-only setups.

```bash
kubectl apply -f k8s/traefik/helmchartconfig.yaml   # TLS — adjust for your cluster
kubectl apply -k k8s/
kubectl exec -n interview-ai deploy/ollama -- ollama pull qwen2.5:0.5b
```

Manifests under **`k8s/`** define routing: web BFF, WebSocket to audio, API paths to **api-service**, optional admin host. STT expects a **Whisper** endpoint (`WHISPER_URL`); add a Whisper workload or an external URL as needed.

**Further reading:** [docs/DEPLOY-GIT-K8S.md](docs/DEPLOY-GIT-K8S.md), [docs/DEPLOY-WEB-ADMIN-GIT.md](docs/DEPLOY-WEB-ADMIN-GIT.md), [docs/AUTH0-WEBSITE.md](docs/AUTH0-WEBSITE.md), [docs/MONITORING-ADMIN.md](docs/MONITORING-ADMIN.md), [docs/VUE-FRONTENDS.md](docs/VUE-FRONTENDS.md), [docs/K8S-SCALING-AND-ROLLING.md](docs/K8S-SCALING-AND-ROLLING.md).

---

## Performance (typical targets)

With **Qwen2.5 0.5B** and **Whisper base/small**:

| Step | Target |
|------|--------|
| Speech recognition | ~500–800 ms |
| LLM first token | &lt; ~1 s |
| Full answer (short STAR) | ~1–2 s |

Answers **stream** to the client. **Audio service** can call LLM **`/warmup`** on startup to reduce cold starts.

**Local/offline hardware (indicative):** modern **x86_64** or **ARM64**; ~**4 GB+ RAM** for smallest model stack; **8 GB+** for larger Whisper/LLM choices. **No GPU required** for the default path.

---

## Configuration

- **Audio Service:** `STT_SERVICE_URL`, `QUESTION_SERVICE_URL`, `LLM_SERVICE_URL`, `FORMATTER_SERVICE_URL`
- **STT Service:** `WHISPER_URL` — must point at a working Whisper-compatible HTTP API for speech to work
- **LLM Service:** `OLLAMA_HOST` (default `http://ollama:11434`), `OLLAMA_MODEL` (default `qwen2.5:0.5b`)
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
├── clients/
│   ├── electron-app/
│   └── flutter-app/
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

---

## Possible extensions

- Interview simulation (LLM as interviewer with follow-ups).
- Stronger resume/CV context in prompts.
- Text-to-speech for answers.

---

## License

See the license file in the repository root if present.
