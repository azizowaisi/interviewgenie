# Deploy Through Git to Kubernetes (Single VM)

Push to `main` triggers **build → push images → deploy** to your Kubernetes cluster (e.g. k3s on a single VM). No manual SSH or copy-paste: Git is the source of truth.

**Main app + admin subdomain (DNS, parity with local, smoke tests):** see **[DEPLOY-WEB-ADMIN-GIT.md](./DEPLOY-WEB-ADMIN-GIT.md)**.

---

## Overview

1. **Pull requests** → workflow **CI** (`ci.yml`): `backend-tests` (pytest matrix), parallel `frontend-verify` (Next + Vue), parallel `docker-verify` matrix (8 images), `ci-gate`; no push, no deploy.
2. **Pushes to `main`** → workflow **Build and Deploy** (`build-and-deploy.yml`): tests, build, **push** images, then deploy. **Default** (`DEPLOY_MODE` unset): use **`KUBE_CONFIG`** for remote `kubectl` if set; otherwise use **SSH secrets** (same path as `DEPLOY_MODE=ssh`) when `SSH_HOST`, `SSH_USER`, and `SSH_PRIVATE_KEY` are present.
3. **Override** with repository variable **`DEPLOY_MODE`**: `ssh` (always SSH), `self_hosted`, `remote`, or **`none`** / **`off`** to push images only (no `kubectl`).

### Rolling deploys & HPA

Manifests include **readiness probes**, **rolling update** strategies, and **HorizontalPodAutoscalers** for stateless app Deployments. See **`docs/K8S-SCALING-AND-ROLLING.md`** for single-node limits, PVC constraints, and tuning `maxReplicas`.

### CPU architecture

**Build and Deploy** uses a **fixed `linux/amd64,linux/arm64`** platform list in the workflow so **Ampere** and **amd64** nodes both work without repository variables.

**Deploy** passes **`DOCKERHUB_TOKEN`** into **`k8s-apply.sh`**, which creates a namespace **pull secret** and patches service accounts so **mongo** and app images pull with **authenticated** Docker Hub limits.

Full diagram and checklist: **`docs/ORACLE-ARCHITECTURE.md`**.

### HTTPS / Let’s Encrypt (Electron & CLI TLS errors)

If browsers show **certificate** errors, Traefik is often still on the **default self-signed** cert. Ensure:

1. **`IngressRoute` TLS** — `k8s/ingress/ingressroute.yaml` includes `tls.certResolver: le` and `domains` for your hostname (resolver name **`le`** matches Traefik `HelmChartConfig`).
2. **ACME email** — Default in `k8s/traefik/helmchartconfig.yaml` is **`azizowaisi@teckiz.com`**. To use another address, edit that file or set GitHub secret **`LETSENCRYPT_EMAIL`** (SSH deploy overwrites the default when the secret is non-empty).
3. **Challenge type** — The chart uses **TLS-ALPN-01** on **port 443** (not HTTP-01 on 80), so it still works when Traefik redirects **HTTP → HTTPS** on port 80. Port **443** must be reachable from the internet.

After upgrading from an older manifest that had a second `IngressRoute` named **`interview-ai-ws`**, remove it once:  
`kubectl delete ingressroute interview-ai-ws -n interview-ai --ignore-not-found`

**Traefik `HelmChartConfig`:** it must live in **`kube-system`**. The app `kustomization.yaml` sets `namespace: interview-ai`, so **do not** include that file in `-k` — apply it directly:

```bash
kubectl apply -f k8s/traefik/helmchartconfig.yaml
kubectl apply -k k8s/
```

If a mis-placed config exists in `interview-ai`, delete it:  
`kubectl delete helmchartconfig traefik -n interview-ai --ignore-not-found`

If Let’s Encrypt was rate-limited or stuck, delete Traefik’s ACME storage PVC/data and restart Traefik (last resort).

### `DEPLOY_MODE` — Variable **or** Secret (optional)

The workflow reads **`vars.DEPLOY_MODE`** first; if that is empty, **`secrets.DEPLOY_MODE`**. Use either **Actions → Variables** or **Actions → Secrets** (your repo already uses a secret — that works).

| Value | Effect |
|--------|--------|
| *(unset)* | **`KUBE_CONFIG` set** → remote `kubectl`. **No `KUBE_CONFIG`** but **SSH secrets set** → SSH deploy. **Neither** → no deploy job (images may still push). |
| `ssh` | Always SSH/rsync deploy (even if `KUBE_CONFIG` exists). |
| `remote` | Same as unset; remote job runs only if **`KUBE_CONFIG`** is non-empty. |
| `self_hosted` | Deploy from a self-hosted runner on the VM |
| `none` / `off` | Push images only; no `kubectl` |

### What every k3s deploy path runs (same behavior)

All three modes end up executing **`scripts/ci/k8s-apply.sh`** after checkout/rsync:

