# Operations host (`admin.interviewgenie.teckiz.com`)

The **admin hostname** points at the **Next.js `web` deployment** (port **3002**). That app serves the infrastructure UI and proxies **`/api/mon/*`** to the in-cluster **`monitoring-service`** (FastAPI + Kubernetes API). The raw monitoring JSON API and legacy Vue build still live on the **`monitoring-service`** pod; they are not exposed on the public admin URL unless you add a separate route.

## What you get

- **Cluster overview**: node readiness, pod counts, CPU/memory **when metrics-server works**
- **Services** & **pods** tables with usage (from Metrics API)
- **Logs**: proxied to `GET /api/logs?pod=...` on monitoring-service
- **Restart**: `POST /api/restart?deployment=...` (allowlist on monitoring-service)

## DNS & TLS

1. Create **`A`** record: `admin.interviewgenie.teckiz.com` → your VM IP (same as main app).
2. Apply manifests (`kubectl apply -k k8s/`). Traefik **IngressRoute** `interview-ai-admin` requests a Let’s Encrypt cert for the admin host.

## URLs

| URL | Purpose |
|-----|---------|
| `https://admin.interviewgenie.teckiz.com/` | **Next.js** infrastructure UI (root path rewrites internally to `/admin`) |
| `https://admin.interviewgenie.teckiz.com/interview` (etc.) | Redirects to the **main app** at `https://interviewgenie.teckiz.com/...` |

The **main marketing / interview site** does not link to this host. Build-time defaults for hostnames live in `web/Dockerfile` (`NEXT_PUBLIC_*` args); override with `docker build --build-arg ...` if your domains differ.

## monitoring-service (backend for `/api/mon`)

- **Vue 3 + Vite** sources: `backend/monitoring-service/frontend/` (legacy bundled UI; optional to rebuild). See **`docs/VUE-FRONTENDS.md`**.
- **Token**: If `ADMIN_TOKEN` is set on **monitoring-service**, set **`MONITORING_ADMIN_TOKEN`** on the **`web`** deployment so server-side BFF can send `X-Admin-Token`.

## metrics-server (k3s)

HPA and this dashboard need **metrics-server**. k3s often includes it. If `kubectl top nodes` fails, install or patch:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# k3s: add arg to deployment
#   --kubelet-insecure-tls
kubectl -n kube-system edit deployment metrics-server
```

## API (monitoring-service, internal)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Liveness |
| GET | `/api/config` | Labels (`environment_label`, `server_label`, `auth_required`) |
| GET | `/api/cluster` | Overview JSON |
| GET | `/api/infrastructure` | Node capacity, etc. |
| GET | `/api/pods` | Pods in `TARGET_NAMESPACE` |
| GET | `/api/services` | Services in namespace |
| GET | `/api/logs?pod=&container=&tail=` | Pod logs (text) |
| POST | `/api/restart?deployment=` | Rollout restart (allowlist) |

## RBAC

- **Role** in `interview-ai`: pods, pods/log, services, deployments (patch), pod metrics.
- **ClusterRole**: nodes + node metrics (for overview).

Restart is limited to deployments listed in env **`RESTARTABLE_DEPLOYMENTS`** on the monitoring Deployment. **MongoDB** is a **StatefulSet** — not in the default restart UI.

## Resource footprint

- **web**: see `k8s/web-service/deployment.yaml` (default ~128–512Mi).
- **monitoring-service**: requests 50m CPU / 128Mi RAM, limits 500m CPU / 384Mi RAM.

## Building images

```bash
docker build -t interview-ai/monitoring-service:latest ./backend/monitoring-service
docker build -t interview-ai/web:latest ./web
```

CI builds both when you push to `main` (see `.github/workflows/build-and-deploy.yml`).

## Nginx on the VM

If you terminate TLS on the VM with Nginx, proxy to the **`web`** ClusterIP service on **3002** for the admin host (or use Traefik as in `k8s/ingress/admin-ingressroute.yaml`).
