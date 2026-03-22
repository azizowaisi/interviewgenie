# Fast deployments — what to expect

## Realistic targets (GitHub-hosted `ubuntu-24.04`)

| Scenario | Typical total time* |
|----------|---------------------|
| Docs / k8s-only / no image rebuild | **~1–3 min** (detect + noop build job + kubectl apply) |
| **One** small Python service changed | **~3–8 min** first run, **~1–3 min** with warm cache |
| **Web** (Next.js) changed | **~5–15 min** first run, **~2–6 min** with warm cache |
| **Force rebuild all** images (7 backends + web) | **~8–25+ min** typical with **parallel matrix** (8 jobs); wall time ≈ slowest image + prep, not sum of all |

\*Network, registry, and layer cache variance is large. **Default `linux/arm64`** targets **M1 dev + Oracle Ampere**; GitHub runners are **amd64**, so buildx uses **QEMU** for that arm64 build (some CPU overhead vs native amd64 builds). **Multi-arch** `linux/amd64,linux/arm64` takes longer than arm64-only.

## What we optimized

1. **Path filters** — skip Docker when code under a service didn’t change.
2. **Default `PLATFORMS=linux/arm64`** — matches **Apple Silicon + Ampere**. Override with **`DOCKER_BUILD_PLATFORMS=linux/amd64`** for amd64-only clusters (no QEMU arm leg). Use **`linux/amd64,linux/arm64`** for one tag on both architectures.
3. **Registry cache** — each image uses a `:cache` tag on Docker Hub (plus GHA cache) so layers survive runner rotation.
4. **QEMU** — `setup-qemu` runs when the resolved platforms include **`arm64`** (default) or multiple platforms; skipped for **`linux/amd64` only**.
5. **Parallel pytest** — five backend test jobs in parallel with pip caching (`fail-fast: false` so one failure doesn’t cancel the rest).
6. **Parallel image build/push** — `build-images` matrix (one image per runner) + `build-meta` aggregates `images_pushed` for deploy.
7. **BuildKit cache mounts** in Dockerfiles — `pip` / `npm` reuse download cache between builds.
8. **Parallel rollout checks** — `k8s-apply.sh` waits on **all eight** app deployments concurrently. Tune **`K8S_ROLLOUT_TIMEOUT`** (default `180s`).

## Variables (GitHub → Settings → Actions → Variables)

| Variable | Purpose |
|----------|---------|
| `DOCKER_BUILD_PLATFORMS` | Unset → **`linux/arm64`** (M1 + Ampere). **`linux/amd64`** for x86_64-only. **`linux/amd64,linux/arm64`** for multi-arch. |
| `DOCKER_REGISTRY_CACHE` | Set to `false` to disable registry `:cache` tags (GHA cache only) |

## Going faster (1–2 min for *everything* is hard)

- **Self-hosted runner** in the same region as Docker Hub or a mirror (see `DEPLOY_MODE=self_hosted`). An **arm64** self-hosted runner avoids QEMU for the default image platform.
- **Tune `max-parallel`** on the `build-images` matrix if Docker Hub rate limits (default 8).
- **Smaller images** — distroless / slim bases where compatible.
- **Skip tests on hotfix** — manual workflow: **Skip tests** (use carefully).

## x86_64-only clusters

If **all** nodes are **amd64**, set:

`DOCKER_BUILD_PLATFORMS=linux/amd64`

for faster CI (no arm64/QEMU leg).