1. **`kubectl apply -f k8s/traefik/helmchartconfig.yaml`** (kube-system — Let’s Encrypt / Traefik)
2. **`kubectl apply -k k8s/`** (namespace `interview-ai`: apps, ingress, mongo, ollama, HPA, …)
3. If **`DOCKERHUB_USERNAME`** is set and this run **pushed** images: **`kubectl set image`** pins **`sha-<full-commit>`** for services that were built (path filters). If **no** images were pushed (e.g. docs-only), **`kubectl set image` is skipped** so the cluster keeps current tags—no **`:latest`** rollout. If **`DOCKERHUB_USERNAME`** is unset, only `kubectl apply` runs.
4. **`kubectl rollout status`** on the **same deployments** as `kubectl set image` (all eight app services by default, or a partial list from CI) **in parallel** — wall time ≈ one `K8S_ROLLOUT_TIMEOUT` (default `180s`), not eight serial waits.
5. **`kubectl get pods`** and a best-effort **`ollama pull qwen2.5:0.5b`**

**Manual workflow:** **Actions → Build and Deploy → Run workflow** — also **pushes images** (same as a push to `main`). Options:

- **Skip tests** — skip Python tests; still builds/pushes/deploys.
- **Skip deploy** — push images only (no `kubectl`).

**On the VM without Actions:** from a clone of the repo:

```bash
export DOCKERHUB_USERNAME=youruser   # optional, if cluster pulls from Hub
./scripts/deploy-k3s.sh
```

**From your laptop** (valid kubeconfig for the cluster):

```bash
./scripts/deploy/apply-k8s-from-repo.sh
```

---

## Recommended approach (Oracle VM): self-hosted runner (no public 6443)

For a single VM like your Oracle instance (`132.226.198.193`), the cleanest approach is to run a **GitHub self-hosted runner on the VM** and let it run `kubectl apply` locally. This avoids exposing the Kubernetes API (port **6443**) to the internet.

You will:

- Install **k3s** on the VM
- Install a **GitHub Actions self-hosted runner** on the VM
- Set **`DEPLOY_MODE`** = `self_hosted` (repository **variable**)
- (Optionally) set Docker Hub secrets so the VM pulls images from the registry

---

## 1. Single VM: Install k3s

On your VM (e.g. Oracle Cloud, any VPS):

```bash
# Install k3s (single node, no extra agents)
curl -sfL https://get.k3s.io | sh -

# Wait until node is Ready
sudo k3s kubectl get nodes

# Get kubeconfig (for use in GitHub secret)
sudo cat /etc/rancher/k3s/k3s.yaml
```

### Mongo disk size (fresh cluster only)

Mongo’s PVC size is defined in the `StatefulSet` `volumeClaimTemplates`, which is **immutable once created**.

- Existing clusters: **do not change** `k8s/mongo/statefulset.yaml` storage size; it will break `kubectl apply -k`.
- Fresh clusters: if you want **5Gi**, use `k8s/mongo/statefulset-5gi.example.yaml` (apply it once *before* the first `kubectl apply -k k8s/`), or edit the storage request before the initial deploy.

### Docker Hub rate limits (`429 Too Many Requests`)

App Deployments use **`imagePullPolicy: IfNotPresent`** so the node can reuse images already in containerd and is not forced to contact Docker Hub on every sync. If you still hit **429**, ensure **`interview-ai-dockerhub`** pull Secret exists and is attached to the **`default`** ServiceAccount in **`interview-ai`**, upgrade Docker Hub, or pre-pull on the node: `sudo crictl pull docker.io/azizowaisi/interview-ai-<service>:sha-<commit>`.

Make the kubeconfig usable from your machine (or from GitHub Actions):

- Replace `127.0.0.1` with your VM’s **public IP** (or a hostname that resolves to it), so the Actions runner can reach the API server.
- Example (replace `YOUR_VM_PUBLIC_IP`):

  ```bash
  sudo cat /etc/rancher/k3s/k3s.yaml | sed 's/127.0.0.1/YOUR_VM_PUBLIC_IP/g' > kubeconfig.yaml
  ```

- Ensure the VM’s firewall/security list allows **TCP 6443** (Kubernetes API) from the internet (or at least from GitHub’s IPs if you lock it down).

Base64-encode the kubeconfig for the secret:

```bash
base64 -w0 kubeconfig.yaml
```

Keep this output; you’ll paste it into a GitHub secret.

---

## 2. GitHub: Repository secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → Secrets**. Add:

