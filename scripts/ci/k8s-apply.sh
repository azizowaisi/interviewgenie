#!/usr/bin/env bash
# Apply Traefik + kustomize stack + optional Docker Hub image overrides + rollout checks.
# Layout: $ROOT/k8s/ (kustomization.yaml, traefik/, …) — same as Git repo root on CI, or ~/interviewgenie-k8s on SSH sync.
#
# Env: KUBECONFIG. Optional: DOCKERHUB_USERNAME, DOCKERHUB_TOKEN, K8S_NAMESPACE (default interview-ai).
# When both Hub env vars are set: creates pull secret + patches SAs so cluster pulls (mongo, app images) use authenticated Hub (higher rate limits).
# Optional: K8S_IMAGE_TAG — CI uses sha-<full github sha>; local default latest if unset when set_image runs.
# Optional: K8S_SKIP_SET_IMAGE=1 — no new tag this run (CI skips set image). We snapshot live images before
#   `kubectl apply -k` and restore them after, so apply does not clobber currently pinned sha-* tags.
# Optional: K8S_SKIP_OLLAMA_PULL — if 1/true/yes, skip `ollama pull` at end (faster deploys when model is already on disk).
# Optional: K8S_AUTO_RECOVER_IMAGE_PULL — if 1/true/yes and pods show ImagePullBackOff/ErrImagePull after apply,
#   run scripts/k8s-recover-stuck-rollouts.sh --apply (GitHub: set repository Variable of the same name).
# Optional: K8S_UPDATE_DEPLOYMENTS — space-separated deployment names to pin (partial CI builds).
#   If unset/empty, all app deployments get `kubectl set image` (CI uses this when pinning :latest).
# Rollout: same deployments as set image (all app workloads in parallel; one timeout window wall time).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NS="${K8S_NAMESPACE:-interview-ai}"
ROLLOUT_TIMEOUT="${K8S_ROLLOUT_TIMEOUT:-420s}"
# App Deployments that receive Hub images (must match set_image loop below).
ALL_APP_DEPLOYMENTS="api-service audio-service stt-service question-service llm-service formatter-service cv-parser-service monitoring-service web"
ROLLOUT_TARGETS="${ALL_APP_DEPLOYMENTS}"

SNAP_DIR=""
cleanup_snap() {
  if [[ -n "${SNAP_DIR}" && -d "${SNAP_DIR}" ]]; then
    rm -rf "${SNAP_DIR}" || true
  fi
  return 0
}
trap cleanup_snap EXIT

echo "ROOT=$ROOT"
echo "=== Apply Traefik HelmChartConfig (kube-system) ==="
kubectl apply -f "$ROOT/k8s/traefik/helmchartconfig.yaml"

