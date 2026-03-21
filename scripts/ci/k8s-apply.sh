#!/usr/bin/env bash
# Apply Traefik + kustomize stack + optional Docker Hub image overrides + rollout checks.
# Layout: $ROOT/k8s/ (kustomization.yaml, traefik/, …) — same as Git repo root on CI, or ~/interviewgenie-k8s on SSH sync.
#
# Env: KUBECONFIG. Optional: DOCKERHUB_USERNAME, K8S_NAMESPACE (default interview-ai).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NS="${K8S_NAMESPACE:-interview-ai}"

echo "ROOT=$ROOT"
echo "=== Apply Traefik HelmChartConfig (kube-system) ==="
kubectl apply -f "$ROOT/k8s/traefik/helmchartconfig.yaml"

echo "=== kubectl apply -k ($NS) ==="
kubectl apply -k "$ROOT/k8s/"

if [[ -n "${DOCKERHUB_USERNAME:-}" ]]; then
  DH="$DOCKERHUB_USERNAME"
  echo "=== kubectl set image -> ${DH}/interview-ai-*:latest ==="
  kubectl set image deployment/api-service -n "$NS" "api-service=${DH}/interview-ai-api-service:latest" || true
  kubectl set image deployment/audio-service -n "$NS" "audio-service=${DH}/interview-ai-audio-service:latest" || true
  kubectl set image deployment/stt-service -n "$NS" "stt-service=${DH}/interview-ai-stt-service:latest" || true
  kubectl set image deployment/question-service -n "$NS" "question-service=${DH}/interview-ai-question-service:latest" || true
  kubectl set image deployment/llm-service -n "$NS" "llm-service=${DH}/interview-ai-llm-service:latest" || true
  kubectl set image deployment/formatter-service -n "$NS" "formatter-service=${DH}/interview-ai-formatter-service:latest" || true
  kubectl set image deployment/monitoring-service -n "$NS" "monitoring-service=${DH}/interview-ai-monitoring-service:latest" || true
  kubectl set image deployment/web -n "$NS" "web=${DH}/interview-ai-web:latest" || true
fi

echo "=== Rollout status ==="
for d in api-service audio-service web monitoring-service; do
  kubectl rollout status "deployment/${d}" -n "$NS" --timeout=300s || echo "WARN: rollout ${d} not ready in time"
done

echo "=== Pods ($NS) ==="
kubectl get pods -n "$NS" -o wide

echo "=== Ollama model (non-fatal) ==="
kubectl exec -n "$NS" deploy/ollama -- ollama pull qwen2.5:0.5b || true

echo "=== Done ==="
