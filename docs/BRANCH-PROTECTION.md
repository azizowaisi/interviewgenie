# Require tests & builds before merging to `main`

The **CI** workflow (`.github/workflows/ci.yml`) runs on every pull request targeting `main`:

1. **`backend-tests`** — Python `pytest` matrix (parallel, `fail-fast: false`)
2. **`frontend-verify`** — parallel `npm ci` + build for **web**, **api-frontend**, **monitoring-frontend**
3. **`docker-verify`** — matrix (8 parallel jobs): each backend image + `web` (no push), alongside `frontend-verify`
4. **`ci-gate`** — fails the workflow if any of the above failed (single status check to require)

## Enable in GitHub

1. Repo → **Settings** → **Rules** → **Rulesets** (or **Branches** → **Branch protection rules** for classic UI).  
2. Add / edit rule for branch **`main`**.  
3. Enable **Require status checks to pass before merging**.  
4. Add these checks (exact names as shown in Actions after one PR run):

   - `CI / ci-gate`  

   (Alternatively require each matrix leg and `docker-verify` by name if you prefer granular checks.)

5. Optionally enable **Require branches to be up to date before merging**.

After this, GitHub blocks the merge button until both jobs are green.

**Note:** Merging still triggers **Build and Deploy** once on `main` (images + cluster). PR CI does not deploy.
