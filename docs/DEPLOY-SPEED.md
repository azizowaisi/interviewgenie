# Fast deployments — what to expect

## Realistic targets (GitHub-hosted `ubuntu-24.04`)

| Scenario | Typical total time* |
|----------|---------------------|
| Docs / k8s-only / no image rebuild | **~1–3 min** (detect + noop build job + kubectl apply) |
| **One** small Python service changed | **~3–8 min** first run, **~1–3 min** with warm cache |
| **Web** (Next.js) changed | **~5–15 min** first run, **~2–6 min** with warm cache |
| **Force rebuild all** images (7 backends + web) | **~8–25+ min** typical with **parallel matrix** (8 jobs); wall time ≈ slowest image + prep, not sum of all |

\*Network, registry, and layer cache variance is large. **Build and Deploy** uses a **fixed** **`linux/amd64,linux/arm64`** list (no repo variable) so Oracle Ampere and amd64 nodes both get a valid manifest without manual platform tuning. That uses **QEMU** on GitHub’s amd64 runners for the arm64 leg.

## What we optimized

1. **Path filters** — skip Docker when code under a service didn’t change.
2. **Fixed multi-arch in workflow** — one tag works on **Ampere and amd64**; deploy applies a **Docker Hub pull secret** from **`DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`** so in-cluster pulls (e.g. **mongo**) use authenticated rate limits.
3. **Registry cache** — each image uses a `:cache` tag on Docker Hub (plus GHA cache) so layers survive runner rotation.
4. **QEMU** — `setup-qemu` runs when the resolved platforms include **`arm64`** (default) or multiple platforms; skipped for **`linux/amd64` only**.
5. **Parallel pytest** — five backend test jobs in parallel with pip caching (`fail-fast: false` so one failure doesn’t cancel the rest).
6. **Parallel image build/push** — `build-images` matrix (one image per runner) + `build-meta` aggregates `images_pushed` for deploy.
7. **BuildKit cache mounts** in Dockerfiles — `pip` / `npm` reuse download cache between builds.
8. **Parallel rollout checks** — `k8s-apply.sh` waits on **all eight** app deployments concurrently. Tune **`K8S_ROLLOUT_TIMEOUT`** (default `180s`).

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
