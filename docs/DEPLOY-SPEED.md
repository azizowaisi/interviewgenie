# Fast deployments — what to expect

## Incremental builds and rollouts (default on `main`)

On **push to `main`**, the workflow already did **not** rebuild every image every time:

1. **Path filters** (`dorny/paths-filter`) mark which services changed (`web/`, `backend/api-service/**`, …).
2. **Docker** — only those services get **build jobs** (dynamic matrix from `build_matrix_slugs` in `scripts/ci/gha-resolve-detect-outputs.sh`). You no longer pay for eight mostly-no-op matrix legs when you only touched `web/`.
3. **Cluster** — `scripts/ci/k8s-apply.sh` receives **`K8S_UPDATE_DEPLOYMENTS`** listing only deployments that were rebuilt. **`kubectl set image`** and **rollout wait** run for **those** workloads only (others keep their current image tags).
4. **`kubectl apply -k`** still applies the **full** `k8s/` tree each run (fast compared to multi-arch Docker builds; keeps manifests in sync). It does **not** re-pull every app image unless `set image` targets that deployment.

So: **work on one service → one image build/push → one deployment restart** (plus shared apply).

### Auth0 / shared config

If you change only **secrets** or **docs**, path filters may show **no** image paths → **no** Docker push → deploy keeps existing tags (by design).

### Manual “Run workflow”

- Leave **Force rebuild all images** **unchecked** to use the same path-based list as a normal push (only changed slugs build).
- Check it when you want all eight images rebuilt (e.g. base image / global Dockerfile change).

### When you change shared paths

Filters are per folder. If you change something **outside** `web/` and `backend/<service>/` (e.g. only `README.md`), **no** image may rebuild. To roll new images anyway, use manual **force_build** or touch a file under the service you need.

---

## Realistic targets (GitHub-hosted `ubuntu-24.04`)

| Scenario | Typical total time* |
|----------|---------------------|
| Docs / k8s-only / no image rebuild | **~1–3 min** (detect + noop build job + kubectl apply) |
| **One** small Python service changed | **~3–8 min** first run, **~1–3 min** with warm cache |
| **Web** (Next.js) changed | **~5–15 min** first run, **~2–6 min** with warm cache |
| **Force rebuild all** images (7 backends + web) | **~8–25+ min** typical with **parallel matrix** (up to 8 jobs); wall time ≈ slowest image + prep, not sum of all |

\*Network, registry, and layer cache variance is large. **Build and Deploy** uses a **fixed** **`linux/amd64,linux/arm64`** list (no repo variable) so Oracle Ampere and amd64 nodes both get a valid manifest without manual platform tuning. That uses **QEMU** on GitHub’s amd64 runners for the arm64 leg.

## What we optimized

1. **Path filters** — skip Docker when code under a service didn’t change.
2. **Dynamic `build-images` matrix** — one runner per **changed** image only (not eight every time).
3. **Partial `kubectl set image` + rollouts** — `K8S_UPDATE_DEPLOYMENTS` in `k8s-apply.sh`.
4. **Fixed multi-arch in workflow** — one tag works on **Ampere and amd64**; deploy applies a **Docker Hub pull secret** from **`DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`** so in-cluster pulls (e.g. **mongo**) use authenticated rate limits.
5. **Registry cache** — each image uses a `:cache` tag on Docker Hub (plus GHA cache) so layers survive runner rotation.
6. **QEMU** — `setup-qemu` when platforms include **`arm64`** (default) or multiple platforms.
7. **Parallel pytest** — five backend test jobs in parallel with pip caching (`fail-fast: false`).
8. **BuildKit cache mounts** in Dockerfiles — `pip` / `npm` reuse download cache between builds.
9. **Parallel rollout checks** — `k8s-apply.sh` waits on **target** app deployments in parallel. Tune **`K8S_ROLLOUT_TIMEOUT`** (default `180s`).

## Variables (GitHub → Settings → Actions → Variables)

| Variable | Purpose |
|----------|---------|
| `DOCKER_BUILD_PLATFORMS` | *(unused by workflow — platforms are fixed in YAML)* |
| `DOCKER_REGISTRY_CACHE` | Set to `false` to disable registry `:cache` tags (GHA cache only) |

## Going faster (1–2 min for *everything* is hard)

- **Self-hosted runner** in the same region as Docker Hub or a mirror (see `DEPLOY_MODE=self_hosted`). An **arm64** self-hosted runner avoids QEMU for the default image platform.
- **Tune `max-parallel`** on the `build-images` matrix if Docker Hub rate limits (default 8).
- **Smaller images** — distroless / slim bases where compatible.
- **Skip tests on hotfix** — manual workflow: **Skip tests** (use carefully).

## Faster CI (optional fork)

To build **amd64-only** and drop the arm64/QEMU leg, change the **Configure Docker platforms** step in **`build-and-deploy.yml`** (not a repo variable in the current workflow).
