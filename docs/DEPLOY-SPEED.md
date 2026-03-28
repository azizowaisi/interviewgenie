# Fast deployments — what to expect

## “Deploy in one minute” — what is realistic?

A **full** production run (checkout, **unit tests**, **Docker build + push** for at least one image, **kubectl apply**, **rollout wait**) almost never finishes in **~1 minute** on GitHub-hosted runners. The slow parts are **compiling Next.js**, **multi-arch Docker** (especially **arm64 under QEMU**), and **pulling new images** on the cluster.

What **can** be roughly **1–3 minutes**:

- **Manifest-only changes** — use **Run workflow** with **Deploy only** (`deploy_only`): skips tests and Docker; only `kubectl apply` + rollouts (no new image tags).
- **Docs-only / no image paths** — path filters skip image builds; you pay detect + apply + any rollout timeout (often a few minutes total, not tens).

To push **wall time down** for real code changes:

1. **Repository variable** `CI_DOCKER_PLATFORMS=linux/amd64` — drops the **arm64** leg (often **~2× faster** Docker for **web**). **Only safe if every Kubernetes node that runs your app images is amd64** (no Ampere/arm64 workers).
2. **Manual “Run workflow”** — enable **Faster Docker: linux/amd64 only** (`amd64_only`) for a one-off push (same caveat as above).
3. **Path-scoped pytest** — only services under `backend/<name>/` that changed run **pytest** on `main` and on PRs (see `test_matrix_services` in `scripts/ci/gha-resolve-detect-outputs.sh`), instead of always running five jobs.

---

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
- **Faster Docker: linux/amd64 only** — use when the cluster is amd64-only (see top of this doc).

### When you change shared paths

Filters are per folder. If you change something **outside** `web/` and `backend/<service>/` (e.g. only `README.md`), **no** image may rebuild. To roll new images anyway, use manual **force_build** or touch a file under the service you need.

### Why the web image is slower than Python services

- **Next.js `next build`** compiles the whole app (TypeScript, bundling, static generation) — much heavier than installing wheels and copying Python source.
- **Multi-arch** (`linux/amd64` + `linux/arm64`) means Buildx runs that compile **twice**; the **arm64** leg on GitHub’s amd64 runners uses **QEMU**, which is especially slow for Node.
- **Mitigations in-repo:** ESLint and Vitest run **once** in **build-prep** when `web/` changed (not inside the Docker build, so not duplicated per platform). The web **Dockerfile** uses a BuildKit cache mount on **`.next/cache`** so repeat builds reuse Next’s cache when layers align.

To go faster still you need infrastructure tradeoffs: **arm64-native** runner (no QEMU for that leg), **amd64-only** cluster and images (drops arm from the manifest — do not do this if you run on Ampere), or a remote **BuildKit** builder.

---

## Realistic targets (GitHub-hosted `ubuntu-24.04`)

| Scenario | Typical total time* |
|----------|---------------------|
| Docs / k8s-only / no image rebuild | **~1–3 min** (detect + noop build job + kubectl apply) |
| **One** small Python service changed | **~3–8 min** first run, **~1–3 min** with warm cache |
| **Web** (Next.js) changed | **~5–15 min** first run, **~2–6 min** with warm cache; **~half** that if **`CI_DOCKER_PLATFORMS=linux/amd64`** (amd64-only cluster) |
| **Force rebuild all** images (7 backends + web) | **~8–25+ min** typical with **parallel matrix** (up to 8 jobs); wall time ≈ slowest image + prep, not sum of all |

\*Network, registry, and layer cache variance is large. Default platforms are **`linux/amd64,linux/arm64`** so Ampere and amd64 nodes both get a valid manifest; that uses **QEMU** on GitHub’s amd64 runners for the arm64 leg unless you override with **`CI_DOCKER_PLATFORMS`** or manual **`amd64_only`**.

## What we optimized

1. **Path filters** — skip Docker when code under a service didn’t change.
2. **Dynamic `build-images` matrix** — one runner per **changed** image only (not eight every time). For **web**, ESLint and Vitest run **once** in **build-prep** when `web/` changes; the image runs **`next build` only** with a **`.next/cache`** BuildKit mount (`web/Dockerfile`).
3. **Path-scoped pytest** — `test_matrix_services` runs **pytest** only for **backend services whose paths changed** (plus a fallback if only `python_tests` paths match).
4. **Partial `kubectl set image` + rollouts** — `K8S_UPDATE_DEPLOYMENTS` in `k8s-apply.sh`.
5. **Configurable Docker platforms** — default **multi-arch**; optional **`CI_DOCKER_PLATFORMS`** repo variable or manual **`amd64_only`** for faster amd64-only pushes.
6. **Registry cache** — each image uses a `:cache` tag on Docker Hub (plus GHA cache) so layers survive runner rotation.
7. **QEMU** — `setup-qemu` only when platforms include **`arm64`**.
8. **Parallel pytest** — up to five backend jobs in parallel with pip caching (`fail-fast: false`); often **one** job when a single service changed.
9. **BuildKit cache mounts** in Dockerfiles — `pip` / `npm` reuse download cache between builds.
10. **Parallel rollout checks** — `k8s-apply.sh` waits on **target** app deployments in parallel. Tune **`K8S_ROLLOUT_TIMEOUT`** (default `180s`).

## Variables (GitHub → Settings → Actions → Variables)

| Variable | Purpose |
|----------|---------|
| `WEB_DOCKER_PLATFORMS` | **Strongly recommended for fast web builds:** set to `linux/amd64` when **every** node that runs the **web** Deployment is amd64. Overrides platforms **only** for the `web` image (other services still use `CI_DOCKER_PLATFORMS` or default multi-arch). Skips QEMU for that matrix leg — often **~2× faster** than amd64+arm64. **Do not use** if any web pod schedules on arm64 (e.g. Ampere). |
| `CI_DOCKER_PLATFORMS` | e.g. `linux/amd64` for **all** images when the cluster is **amd64-only**. If **unset**, workflow uses `linux/amd64,linux/arm64`. |
| `DOCKER_BUILD_PLATFORMS` | *(unused — use `CI_DOCKER_PLATFORMS`)* |
| `DOCKER_REGISTRY_CACHE` | Set to `false` to disable registry `:cache` tags (GHA cache only) |

## Going faster (1–2 min for *everything* is hard)

- **Self-hosted runner** in the same region as Docker Hub or a mirror (see `DEPLOY_MODE=self_hosted`). An **arm64** self-hosted runner avoids QEMU for the default image platform.
- **Tune `max-parallel`** on the `build-images` matrix if Docker Hub rate limits (default 8).
- **Smaller images** — distroless / slim bases where compatible.
- **Skip tests on hotfix** — manual workflow: **Skip tests** (use carefully).

## Faster CI (optional fork)

To default **amd64-only** for every run, set **`CI_DOCKER_PLATFORMS`** to **`linux/amd64`**, or change the **Configure Docker platforms** step in **`build-and-deploy.yml`**.
