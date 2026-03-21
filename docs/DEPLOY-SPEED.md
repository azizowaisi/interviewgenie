# Fast deployments — what to expect

## Realistic targets (GitHub-hosted `ubuntu-24.04`)

| Scenario | Typical total time* |
|----------|---------------------|
| Docs / k8s-only / no image rebuild | **~1–3 min** (detect + noop build job + kubectl apply) |
| **One** small Python service changed | **~3–8 min** first run, **~1–3 min** with warm cache |
| **Web** (Next.js) changed | **~5–15 min** first run, **~2–6 min** with warm cache |
| **Force rebuild all** images (7 backends + web) | **~15–35+ min** (serial builds in one job) |

\*Network, registry, and layer cache variance is large. **Multi-arch (amd64+arm64)** roughly **doubles** build time; this repo defaults to **`linux/amd64` only** for CI speed.

## What we optimized

1. **Path filters** — skip Docker when code under a service didn’t change.
2. **Default `PLATFORMS=linux/amd64`** — set repo variable **`DOCKER_BUILD_PLATFORMS`** to `linux/amd64,linux/arm64` only if nodes need arm images.
3. **Registry cache** — each image uses a `:cache` tag on Docker Hub (plus GHA cache) so layers survive runner rotation.
4. **No QEMU** when building a single platform — skips `setup-qemu` when not multi-arch.
5. **Parallel pytest** — five backend test jobs in parallel with pip caching.
6. **BuildKit cache mounts** in Dockerfiles — `pip` / `npm` reuse download cache between builds.
7. **Shorter rollout wait** — `K8S_ROLLOUT_TIMEOUT` (default `180s` in `k8s-apply.sh`).

## Variables (GitHub → Settings → Actions → Variables)

| Variable | Purpose |
|----------|---------|
| `DOCKER_BUILD_PLATFORMS` | e.g. `linux/amd64` (default if unset) or `linux/amd64,linux/arm64` |
| `DOCKER_REGISTRY_CACHE` | Set to `false` to disable registry `:cache` tags (GHA cache only) |

## Going faster (1–2 min for *everything* is hard)

- **Self-hosted runner** in the same region as Docker Hub or a mirror (see `DEPLOY_MODE=self_hosted`).
- **Parallel image builds** — split `build-push` into a matrix (one image per job); not enabled by default to keep the workflow smaller.
- **Smaller images** — distroless / slim bases where compatible (Python services currently use Ubuntu for `apt` stability).
- **Skip tests on hotfix** — manual workflow: **Skip tests** (use carefully).

## ARM (Apple Silicon / Graviton) clusters

If your nodes are **arm64**, set:

`DOCKER_BUILD_PLATFORMS=linux/arm64`

If you need **both** amd and arm in one tag, use `linux/amd64,linux/arm64` and expect longer builds.
