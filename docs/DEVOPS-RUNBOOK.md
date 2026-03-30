# DevOps runbook — Interview Genie

Single entry point for **CI/CD**, **Kubernetes**, **secrets**, and **operational hygiene**. Keep this aligned with the repo as workflows change.

---

## 1. Pipelines (what runs when)

| Trigger | Workflow | Purpose |
|---------|----------|---------|
| PR → `main` | `.github/workflows/ci.yml` | Path-scoped pytest, frontends, Docker verify, optional PR image push |
| Push / manual on `main` | `.github/workflows/build-and-deploy.yml` | Path-scoped tests, Docker build/push, deploy (mode from `DEPLOY_MODE`) |

**Concurrency:** `build-and-deploy` uses one concurrent group per workflow on `main` (`cancel-in-progress: true`) to avoid overlapping deploys.

**Incremental builds:** Only changed services get image matrix legs (`scripts/ci/gha-resolve-detect-outputs.sh`). Deploy uses partial `kubectl set image` (`K8S_UPDATE_DEPLOYMENTS`).

**Speed:** See **[DEPLOY-SPEED.md](./DEPLOY-SPEED.md)** — especially `WEB_DOCKER_PLATFORMS=linux/amd64` when the cluster is amd64-only, and `CI_DOCKER_PLATFORMS` for all images.

---

## 2. Secrets and configuration

Authoritative list: **[GITHUB-ENVIRONMENT.md](./GITHUB-ENVIRONMENT.md)**.

**Minimum discipline**

- **Never** commit tenant secrets or kubeconfig. Rotate **`KUBE_CONFIG`** on a schedule if not using OIDC.
- **`web-auth0-env`** in cluster must include **`AUTH0_AUDIENCE`** and **`AUTH0_CLIENT_ID`** so web BFF and **api-service** stay aligned (see prior K8s fixes).
- **`DOCKERHUB_TOKEN`**: secret only; pair with **`DOCKERHUB_USERNAME`** (var or secret).

**OIDC (cloud clusters):** **[GITHUB-ACTIONS-K8S-OIDC.md](./GITHUB-ACTIONS-K8S-OIDC.md)** — prefer short-lived credentials over long-lived kubeconfig where feasible.

---

## 3. Kubernetes operations

| Task | Command / script |
|------|-------------------|
| Apply manifests | `kubectl apply -k k8s/` (CI uses `scripts/ci/k8s-apply.sh`) |
| Diagnose namespace | `scripts/k8s-diagnose-interview-ai.sh` |
| Stuck rollouts / image pull | `scripts/k8s-recover-stuck-rollouts.sh` (dry-run first) |
| Roll back one deployment | `kubectl rollout undo deployment/<name> -n interview-ai` |

**Variables (optional):** `K8S_SKIP_OLLAMA_PULL`, `K8S_AUTO_RECOVER_IMAGE_PULL` — see workflow header in `build-and-deploy.yml`.

**Mongo:** PVC / reclaim policy is guarded in `k8s-apply.sh`. Plan **backups** separately (snapshots or dump CronJob); not automated in-repo.

---

## 4. Security and supply chain

- **Dependabot:** `.github/dependabot.yml` — merge weekly PRs after **CI** passes; watch for major bumps.
- **Branch protection:** **[BRANCH-PROTECTION.md](./BRANCH-PROTECTION.md)** — require **CI / ci-gate** on PRs.
- **GitHub Advanced Security** (if enabled): enable secret scanning / Dependabot alerts for the org policy.
- **Images:** Tags are **`sha-<commit>`** for production, not `:latest` in CI-driven deploys.

---

## 5. Observability (baseline)

- **`kubectl get pods -n interview-ai`** and **logs** per deployment after deploy.
- **monitoring-service** (if used): see **[MONITORING-ADMIN.md](./MONITORING-ADMIN.md)**.
- Long-term: central logs (Loki/ELK/cloud), Prometheus alerts, SLOs on API latency and error rate.

---

## 6. Incident checklist (short)

1. Confirm **last green** workflow on `main` and which **image tag** is pinned.
2. **`kubectl describe pod`** / **events** for ImagePullBackOff, OOMKilled, probe failures.
3. **Auth0 / BFF:** web pod env from **`web-auth0-env`**; api-service logs for 401/503.
4. **Rollback** deployment revision if deploy introduced regression.
5. Document postmortem if customer impact.

---

## 7. Self-hosted runner (optional)

**`DEPLOY_MODE=self_hosted`** — runner on or beside the cluster reduces push/pull latency and avoids QEMU for arm builds. See **DEPLOY-SPEED.md** and **DEPLOY-GIT-K8S.md**.

---

## Related docs

- **[DEPLOY-GIT-K8S.md](./DEPLOY-GIT-K8S.md)** — Git + k8s flow  
- **[DEPLOY-SPEED.md](./DEPLOY-SPEED.md)** — CI latency and variables  
- **[ORACLE-ARCHITECTURE.md](./ORACLE-ARCHITECTURE.md)** — Oracle / Ampere notes  
- **[VERSIONS.md](./VERSIONS.md)** — runtime versions  
