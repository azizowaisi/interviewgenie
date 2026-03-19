# Deploy Through Git to Kubernetes (Single VM)

Push to `main` triggers **build → push images → deploy** to your Kubernetes cluster (e.g. k3s on a single VM). No manual SSH or copy-paste: Git is the source of truth.

---

## Overview

1. **GitHub Actions** runs on every push to `main`: tests, builds Docker images, pushes to a registry (Docker Hub), then runs `kubectl apply -k k8s/` against your cluster.
2. **Which deploy runs** is chosen with a **repository variable** `DEPLOY_MODE` (GitHub does not allow `secrets.*` in workflow `if:` conditions).

### Required: repository variable `DEPLOY_MODE`

In **Settings → Secrets and variables → Actions → Variables** (not Secrets), add:

| Variable | Value | Effect |
|----------|--------|--------|
| `DEPLOY_MODE` | `ssh` | SSH bootstrap deploy (Oracle “do nothing on server”) |
| `DEPLOY_MODE` | `remote` | Deploy using `KUBE_CONFIG` from GitHub-hosted runner (API 6443 reachable) |
| `DEPLOY_MODE` | `self_hosted` | Deploy from a self-hosted runner on the VM |
| *(omit or other)* | — | No automatic deploy job (build/push still run on `main`) |

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
2. **build** – Builds images for: `api-service`, `audio-service`, `stt-service`, `question-service`, `llm-service`, `formatter-service`.
3. **push** – If `DOCKERHUB_TOKEN` is set: logs in to Docker Hub and pushes `$DOCKERHUB_USERNAME/interview-ai-<service>:latest`.
4. **deploy_self_hosted** – If **`DEPLOY_MODE=self_hosted`**:
   - Uses local k3s kubeconfig from `/etc/rancher/k3s/k3s.yaml`.
   - Applies `kubectl apply -k k8s/`.
   - If `DOCKERHUB_*` are set, it also rewrites images to your Docker Hub repo and the cluster pulls them.
   - Optionally runs a one-time `ollama pull qwen2.5:0.5b` in the cluster (non-blocking).

5. **deploy_remote** – If **`DEPLOY_MODE=remote`** (and `KUBE_CONFIG` secret is set):
   - Decodes kubeconfig and runs `kubectl apply -k k8s/` from a GitHub-hosted runner.
   - This requires your Kubernetes API (port 6443) to be reachable from GitHub-hosted runners.

6. **deploy_ssh_bootstrap** – If **`DEPLOY_MODE=ssh`**: SSH to the VM, install k3s if needed, apply manifests.

Result: every push to `main` runs **test → build → push**; **deploy** runs only for the `DEPLOY_MODE` you set (plus the matching secrets).

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
   for s in api-service audio-service stt-service question-service llm-service formatter-service; do
     docker build -t interview-ai/$s:latest ./backend/$s
     sudo k3s ctr images import --all-platforms <(docker save interview-ai/$s:latest)
   done
   ```
   (Or use a local registry and point k3s at it.)
3. In GitHub, set **`DEPLOY_MODE=remote`** and secret **`KUBE_CONFIG`**. The deploy job will apply `k8s/` with default image names (`interview-ai/<service>:latest`). The cluster will use the images you loaded.

For a **fully Git-driven** flow with no manual steps on the VM, use Docker Hub (or another registry) and set all three secrets as above.
