# Auth0 for the website (Next.js only)

This project’s browser app uses **Next.js** with **`@auth0/nextjs-auth0`** (server session, `/auth/*` routes). Default dev URL is **`http://localhost:3002`**. This guide covers **the website only** (not Electron or mobile).

---

## 1. Auth0 tenant

1. Sign up at [auth0.com](https://auth0.com) and open the **Dashboard**.

---

## 2. Application (Regular Web Application)

1. **Applications → Applications → Create Application**.
2. Name: e.g. `Interview Genie Web`.
3. Type: **Regular Web Application** (not “Single Page Application” — the app uses a **client secret** and server-side login).
4. **Settings** — copy:
   - **Domain**
   - **Client ID**
   - **Client Secret**

### URLs (must match how users open the site)

Replace the host with yours in production (no trailing slash on origins where noted).

| Auth0 field | Local | Production (example) |
|-------------|--------|----------------------|
| **Allowed Callback URLs** | `http://localhost:3002/auth/callback` | `https://yourdomain.com/auth/callback` |
| **Allowed Logout URLs** | `http://localhost:3002` | `https://yourdomain.com` |
| **Allowed Web Origins** | `http://localhost:3002` | `https://yourdomain.com` |

If you use **www**, add the same patterns for `https://www.yourdomain.com`.

Save **Application Settings**.

---

## 3. API + audience (Save Job / BFF)

The Next.js app calls **`/api/app/*`**, which forwards JWTs to **api-service**. Configure an API in Auth0:

1. **Applications → APIs → Create API**.
2. **Name:** e.g. `Interview Genie API`.
3. **Identifier:** a stable URL-style string (e.g. `https://api.interviewgenie.example`) — this value is **`AUTH0_AUDIENCE`** everywhere.
4. **Signing Algorithm:** RS256 (default).

In the Auth0 dashboard, allow your **Regular Web Application** to use this API where Auth0 exposes that control (so API access tokens for this audience can be issued when you enable **`AUTH0_AUTHORIZE_AUDIENCE`** on the web app). ID-token fallback to **api-service** still requires **`AUTH0_CLIENT_ID`** alignment; see **`docs/GITHUB-ENVIRONMENT.md`**.

---

## 4. Environment variables (web)

Set these for **local** dev (typically **`web/.env.local`** so middleware sees them; see comment in `web/.env.example`).

| Variable | Purpose |
|----------|---------|
| `AUTH0_DOMAIN` | Tenant domain, e.g. `dev-xxx.us.auth0.com` |
| `AUTH0_CLIENT_ID` | Application Client ID |
| `AUTH0_CLIENT_SECRET` | Application Client Secret |
| `AUTH0_SECRET` | Long random string used to encrypt the session cookie ([generate](https://generate-secret.vercel.app/32) or `openssl rand -hex 32`) |
| `AUTH0_BASE_URL` | Exact site origin: `http://localhost:3002` or `https://yourdomain.com` |
| `APP_BASE_URL` | Same as `AUTH0_BASE_URL` if you use the fallback in code |
| `AUTH0_ISSUER_BASE_URL` | Optional; often `https://AUTH0_DOMAIN/` |
| **`AUTH0_AUDIENCE`** | **Same as the API Identifier** (step 3) |

Optional:

- **`AUTH0_AUTHORIZE_AUDIENCE=true`** — after the API exists in Auth0, you may set this so the authorize request also asks for an API access token. If the API is missing in Auth0, login can fail with “Service not found”; leave unset until the API is created. See `web/lib/auth0.ts`.

Also set **`API_URL`** (and related) per `web/.env.example` so `/api/app/*` can reach **api-service**.

Restart **`npm run dev`** (or your Docker web container) after changing env.

---

## 5. Kubernetes (`web-auth0-env`)

For production, put the same keys in Secret **`web-auth0-env`** in namespace **`interview-ai`** (referenced by `k8s/web-service/deployment.yaml` and **api-service** for shared `AUTH0_CLIENT_ID` / `AUTH0_AUDIENCE`). Full list and pitfalls: **[GITHUB-ENVIRONMENT.md](GITHUB-ENVIRONMENT.md)**.

After editing the secret, restart **web** and **api-service** pods so they pick up values.

---

## 6. Social logins (Google, Facebook, Microsoft, …)

1. **Authentication → Social** — enable a provider and complete its wizard (each provider needs its own developer app / client ID & secret in *their* console).
2. **Applications → [your web app] → Connections** — toggle on the social connections you want for this app.

**Microsoft / Google developer consoles:** redirect URIs they ask for are usually **Auth0’s** callback (e.g. `https://YOUR_AUTH0_DOMAIN/login/callback`), not your site’s `/auth/callback`. Your site’s `/auth/callback` is only for the **Regular Web Application** OAuth flow to your Next.js app.

---

## 7. api-service alignment

With **Auth0** enabled on **api-service** (`AUTH0_DOMAIN` set), it expects a **Bearer** JWT from the BFF. Use the **same** `AUTH0_CLIENT_ID` and **`AUTH0_AUDIENCE`** (from the secret) as the web app. Details: **`backend/api-service/auth.py`**, **`docs/GITHUB-ENVIRONMENT.md`**.

---

## 8. Quick verification

- Open **`/auth/login`** on your site → complete login → protected routes (e.g. interview) load.
- **Save Job:** browser **Network** tab → `POST /api/app/topics` should be **2xx** when logged in (not **401/503**).

---

## Related repo files

- `web/.env.example`, `web/lib/auth0.ts`, `web/app/api/app/[...path]/route.ts`
- `docs/GITHUB-ENVIRONMENT.md` — CI variables and `web-auth0-env` keys
- `docs/DEPLOY-WEB-ADMIN-GIT.md` — TLS / hostnames
