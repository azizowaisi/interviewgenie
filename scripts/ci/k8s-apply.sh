#!/usr/bin/env bash
# Apply Traefik + kustomize stack + optional Docker Hub image overrides + rollout checks.
# Layout: $ROOT/k8s/ (kustomization.yaml, traefik/, …) — same as Git repo root on CI, or ~/interviewgenie-k8s on SSH sync.
#
# Env: KUBECONFIG. Optional: DOCKERHUB_USERNAME, DOCKERHUB_TOKEN, K8S_NAMESPACE (default interview-ai).
# When both Hub env vars are set: creates pull secret + patches SAs so cluster pulls (mongo, app images) use authenticated Hub (higher rate limits).
# Optional: K8S_IMAGE_TAG — CI uses sha-<full github sha>; local default latest if unset when set_image runs.
# Optional: K8S_SKIP_SET_IMAGE=1 — no new tag this run (CI skips set image). We snapshot live images before
#   `kubectl apply -k` and restore them after, so manifest placeholders (interview-ai/*:latest) do not clobber Hub tags.
# Optional: K8S_UPDATE_DEPLOYMENTS — space-separated deployment names to pin (partial CI builds).
#   If unset/empty, all app deployments get `kubectl set image` (CI uses this when pinning :latest).
# Rollout: same deployments as set image (all app workloads in parallel; one timeout window wall time).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NS="${K8S_NAMESPACE:-interview-ai}"
ROLLOUT_TIMEOUT="${K8S_ROLLOUT_TIMEOUT:-180s}"
# App Deployments that receive Hub images (must match set_image loop below).
ALL_APP_DEPLOYMENTS="api-service audio-service stt-service question-service llm-service formatter-service monitoring-service web"
ROLLOUT_TARGETS="${ALL_APP_DEPLOYMENTS}"

SNAP_DIR=""
cleanup_snap() {
  [[ -n "${SNAP_DIR}" && -d "${SNAP_DIR}" ]] && rm -rf "${SNAP_DIR}"
}
trap cleanup_snap EXIT

echo "ROOT=$ROOT"
echo "=== Apply Traefik HelmChartConfig (kube-system) ==="
kubectl apply -f "$ROOT/k8s/traefik/helmchartconfig.yaml"

if [[ "${K8S_SKIP_SET_IMAGE:-}" == "1" ]]; then
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
fi

echo "=== kubectl apply -k ($NS) ==="
kubectl apply -k "$ROOT/k8s/"

if [[ -n "${DOCKERHUB_USERNAME:-}" ]] && [[ -n "${DOCKERHUB_TOKEN:-}" ]]; then
  echo "=== Docker Hub pull secret ($NS) ==="
  kubectl create secret docker-registry interview-ai-dockerhub \
    --docker-server=https://index.docker.io/v1/ \
    --docker-username="${DOCKERHUB_USERNAME}" \
    --docker-password="${DOCKERHUB_TOKEN}" \
    -n "$NS" \
    --dry-run=client -o yaml | kubectl apply -f -
  for sa in default monitoring-service; do
    if kubectl get serviceaccount "$sa" -n "$NS" &>/dev/null; then
      kubectl patch serviceaccount "$sa" -n "$NS" --type=merge \
        -p "{\"imagePullSecrets\":[{\"name\":\"interview-ai-dockerhub\"}]}" || true
    fi
  done
  kubectl rollout restart statefulset/mongo -n "$NS" 2>/dev/null || true
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
      *) echo "WARN: unknown deployment in K8S_UPDATE_DEPLOYMENTS: $d" ;;
    esac
  done
elif [[ "${K8S_SKIP_SET_IMAGE:-}" == "1" ]]; then
  echo "=== Skipping kubectl set image (K8S_SKIP_SET_IMAGE=1) — no new image tag pushed this run ==="
  restored=0
  if [[ -n "${SNAP_DIR}" && -d "${SNAP_DIR}" ]]; then
    for d in ${ALL_APP_DEPLOYMENTS}; do
      [[ -f "${SNAP_DIR}/${d}.image" && -f "${SNAP_DIR}/${d}.container" ]] || continue
      cname="$(cat "${SNAP_DIR}/${d}.container")"
      img="$(cat "${SNAP_DIR}/${d}.image")"
      if kubectl set image "deployment/${d}" -n "$NS" "${cname}=${img}"; then
        restored=$((restored + 1))
      fi
    done
  fi
  if [[ "$restored" -gt 0 ]]; then
    echo "Restored ${restored} deployment image ref(s) from pre-apply snapshot."
  else
    echo "WARN: Manifests use placeholder names (e.g. interview-ai/web:latest). No snapshot to restore —"
    echo "WARN: if the node cannot pull them, pods stay ImagePullBackOff and Traefik returns 502."
    echo "WARN: Run a workflow that builds/pushes images, or: DOCKERHUB_USERNAME=you ./scripts/deploy-k3s.sh"
    echo "WARN: Diagnose: ./scripts/k8s-diagnose-interview-ai.sh"
  fi
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

echo "=== Pods ($NS) ==="
kubectl get pods -n "$NS" -o wide

echo "=== Ollama model (non-fatal) ==="
kubectl exec -n "$NS" deploy/ollama -- ollama pull qwen2.5:0.5b || true

echo "=== Done ==="
