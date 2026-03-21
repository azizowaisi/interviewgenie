# Deploy main site + admin domain through Git (production parity)

Goal: **same behavior as local full stack** — Next.js on **3002** semantics, **API** and **audio WebSocket** reachable, **admin** on its own hostname with `/api/mon` → **monitoring-service** (in-cluster, not the local stub).

---

## 1. DNS (required)

| Record | Type | Value |
|--------|------|--------|
| `interviewgenie.teckiz.com` | A | Your VM / load balancer public IP |
| `www.interviewgenie.teckiz.com` | A | *(optional)* same IP |
| `admin.interviewgenie.teckiz.com` | A | **Same IP** as main site |

Ingress uses **Traefik** + **Let’s Encrypt** (`certResolver: le`). Ports **80** and **443** must be open from the internet.

---

## 2. GitHub → build, push images, deploy

### Secrets (Settings → Actions → Secrets)

| Secret | Purpose |
|--------|---------|
| `DOCKERHUB_USERNAME` | Docker Hub user |
| `DOCKERHUB_TOKEN` | **Required** for image push (without it, push step skips and deploy won’t get new images) |

Plus **one** deploy path:

| `DEPLOY_MODE` (Variable) | Also need |
|--------------------------|-----------|
| *(unset)* **default** | Secret **`KUBE_CONFIG`** — same as `remote`; full deploy on every merge to `main` |
| `remote` | Secret `KUBE_CONFIG` (base64 kubeconfig; API must be reachable from GitHub) |
| `self_hosted` | Runner installed **on the k3s node** (recommended; no public 6443) |
| `ssh` | `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `LETSENCRYPT_EMAIL` |
| `none` or `off` | Docker push only; no `kubectl` |

Set **`DEPLOY_MODE`** only if you want to override the default (e.g. `self_hosted`, `ssh`, or `none`).

### Optional Variables (custom domains / host lists)

If you use hostnames **other than** `*.interviewgenie.teckiz.com`, set:

| Variable | Example |
|----------|---------|
| `WEB_PUBLIC_APP_URL` | `https://app.example.com` |
| `WEB_ADMIN_SITE_URL` | `https://admin.example.com` |
| `WEB_ADMIN_HOSTS` | `admin.example.com` |
| `WEB_MAIN_APP_HOSTS` | `app.example.com,www.app.example.com` |

You must then edit **`k8s/ingress/ingressroute.yaml`**, **`k8s/ingress/admin-ingressroute.yaml`**, and the **Host** header in **`k8s/web-service/deployment.yaml`** probes to match.

### Day-to-day

| Event | Workflow | What runs |
|-------|----------|-----------|
| **Pull request** to `main` | **CI** (`ci.yml`) | **`backend-tests`** + **`frontend-verify`** + **`docker-verify`**; **`ci-gate`** — **no** push, **no** deploy |
| **Merge** (push to `main`) | **Build and Deploy** (`build-and-deploy.yml`) | **Detect** changed paths → **pytest** only if Python test services changed → **Docker build/push only** for changed images → **deploy** always (manifest apply; `kubectl set image` only when new images were pushed). See `docs/GITHUB-ACTIONS-K8S-OIDC.md` for OIDC options. |
| **Manual** | **Build and Deploy** | **deploy_only** — k8s apply only; **force_build** (default on) — rebuild all images; **Skip deploy** / **Skip tests** as before |

PRs and merges use **separate workflows** so you do not get two **Build and Deploy** runs when merging.

```bash
# After merge to main (or direct push to main — not recommended for production)
git push origin main
```

Or **Actions → Build and Deploy → Run workflow** (run from **`main`** so images push).

Pipeline on **main**: **tests → build → push all images → `scripts/ci/k8s-apply.sh`** (Traefik config + `kubectl apply -k k8s/` + `kubectl set image` + rollouts).

---

## 3. One-time on the cluster (Traefik)

`HelmChartConfig` must be in **`kube-system`** (not applied via `kustomization` namespace):

```bash
kubectl apply -f k8s/traefik/helmchartconfig.yaml
```

Then let CI apply the app stack, or:

```bash
export DOCKERHUB_USERNAME=your-dockerhub-user
./scripts/deploy-k3s.sh
```

---

## 4. How routing matches “local”

| Local | Production |
|-------|------------|
| http://localhost:3002 | `https://interviewgenie.teckiz.com` → **web:3002** (default route); **`/`** is Next.js only |
| http://localhost:8001 | **`/api/svc/*`** (Traefik strips prefix) → **api-service:8001** — e.g. `/api/svc/health`, `/api/svc/docs` |
| `http://localhost:8000/mock/...` | **`/api/audio/*`** (strip prefix) → **audio-service:8000** |
| `ws://localhost:8000/ws/...` | `wss://interviewgenie.teckiz.com/ws/...` → **audio-service:8000** |
| http://localhost:3001 (stub) | **No stub in k8s** — Next BFF calls **`http://monitoring-service:3001`** inside the cluster |
| `/admin` on main host redirects | `https://admin.interviewgenie.teckiz.com` → **web:3002** (middleware serves `/admin`) |

Manifests: `k8s/ingress/ingressroute.yaml`, `k8s/ingress/admin-ingressroute.yaml`, `k8s/web-service/deployment.yaml` (`API_URL`, `AUDIO_URL`, `MONITORING_URL`).

---

## 5. Optional: lock monitoring API (`ADMIN_TOKEN`)

1. Create secret:

```bash
kubectl create secret generic monitoring-admin \
  -n interview-ai \
  --from-literal=ADMIN_TOKEN='your-long-random-token'
```

2. In **`k8s/web-service/deployment.yaml`**, uncomment **`MONITORING_ADMIN_TOKEN`** and point it at the same value (or a second secret key). Redeploy **web**.

Admin UI: users enter the token in **Settings** (stored in browser); BFF sends it to monitoring.

---

## 6. Smoke checks after deploy

```bash
kubectl get pods -n interview-ai
curl -fsS -o /dev/null -w "%{http_code}\n" https://interviewgenie.teckiz.com/
curl -fsS -o /dev/null -w "%{http_code}\n" https://admin.interviewgenie.teckiz.com/
curl -fsS -o /dev/null -w "%{http_code}\n" https://interviewgenie.teckiz.com/api/svc/health
# Optional: bare /health should 308 to /api/svc/health (Next middleware)
curl -fsS -o /dev/null -w "%{http_code}\n" https://interviewgenie.teckiz.com/health
```

LLM (first time):

```bash
kubectl exec -n interview-ai deploy/ollama -- ollama pull qwen2.5:0.5b
```

---

## 7. Merge to `main`

CI **push** and **deploy** jobs run for **`refs/heads/main`** only (and manual dispatch). Feature branches should merge via PR into **`main`** so production updates from Git.

See also: **[DEPLOY-GIT-K8S.md](./DEPLOY-GIT-K8S.md)** (SSH / self-hosted / remote details).