| Secret              | When | Description |
|---------------------|------|-------------|
| `DOCKERHUB_USERNAME`| Push / pull | Docker Hub username |
| `DOCKERHUB_TOKEN`   | Push / pull | Docker Hub access token |
| `KUBE_CONFIG`       | `DEPLOY_MODE=remote` | Base64 kubeconfig |
| `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `LETSENCRYPT_EMAIL` | `DEPLOY_MODE=ssh` | SSH deploy bootstrap |

Also set **`DEPLOY_MODE`** under **Variables** (see table above).

- **`DEPLOY_MODE=self_hosted`**: deploy runs on the VM runner; does **not** require `KUBE_CONFIG`.
- With **`DOCKERHUB_*`**, the workflow pushes images and the cluster can pull them.

---

## 3. Install a GitHub self-hosted runner on the VM

On your VM, open your repo in GitHub and go to:

**Settings → Actions → Runners → New self-hosted runner**

Choose:

- **Linux**
- **ARM64** (your VM is Ampere A1)

Then run the commands GitHub gives you on the VM (they look like `mkdir actions-runner && cd actions-runner ... ./config.sh ... ./run.sh`).

After it shows as **Idle** in GitHub, install it as a service so it starts on boot:

```bash
sudo ./svc.sh install
sudo ./svc.sh start
```

If you use Docker inside workflows on the VM (recommended for pulling images), ensure the runner user can run Docker:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

---

## 4. What runs on push to `main`

1. **test** – Backend unit tests.
2. **build** – Builds images for: `api-service`, `audio-service`, `stt-service`, `question-service`, `llm-service`, `formatter-service`, `monitoring-service`.
3. **push** – If `DOCKERHUB_TOKEN` is set: pushes `$DOCKERHUB_USERNAME/interview-ai-<service>:sha-<commit>` (immutable tag only).
4. **deploy_self_hosted** – If **`DEPLOY_MODE=self_hosted`**:
   - Uses local k3s kubeconfig from `/etc/rancher/k3s/k3s.yaml`.
   - Applies `kubectl apply -k k8s/`.
   - If `DOCKERHUB_*` are set, it also rewrites images to your Docker Hub repo and the cluster pulls them.
   - Optionally runs a one-time `ollama pull qwen2.5:0.5b` in the cluster (non-blocking).

5. **deploy_remote** – If **`DEPLOY_MODE` is unset, empty, or `remote`** and secret **`KUBE_CONFIG`** is set: decodes kubeconfig and runs `kubectl apply` from a GitHub-hosted runner (API 6443 must be reachable from GitHub). If **`KUBE_CONFIG` is missing**, this job is **skipped**.

6. **deploy_gates** – Lightweight job that checks whether **`KUBE_CONFIG`** and/or the **SSH** secret bundle are non-empty (secrets cannot be referenced in job-level `if`, so this step exposes `has_kube_config` / `has_ssh_bundle` outputs).

7. **deploy_ssh_bootstrap** – If **`DEPLOY_MODE=ssh`**, **or** (unset/`remote` with **no** `KUBE_CONFIG` but **SSH** secrets set): SSH to the VM, rsync `k8s/` + `scripts/ci/`, install k3s if needed, run `k8s-apply.sh`.

Result: every push to `main` runs **test → build → push**; **deploy** runs by default (**remote**) unless `DEPLOY_MODE` is `none` / `off`, or you use `ssh` / `self_hosted` instead.

---

## Alternative (hands-off server): deploy by SSH bootstrap

If you want to do **nothing on the server** besides enabling SSH access (key-based login), the workflow can **SSH into the VM**, install k3s, and apply `k8s/` automatically.

Add these GitHub repo secrets:

| Secret | Example | Notes |
|--------|---------|------|
| `SSH_HOST` | `132.226.198.193` | Your VM public IP |
| `SSH_USER` | `ubuntu` | Or whatever user you SSH as |
| `SSH_PRIVATE_KEY` | *(private key text)* | The private key that matches an authorized key on the VM |
| `LETSENCRYPT_EMAIL` | `you@company.com` | Required for TLS |
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` |  | Needed so k3s can pull the images you push |

Also ensure:

- DNS `A` record: `interviewgenie.teckiz.com` → `132.226.198.193`
- OCI ingress rules open **80/443** (and **22** for SSH)

Set repository variable **`DEPLOY_MODE`** = `ssh` **and** the SSH secrets above; then pushes to `main` run the `deploy_ssh_bootstrap` job.

---

## 4. After first deploy

- **Ingress / access**: The repo’s `k8s/ingress/` (e.g. IngressRoute) may need to match your setup. Ensure the VM’s firewall allows ports 80/443 if you use an ingress.
- **Ollama**: The workflow tries to pull `qwen2.5:0.5b` once. You can pull other models manually:
  ```bash
  kubectl exec -n interview-ai deploy/ollama -- ollama pull <model>
  ```
- **Logs**:
  ```bash
  kubectl -n interview-ai logs -f deploy/api-service
  kubectl -n interview-ai get pods -w
  ```

---

## 5. Optional: Deploy without a registry (images on the VM)

If you prefer **not** to use Docker Hub:

1. Do **not** set `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`.
2. On the VM, build and load images into k3s after cloning the repo:
   ```bash
   for s in api-service audio-service stt-service question-service llm-service formatter-service monitoring-service; do
     docker build -t interview-ai/$s:latest ./backend/$s
     sudo k3s ctr images import --all-platforms <(docker save interview-ai/$s:latest)
   done
   ```
   (Or use a local registry and point k3s at it.)
3. In GitHub, set **`DEPLOY_MODE=remote`** and secret **`KUBE_CONFIG`**. The deploy job will apply `k8s/` with default image names (`interview-ai/<service>:latest`). The cluster will use the images you loaded.

For a **fully Git-driven** flow with no manual steps on the VM, use Docker Hub (or another registry) and set all three secrets as above.
