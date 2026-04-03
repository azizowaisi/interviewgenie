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
| `DOCKERHUB_USERNAME` | Docker Hub user or org (**secret** or **variable** `DOCKERHUB_USERNAME`; secret wins if both set) |
| `DOCKERHUB_TOKEN` | **Required** for image push (without it, push step skips and deploy won’t get new images) |
| `DEPLOY_MODE` | *(optional)* Same values as the variable below. If you only use **Secrets** (no Variable), this is read by CI. **Repository Variable `DEPLOY_MODE` overrides** the secret when both are set. |

Plus **one** deploy path (set as **Variable** *or* **Secret** `DEPLOY_MODE`; variable wins if both exist):

| `DEPLOY_MODE` | Also need |
|---------------|-----------|
| *(unset)* **default** | **`KUBE_CONFIG`** → remote `kubectl` on merge. **No `KUBE_CONFIG`** but **SSH_HOST / SSH_USER / SSH_PRIVATE_KEY** → **SSH deploy** automatically (same as `ssh`). |
| `remote` | Requires **`KUBE_CONFIG`**; remote job skipped if secret empty (then SSH auto path applies if SSH secrets exist). |
| `self_hosted` | Runner installed **on the k3s node** (recommended; no public 6443) |
| `ssh` | `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `LETSENCRYPT_EMAIL` |
| `none` or `off` | Docker push only; no `kubectl` |

You can keep **`DEPLOY_MODE` as a repository secret** (as you already do); the workflow resolves it in the **detect** job. Optionally add the same name under **Variables** later if you want it visible and editable without opening Secrets.

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
| **Pull request** to `main` | **CI** (`ci.yml`) | **`backend-tests`** + **`frontend-verify`** + parallel **`docker-verify`** (8 images); **`ci-gate`** — **no** push, **no** deploy |
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

If you **do not** create this secret, **monitoring-service** accepts `/api/*` without a token on the cluster network (still only reachable from **web** via `/api/mon`).

If you **do** create the secret, **monitoring-service** requires **`X-Admin-Token`**. The **web** deployment must send the same value: **`k8s/web-service/deployment.yaml`** sets **`MONITORING_ADMIN_TOKEN`** from **`monitoring-admin`** / **`ADMIN_TOKEN`** (`optional: true` so missing secret still works).

1. Create or rotate:

```bash
kubectl create secret generic monitoring-admin \
  -n interview-ai \
  --from-literal=ADMIN_TOKEN='your-long-random-token'
```

2. Restart **web** and **monitoring-service** so they pick up the secret (or redeploy via CI).

Without **`MONITORING_ADMIN_TOKEN`** on **web** while the secret exists on **monitoring-service**, **https://admin.…** shows empty metrics and **HTTP 401** on `/api/mon/*` — the admin dashboard now surfaces that as **Unavailable** instead of a false **Healthy**.

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
kubectl exec -n interview-ai deploy/ollama -- ollama pull mistral-7b-v0
```

---

## 7. Merge to `main`

CI **push** and **deploy** jobs run for **`refs/heads/main`** only (and manual dispatch). Feature branches should merge via PR into **`main`** so production updates from Git.

See also: **[DEPLOY-GIT-K8S.md](./DEPLOY-GIT-K8S.md)** (SSH / self-hosted / remote details).
