# Deploy Interview Genie to Oracle Cloud

This guide covers two ways to run Interview Genie on an **Oracle Cloud** instance: **Docker Compose** (simplest) and **Kubernetes (k3s)** (production-style).

---

## Option A: Docker Compose on Oracle Cloud (recommended to start)

### 1. Create an Oracle Cloud VM

1. Log in to [Oracle Cloud Console](https://cloud.oracle.com).
2. **Create a VM instance**:
   - **Shape**: Choose **Ampere (ARM)** or **AMD** with at least **4 OCPUs, 24 GB RAM** for the full stack (Ollama + Whisper + all services). Free tier offers 4 OCPUs, 24 GB RAM on ARM.
   - **OS**: Ubuntu 22.04 or 24.04.
   - **Networking**: Create a VCN if needed; allow **ingress** for ports **22** (SSH), **80** (HTTP), **443** (HTTPS), and optionally **8000** (audio/WS), **8001** (API) if you expose them directly.
3. **Download SSH key** and connect:
   ```bash
   ssh -i your-key.key ubuntu@<PUBLIC_IP>
   ```

### 2. Install Docker on the VM

```bash
# Update and install Docker
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli docker-compose-plugin

# Allow your user to run Docker (optional)
sudo usermod -aG docker $USER
# Log out and back in for group to apply
```

### 3. Clone the repo and run the stack

```bash
# Clone (or upload) the project
git clone https://github.com/YOUR_ORG/InterviewGenie.git
cd InterviewGenie

# Build and start all services
docker compose build
docker compose --profile ollama up -d

# Pull the LLM model (one-time, ~400 MB)
docker compose exec ollama ollama pull qwen2.5:0.5b
```

### 4. Expose the app (so you can use it from your laptop/phone)

**Option 4a – Use the VM IP and open firewall**

- On Oracle Cloud: **Networking → VCN → Security List** (or **Subnet → Security List**): add **Ingress** rules for **0.0.0.0/0** (or your IP) to ports **8000** (audio/WebSocket) and **8001** (API).
- From your **Electron app** or a **web/mobile client**, set:
  - **API base**: `http://<VM_PUBLIC_IP>:8001`
  - **WebSocket / audio base**: `ws://<VM_PUBLIC_IP>:8000` (e.g. `ws://<VM_PUBLIC_IP>:8000/ws/audio`).

**Option 4b – Put Nginx in front (HTTP + optional HTTPS)**

- Install Nginx on the same VM, proxy `/` and `/ws/` to `http://localhost:8000` (audio) and `/api/` to `http://localhost:8001` (API). Then open only **80** and **443** in the security list and use `http://<VM_PUBLIC_IP>` (or a domain with HTTPS).

### 5. Verify

```bash
# On the VM
docker compose --profile ollama ps   # all running
curl -s http://localhost:8000/health # {"status":"ok"}
curl -s http://localhost:8001/health # {"status":"ok"}
```

From your machine:

- Open the **Electron app**, set API URL to `http://<VM_PUBLIC_IP>:8001` and WebSocket to `ws://<VM_PUBLIC_IP>:8000`, then use the app as usual.

---

## Option B: Kubernetes (k3s) on Oracle Cloud

Use this if you want a Kubernetes deployment (e.g. for scaling or production).

### Ubuntu vs “the 502 / ImagePullBackOff issue”

- **Use Ubuntu 22.04 or 24.04** on the VM — that part is already correct.
- The failures you saw (**`no match for platform in manifest`**, Traefik **502**) come from **CPU architecture**, not from “Oracle Linux vs Ubuntu”. **CI builds `linux/amd64` and `linux/arm64` in one workflow** so **Ampere** and **AMD** shapes both get a matching layer without manual variables.
- **Ampere or AMD:** after a green **Build and Deploy**, the Hub tag should list the architecture your node uses.

### 1. Create a VM (same as above)

- **Shape**: 4+ OCPUs, **24 GB RAM** recommended for full stack (Ollama + STT + API + Mongo + rest).
- **OS**: Ubuntu 22.04/24.04.
- **Ampere or AMD:** default CI images include **both** architectures.

### 2. Install k3s

```bash
curl -sfL https://get.k3s.io | sh
sudo kubectl get nodes   # confirm node is Ready
```

### 3. Deploy the stack

```bash
git clone https://github.com/YOUR_ORG/InterviewGenie.git
cd InterviewGenie
kubectl apply -k k8s/
```

### 4. Pull Ollama model in the cluster

```bash
# Wait for Ollama pod to be running
kubectl get pods -n interview-ai -w
# Then:
kubectl exec -n interview-ai deploy/ollama -- ollama pull qwen2.5:0.5b
```

### 5. Expose the API and WebSocket

- **Ingress**: The repo’s `k8s/ingress/ingressroute.yaml` uses host `interview-ai.local`. Point that host (or your domain) to the VM’s **public IP** (DNS or `/etc/hosts`).
- **Security list**: Allow **80** and **443** (and 22 for SSH) from the internet to the VM.
- **Clients**: Use `http://<VM_IP_or_DOMAIN>` and `wss://<VM_IP_or_DOMAIN>/ws/audio` (if you added TLS).

**Note:** The current k8s manifests do not include a **Whisper** deployment. The STT service expects `WHISPER_URL`. You can either add a Whisper deployment and set `WHISPER_URL` in the STT service, or use an external Whisper endpoint.

---

## Resource summary (Oracle Cloud)

| Setup              | Min RAM | Recommended     | Notes                          |
|--------------------|---------|-----------------|--------------------------------|
| Docker Compose     | 8 GB    | 16–24 GB        | Full stack + Ollama + Whisper  |
| Kubernetes (k3s)  | 16 GB   | 24 GB           | Same; node must fit all pods   |

**Oracle Free Tier**: 4 OCPUs, 24 GB RAM (ARM) is enough for the full stack with Docker Compose or k3s.

---

## Security (production)

- Prefer **HTTPS** and **WSS** (e.g. Nginx + Let’s Encrypt or Oracle Load Balancer).
- Restrict **security list** rules to your IP or VPN instead of 0.0.0.0/0 where possible.
- Use **API authentication** (e.g. API key or JWT) for the API and optionally for the WebSocket.

---

## Mobile app

The README mentions a **Flutter mobile client** (`clients/flutter-app`). At the time of this guide, that folder is **not** in the repository; only the **Electron desktop app** is present under `clients/electron-app`.

To use the **current** app from a phone:

1. **Deploy the backend** on Oracle Cloud (Docker or k8s) and expose **8000** (WebSocket) and **8001** (API) as above.
2. **Electron**: Use the desktop app and point it to `http://<VM_IP>:8001` and `ws://<VM_IP>:8000/ws/audio`.
3. **Mobile**: You would need to either:
   - **Add a Flutter (or React Native) app** that uses the same API and WebSocket (same endpoints, different client), or
   - Use a **progressive web app (PWA)** or a simple **web page** that talks to `http://<VM_IP>:8001` and `ws://<VM_IP>:8000/ws/audio` (and ensure the backend allows CORS if the page is served from another origin).

So: **there is no mobile app in the repo yet**; only the desktop Electron app. The backend is ready for a future mobile or web client.
