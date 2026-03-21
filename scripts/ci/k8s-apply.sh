#!/usr/bin/env bash
# Apply Traefik + kustomize stack + optional Docker Hub image overrides + rollout checks.
# Layout: $ROOT/k8s/ (kustomization.yaml, traefik/, …) — same as Git repo root on CI, or ~/interviewgenie-k8s on SSH sync.
#
# Env: KUBECONFIG. Optional: DOCKERHUB_USERNAME, K8S_NAMESPACE (default interview-ai).
# Optional: K8S_IMAGE_TAG (default latest) — immutable tag e.g. sha-<full github sha> from CI.
# Optional: K8S_SKIP_SET_IMAGE=1 — only apply manifests; keep running images (doc-only / no-build pipeline).
# Optional: K8S_UPDATE_DEPLOYMENTS — space-separated deployment names to pin (partial CI builds).
#   If unset and not skipping, all app deployments are updated (local convenience).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NS="${K8S_NAMESPACE:-interview-ai}"
ROLLOUT_TIMEOUT="${K8S_ROLLOUT_TIMEOUT:-180s}"

echo "ROOT=$ROOT"
echo "=== Apply Traefik HelmChartConfig (kube-system) ==="
kubectl apply -f "$ROOT/k8s/traefik/helmchartconfig.yaml"

echo "=== kubectl apply -k ($NS) ==="
kubectl apply -k "$ROOT/k8s/"

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
    TARGETS="api-service audio-service stt-service question-service llm-service formatter-service monitoring-service web"
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
      *) echo "WARN: unknown deployment in K8S_UPDATE_DEPLOYMENTS: $d" ;;
    esac
  done
elif [[ "${K8S_SKIP_SET_IMAGE:-}" == "1" ]]; then
  echo "=== Skipping kubectl set image (K8S_SKIP_SET_IMAGE=1) — cluster keeps current images ==="
fi

echo "=== Rollout status (timeout ${ROLLOUT_TIMEOUT}) ==="
for d in api-service audio-service web monitoring-service; do
  kubectl rollout status "deployment/${d}" -n "$NS" --timeout="${ROLLOUT_TIMEOUT}" || echo "WARN: rollout ${d} not ready in time"
done

echo "=== Pods ($NS) ==="
kubectl get pods -n "$NS" -o wide

echo "=== Ollama model (non-fatal) ==="
kubectl exec -n "$NS" deploy/ollama -- ollama pull qwen2.5:0.5b || true

echo "=== Done ==="
