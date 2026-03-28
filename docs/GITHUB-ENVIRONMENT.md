# GitHub repository Variables and Secrets (production)

Configure these under **Settings → Secrets and variables → Actions**.

- **Variables** — non-sensitive; visible in logs if echoed (still avoid putting tokens here).
- **Secrets** — masked in logs; use for passwords, keys, kubeconfig, tokens.

Many workflows use the pattern `secrets.NAME || vars.NAME` so you can put the same logical setting in either place (secret wins when both exist).

---

## Web Docker image (`NEXT_PUBLIC_*` baked at build)

Set as **repository Variables** (recommended) unless you treat hostnames as sensitive.

| Name | Type | Example production value | Notes |
|------|------|--------------------------|--------|
| `WEB_PUBLIC_APP_URL` | Variable | `https://interviewgenie.teckiz.com` | Public site origin (no trailing slash). **Required** for production builds; if empty, CI falls back to `http://localhost:3002`. |
| `WEB_ADMIN_SITE_URL` | Variable | `https://admin.interviewgenie.teckiz.com` | Admin UI origin; leave empty if you do not use a separate admin hostname. |
| `WEB_ADMIN_HOSTS` | Variable | `admin.interviewgenie.teckiz.com` | Comma-separated hostnames for the admin site. |
| `WEB_MAIN_APP_HOSTS` | Variable | `interviewgenie.teckiz.com,www.interviewgenie.teckiz.com` | Comma-separated main app hostnames (middleware / redirects). |

Used by: `build-and-deploy.yml`, `ci.yml` (matrix web build), `gha-build-single-image.sh`, `gha-docker-build-push.sh`.

**Auth0/app server env** are passed by CI when set in GitHub:
`AUTH0_DOMAIN`, `AUTH0_ISSUER_BASE_URL`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`,
`AUTH0_SECRET`, `AUTH0_BASE_URL`, `APP_BASE_URL`.

**`AUTH0_AUDIENCE`** (Auth0 API identifier) must be set on the **web** runtime (e.g. `web-auth0-env` in k8s) and match **`api-service` `AUTH0_AUDIENCE`**, so login requests an access token and Save job works. Not read automatically by Auth0 SDK v4 — the app configures it via `Auth0Client` + `getAccessToken({ audience })`.

You can also provide runtime fallback through Kubernetes secret `web-auth0-env`
(`k8s/web-service/deployment.yaml` uses optional `envFrom.secretRef`).

Do **not** commit real Auth0 secrets to the repo.

---

## Docker Hub

| Name | Type | Example | Notes |
|------|------|---------|--------|
| `DOCKERHUB_USERNAME` | Variable *or* Secret | `your-dockerhub-user` | Workflows accept `secrets` or `vars`. |
| `DOCKERHUB_TOKEN` | **Secret** | (PAT or access token) | Required for push/pull. |
| `DOCKER_REGISTRY_CACHE` | Variable | `true` or `false` | Optional; default enables registry cache when not `false`. |

---

## Deploy mode and cluster

| Name | Type | Notes |
|------|------|--------|
| `DEPLOY_MODE` | Variable *or* Secret | See header comment in `build-and-deploy.yml` (`remote`, `self_hosted`, `ssh`, `none`, …). |
| `KUBE_CONFIG` | **Secret** | Base64 kubeconfig (some jobs expect `KUBE_CONFIG_B64` style usage — follow your workflow). |
| `K8S_AUTO_RECOVER_IMAGE_PULL` | Variable | Optional; `true` to run recovery script on ImagePullBackOff. |

### Web Auth0 runtime (recommended for k8s)

Create secret `web-auth0-env` in namespace `interview-ai` with:

- `AUTH0_DOMAIN`
- `AUTH0_ISSUER_BASE_URL`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `AUTH0_SECRET`
- `AUTH0_BASE_URL`
- `APP_BASE_URL`
- `AUTH0_AUDIENCE` (same value as api-service; required for API calls from the BFF)
- `NEXT_PUBLIC_PUBLIC_APP_URL` (optional; usually already baked at build)

---

## SSH deploy (when using SSH path)

| Name | Type | Notes |
|------|------|--------|
| `SSH_HOST` | Variable *or* Secret | Deploy server hostname. |
| `SSH_USER` | Variable *or* Secret | SSH user. |
| `SSH_PRIVATE_KEY` | **Secret** | Private key PEM. |
| `LETSENCRYPT_EMAIL` | Variable *or* Secret | If your deploy script provisions TLS. |

---

## Desktop installers workflow (optional)

| Name | Type | Notes |
|------|------|--------|
| `DESKTOP_DOWNLOAD_PAGE` | Variable | Marketing/download page URL. |
| `DESKTOP_MIN_VERSION` | Variable | Optional minimum client version. |
| `DESKTOP_INSTALLERS_RSYNC_DEST` | Variable | e.g. `user@host:/var/www/desktop` — if set, rsync runs. |
| `DESKTOP_INSTALLERS_SSH_PORT` | Variable | SSH port (default 22). |
| `DESKTOP_INSTALLERS_SSH_PRIVATE_KEY` | **Secret** | Key for rsync SSH. |

---

## Quick checklist for a new production site

1. Set **`WEB_PUBLIC_APP_URL`** (and admin host vars if you split admin).
2. Configure **Docker Hub** credentials for image push.
3. Configure **deploy** (`KUBE_CONFIG` and/or `SSH_*`, `DEPLOY_MODE`) as your pipeline requires.
4. Wire **Auth0** for the live `web` service (build-time and/or K8s Secret), and register callback/logout URLs for your public URL.
5. Optionally set **desktop** variables if you use `desktop-installers.yml` + rsync.
