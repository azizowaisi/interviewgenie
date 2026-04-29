# GitHub repository Variables and Secrets (production)

**Auth0 dashboard setup for the Next.js site** (application type, callback URLs, API identifier, social connections): see **[AUTH0-WEBSITE.md](AUTH0-WEBSITE.md)**.

Configure these under **Settings → Secrets and variables → Actions**.

- **Variables** — non-sensitive; visible in logs if echoed (still avoid putting tokens here).
- **Secrets** — masked in logs; use for passwords, keys, kubeconfig, tokens.

Many workflows use the pattern `secrets.NAME || vars.NAME` so you can put the same logical setting in either place (secret wins when both exist).

---

## Web Docker image (`NEXT_PUBLIC_*` baked at build)

Set as **repository Variables** (recommended) unless you treat hostnames as sensitive.

| Name | Type | Example production value | Notes |
|------|------|--------------------------|--------|
| `WEB_PUBLIC_APP_URL` | Variable | `https://interviewgenie.example.com` | Public site origin (no trailing slash). **Required** for production builds; if empty, CI falls back to `http://localhost:3002`. |
| `WEB_ADMIN_SITE_URL` | Variable | `https://admin.interviewgenie.example.com` | Admin UI origin; leave empty if you do not use a separate admin hostname. |
| `WEB_ADMIN_HOSTS` | Variable | `admin.interviewgenie.example.com` | Comma-separated hostnames for the admin site. |
| `WEB_MAIN_APP_HOSTS` | Variable | `interviewgenie.example.com,www.interviewgenie.example.com` | Comma-separated main app hostnames (middleware / redirects). |

Used by: `build-and-deploy.yml`, `ci.yml` (matrix web build), `gha-build-single-image.sh`, `gha-docker-build-push.sh`.

**Auth0/app server env** are passed by CI when set in GitHub:
`AUTH0_DOMAIN`, `AUTH0_ISSUER_BASE_URL`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`,
`AUTH0_SECRET`, `AUTH0_BASE_URL`, `APP_BASE_URL`.

**`AUTH0_AUDIENCE`** (Auth0 API identifier) must match **`api-service`** for JWT checks and for **`getAccessToken({ audience })`** on the BFF. By default the app does **not** send `audience` on the initial Auth0 `/authorize` URL: if that API is not created in Auth0 → **APIs**, login fails with *Service not found*. After you create the API and authorize the app for it, you may set **`AUTH0_AUTHORIZE_AUDIENCE=true`** on **web** so the login flow also requests an API access token (optional; **ID token** fallback still works for Save job when **`AUTH0_CLIENT_ID`** is set on api-service).

You can also provide runtime fallback through Kubernetes secret `web-auth0-env`
(`k8s/web-service/deployment.yaml` uses optional `envFrom.secretRef`). The same secret’s
`AUTH0_CLIENT_ID` is mounted into **api-service** (optional ref) so the API can validate **ID tokens**
when a browser session has no API-scoped access token yet.

Do **not** commit real Auth0 secrets to the repo.

---

## Docker Hub

| Name | Type | Example | Notes |
|------|------|---------|--------|
| `DOCKERHUB_USERNAME` | Variable *or* Secret | `your-dockerhub-user` | Workflows accept `secrets` or `vars`. |
| `DOCKERHUB_TOKEN` | **Secret** | (PAT or access token) | Required for push/pull. |
| `DOCKER_REGISTRY_CACHE` | Variable | `true` or `false` | Optional; default enables registry cache when not `false`. |
| `WEB_DOCKER_PLATFORMS` | Variable | `linux/amd64` | Optional; **web image only** — speeds CI Docker build by skipping the arm64/QEMU leg. Use only if **all** Kubernetes nodes that run **web** are amd64. |
---

## Deploy mode and cluster

| Name | Type | Notes |
|------|------|--------|
| `DEPLOY_MODE` | Variable *or* Secret | See header comment in `build-and-deploy.yml` (`remote`, `self_hosted`, `ssh`, `none`, …). |
| `KUBE_CONFIG` | **Secret** | Base64 kubeconfig (some jobs expect `KUBE_CONFIG_B64` style usage — follow your workflow). |
| `CI_ALWAYS_BUILD_ALL` | Variable | Optional; `true` forces a **full-system build** on every push to `main` (ignore path filters). |
| `CI_PR_ALWAYS_BUILD_ALL` | Variable | Optional; `true` forces a **full-system build** on every pull request (ignore path filters). |
| `K8S_AUTO_RECOVER_IMAGE_PULL` | Variable | Optional; `true` to run recovery script on ImagePullBackOff. |
| `K8S_SKIP_OLLAMA_PULL` | Variable | Optional; `true` / `1` / `yes` to skip `ollama pull` after deploy (faster when the model is already on the node; see `scripts/ci/k8s-apply.sh`). |

### Web Auth0 runtime (recommended for k8s)

Create secret `web-auth0-env` in namespace `interview-ai` with:

- `AUTH0_DOMAIN`
- `AUTH0_ISSUER_BASE_URL`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `AUTH0_SECRET`
- `AUTH0_BASE_URL`
- `APP_BASE_URL`
- **`AUTH0_AUDIENCE`** — **required** in the cluster: must equal Auth0 **APIs → Identifier**; the **web** pod reads it via `envFrom` (do not rely only on the Deployment literal — it used to override the secret). **api-service** reads the same key from this secret so web and API always match.
- `NEXT_PUBLIC_PUBLIC_APP_URL` (optional; usually already baked at build)

If you see **“Not authorized to save”**: confirm `AUTH0_AUDIENCE` is in `web-auth0-env`, matches Auth0 and `k8s/api-service` expectations, **`AUTH0_CLIENT_ID`** is present (ID-token fallback), then restart web + api pods after `kubectl apply`.

If the API returns **503** with the **legacy** text **`AUTH0_AUDIENCE is required when AUTH0_DOMAIN is set`**, that string only exists in **api-service images built before commit `f686c2e`**. Fix: add **`AUTH0_AUDIENCE`** to `web-auth0-env` and restart **api-service** (works with old and new images), **and/or** deploy **`interview-ai-api-service`** from current `main` after **Build and Deploy** has pushed the new `sha-<commit>` tag (do not set a sha tag until the image exists on the registry — otherwise **ImagePullBackOff**). See **`docs/AUTH0-WEBSITE.md` §9**.

---

## SSH deploy (when using SSH path)

| Name | Type | Notes |
|------|------|--------|
| `SSH_HOST` | Variable *or* Secret | Deploy server hostname. |
| `SSH_USER` | Variable *or* Secret | SSH user. |
| `SSH_PRIVATE_KEY` | **Secret** | Private key PEM. |
| `LETSENCRYPT_EMAIL` | Variable *or* Secret | If your deploy script provisions TLS. |

---

## Quick checklist for a new production site

1. Set **`WEB_PUBLIC_APP_URL`** (and admin host vars if you split admin).
2. Configure **Docker Hub** credentials for image push.
3. Configure **deploy** (`KUBE_CONFIG` and/or `SSH_*`, `DEPLOY_MODE`) as your pipeline requires.
4. Wire **Auth0** for the live `web` service (build-time and/or K8s Secret), and register callback/logout URLs for your public URL.