# Always snapshot live images before apply so that partial builds (K8S_UPDATE_DEPLOYMENTS)
# and skip-set-image runs do not clobber non-updated deployments with the sha-0000000 placeholder.
echo "=== Snapshot app deployment images (before apply — placeholders in git must not replace live Hub tags) ==="
SNAP_DIR="$(mktemp -d)"
for d in ${ALL_APP_DEPLOYMENTS}; do
  if kubectl get "deployment/$d" -n "$NS" &>/dev/null; then
    cname=$(kubectl get "deployment/$d" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || true)
    img=$(kubectl get "deployment/$d" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
    if [[ -n "${cname:-}" && -n "${img:-}" ]]; then
      printf '%s' "$cname" >"${SNAP_DIR}/${d}.container"
      printf '%s' "$img" >"${SNAP_DIR}/${d}.image"
    fi
  fi
done

echo "=== kubectl apply -k ($NS) ==="
if ! apply_out="$(kubectl apply -k "$ROOT/k8s/" 2>&1)"; then
  echo "$apply_out" >&2
  # Some Kubernetes versions can fail strategic-merge patch when a probe handler
  # type changed in-place (e.g. readiness exec -> tcpSocket) on an existing Deployment.
  if echo "$apply_out" | grep -q 'Deployment "ollama" is invalid:.*may not specify more than 1 handler type'; then
    echo "WARN: ollama probe handler transition conflict detected; recreating ollama deployment." >&2
    kubectl delete deployment/ollama -n "$NS" --ignore-not-found
    kubectl apply -f "$ROOT/k8s/ollama/deployment.yaml" -n "$NS"
  else
    exit 1
  fi
else
  echo "$apply_out"
fi

# Ensure production Mongo data is never garbage-collected when PVC/StatefulSet changes.
# local-path defaults to PV reclaimPolicy=Delete on many k3s installs.
echo "=== Enforce Mongo PV reclaimPolicy=Retain (safe guard) ==="
mongo_pvc="mongo-data-mongo-0"
if kubectl get pvc "$mongo_pvc" -n "$NS" &>/dev/null; then
  mongo_pv="$(kubectl get pvc "$mongo_pvc" -n "$NS" -o jsonpath='{.spec.volumeName}' 2>/dev/null || true)"
  if [[ -n "${mongo_pv:-}" ]]; then
    kubectl patch pv "$mongo_pv" --type=merge \
      -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' >/dev/null || true
    echo "Mongo PV ${mongo_pv}: reclaimPolicy set to Retain"
  else
    echo "WARN: Mongo PVC found but PV name empty; skipping reclaim policy patch." >&2
  fi
else
  echo "WARN: Mongo PVC ${mongo_pvc} not found in namespace ${NS}; skipping reclaim policy patch." >&2
fi

if [[ -n "${DOCKERHUB_USERNAME:-}" ]] && [[ -n "${DOCKERHUB_TOKEN:-}" ]]; then
  echo "=== Docker Hub pull secret ($NS) ==="
  kubectl create secret docker-registry interview-ai-dockerhub \
    --docker-server=https://index.docker.io/v1/ \
    --docker-username="${DOCKERHUB_USERNAME}" \
    --docker-password="${DOCKERHUB_TOKEN}" \
    -n "$NS" \
    --dry-run=client -o yaml | kubectl apply -f - || {
    echo "WARN: Docker Hub pull secret apply failed (continuing)." >&2
    true
  }
  for sa in default monitoring-service; do
    if kubectl get serviceaccount "$sa" -n "$NS" &>/dev/null; then
      kubectl patch serviceaccount "$sa" -n "$NS" --type=merge \
        -p "{\"imagePullSecrets\":[{\"name\":\"interview-ai-dockerhub\"}]}" || true
    fi
  done
  # Do not restart Mongo on every deploy. This is a single-replica StatefulSet in most installs,
  # so a forced restart causes avoidable downtime and can surface as 503 "Database unavailable"
  # in api-service during user actions (Save job/history).
  if [[ "${K8S_RESTART_MONGO_ON_DEPLOY:-}" == "1" || "${K8S_RESTART_MONGO_ON_DEPLOY:-}" == "true" ]]; then
    kubectl rollout restart statefulset/mongo -n "$NS" 2>/dev/null || true
  fi
fi

TAG="${K8S_IMAGE_TAG:-latest}"

set_image_for() {
  local deploy="$1"
  local slug="$2"
  local dh="$3"
  kubectl set image "deployment/${deploy}" -n "$NS" "${deploy}=${dh}/interview-ai-${slug}:${TAG}" || true
}

if [[ -n "${DOCKERHUB_USERNAME:-}" ]] && [[ "${K8S_SKIP_SET_IMAGE:-}" != "1" ]]; then
  DH="$DOCKERHUB_USERNAME"
  # CI sets K8S_UPDATE_DEPLOYMENTS to only deployments that were built (partial pushes).
  # If unset/empty, update all app workloads (local scripts).
  if [[ -n "${K8S_UPDATE_DEPLOYMENTS:-}" ]]; then
    TARGETS="${K8S_UPDATE_DEPLOYMENTS}"
  else
    TARGETS="${ALL_APP_DEPLOYMENTS}"
  fi
  ROLLOUT_TARGETS="${TARGETS}"

  echo "=== Verify target image tags exist before rollout ==="
  missing=()
  for d in ${TARGETS}; do
    slug="$d"
    [[ "$d" == "web" ]] && slug="web"
    image_ref="${DH}/interview-ai-${slug}:${TAG}"
    if ! docker manifest inspect "${image_ref}" >/dev/null 2>&1; then
      missing+=("${image_ref}")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Refusing deploy; missing Docker image tags:" >&2
    for img in "${missing[@]}"; do
      echo "  - ${img}" >&2
    done
    echo "Build/push all missing images first, then retry deploy." >&2
    exit 1
  fi

  echo "=== kubectl set image -> ${DH}/interview-ai-*:${TAG} (deployments: ${TARGETS}) ==="
  for d in ${TARGETS}; do
    case "$d" in
      api-service) set_image_for api-service api-service "$DH" ;;
      audio-service) set_image_for audio-service audio-service "$DH" ;;
      stt-service) set_image_for stt-service stt-service "$DH" ;;
      question-service) set_image_for question-service question-service "$DH" ;;
      llm-service) set_image_for llm-service llm-service "$DH" ;;
      formatter-service) set_image_for formatter-service formatter-service "$DH" ;;
      monitoring-service) set_image_for monitoring-service monitoring-service "$DH" ;;
      web) set_image_for web web "$DH" ;;
      cv-parser-service) set_image_for cv-parser-service cv-parser-service "$DH" ;;
      *) echo "WARN: unknown deployment in K8S_UPDATE_DEPLOYMENTS: $d" ;;
    esac
  done
fi

