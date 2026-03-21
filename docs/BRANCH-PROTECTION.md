# Require tests & builds before merging to `main`

The **CI** workflow (`.github/workflows/ci.yml`) runs on every pull request targeting `main`:

1. **`backend-tests`** — Python `pytest` for all backend services that have tests  
2. **`build-verify`** — runs only if backend tests pass, then:
   - **Next.js** — `web/`: `npm ci` + `npm run build`
   - **Vue (API landing)** — `backend/api-service/frontend/`: `npm ci` + `npm run build`
   - **Vue (admin UI)** — `backend/monitoring-service/frontend/`: `npm ci` + `npm run build`
   - **Docker** — builds every backend service image and `web/` (same as production images, without push)

## Enable in GitHub

1. Repo → **Settings** → **Rules** → **Rulesets** (or **Branches** → **Branch protection rules** for classic UI).  
2. Add / edit rule for branch **`main`**.  
3. Enable **Require status checks to pass before merging**.  
4. Add these checks (exact names as shown in Actions after one PR run):

   - `CI / backend-tests`  
   - `CI / build-verify`

5. Optionally enable **Require branches to be up to date before merging**.

After this, GitHub blocks the merge button until both jobs are green.

**Note:** Merging still triggers **Build and Deploy** once on `main` (images + cluster). PR CI does not deploy.