# Restore snapshot for any deployment NOT updated this run (partial builds and skip-set-image).
# This prevents kubectl apply -k from clobbering live sha-* tags with the sha-0000000 placeholder.
echo "=== Restoring snapshots for non-updated deployments ==="
restored=0
if [[ -n "${SNAP_DIR}" && -d "${SNAP_DIR}" ]]; then
  for d in ${ALL_APP_DEPLOYMENTS}; do
    # Skip if this deployment was just updated with a new image tag
    if echo " ${TARGETS:-} " | grep -q " ${d} "; then
      continue
    fi
    [[ -f "${SNAP_DIR}/${d}.image" && -f "${SNAP_DIR}/${d}.container" ]] || continue
    cname="$(cat "${SNAP_DIR}/${d}.container")"
    img="$(cat "${SNAP_DIR}/${d}.image")"
    # Only restore if the current live image is a sha-0000000 placeholder (apply clobbered it)
    live_img=$(kubectl get "deployment/${d}" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
    if echo "${live_img:-}" | grep -q "sha-0000000"; then
      if kubectl set image "deployment/${d}" -n "$NS" "${cname}=${img}" 2>/dev/null; then
        echo "Restored ${d}: ${img}"
        restored=$((restored + 1))
      fi
    fi
  done
fi
if [[ "$restored" -gt 0 ]]; then
  echo "Restored ${restored} deployment image ref(s) from pre-apply snapshot."
elif [[ "${K8S_SKIP_SET_IMAGE:-}" == "1" ]]; then
  echo "WARN: No snapshot to restore deployment image refs after apply —"
  echo "WARN: if this run changed images to a tag that was not pushed, pods can stay ImagePullBackOff and Traefik returns 502."
  echo "WARN: Run a workflow that builds/pushes images, or: DOCKERHUB_USERNAME=you ./scripts/deploy-k3s.sh"
  echo "WARN: Diagnose: ./scripts/k8s-diagnose-interview-ai.sh"
fi

# Rollouts in parallel so wall time ≈ one timeout, not N × timeout (set -e: wait || true).
echo "=== Rollout status (parallel, ${ROLLOUT_TARGETS}, timeout ${ROLLOUT_TIMEOUT} each) ==="
pids=()
for d in ${ROLLOUT_TARGETS}; do
  (
    if kubectl rollout status "deployment/${d}" -n "$NS" --timeout="${ROLLOUT_TIMEOUT}"; then
      echo "OK: rollout ${d}"
    else
      echo "WARN: rollout ${d} not ready in time" >&2
    fi
  ) &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid" || true
done

# Reporting + optional ollama pull must never fail the job (ImagePullBackOff on unrelated RS, exec flakes, pipefail).
(
  set +e
  set +o pipefail
  echo "=== Pods ($NS) ==="
  kubectl get pods -n "$NS" -o wide || true
  if kubectl get pods -n "$NS" --no-headers 2>/dev/null | grep -E 'ImagePullBackOff|ErrImagePull' >/dev/null; then
    echo "WARN: Some pods cannot pull images. If CI only updated part of the stack, other deployments may still reference a Hub tag that was never pushed for this commit." >&2
    echo "WARN: Fix: push the missing images, or on the node run: ./scripts/k8s-recover-stuck-rollouts.sh --apply" >&2
    echo "WARN: (dry-run first without --apply). Also: ./scripts/k8s-diagnose-interview-ai.sh" >&2
    case "${K8S_AUTO_RECOVER_IMAGE_PULL:-}" in
      1 | true | TRUE | yes | YES)
        rec="${ROOT}/scripts/k8s-recover-stuck-rollouts.sh"
        # Use bash + -f (not -x): script must run after git checkout even if +x was stripped (e.g. some FS/CI).
        if [[ -f "$rec" ]]; then
          echo "=== Auto-recover (K8S_AUTO_RECOVER_IMAGE_PULL) — rollout undo for stuck deployments ===" >&2
          bash "$rec" --apply || echo "WARN: auto-recover script failed (ignored)." >&2
        else
          echo "WARN: K8S_AUTO_RECOVER_IMAGE_PULL set but missing ${rec}; skipping auto-recover." >&2
        fi
        ;;
    esac
  fi

  OLLAMA_MODEL_NAME="${OLLAMA_MODEL:-mistral}"

  case "${K8S_SKIP_OLLAMA_PULL:-}" in
    1 | true | TRUE | yes | YES)
      echo "=== Ollama model (skipped — K8S_SKIP_OLLAMA_PULL set) ==="
      ;;
    *)
      echo "=== Ollama model (non-fatal) ==="
      if kubectl get deploy/ollama -n "$NS" &>/dev/null; then
        kubectl exec -n "$NS" deploy/ollama -- ollama pull "$OLLAMA_MODEL_NAME"
        pull_rc=$?
        if [[ "$pull_rc" -ne 0 ]]; then
          echo "WARN: ollama pull exited ${pull_rc} (ignored). Pull manually: kubectl exec -n ${NS} deploy/ollama -- ollama pull ${OLLAMA_MODEL_NAME}" >&2
        fi
      else
        echo "WARN: no deploy/ollama in ${NS} — skipping model pull" >&2
      fi
      ;;
  esac
) || true

echo "=== Done ==="
