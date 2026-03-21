#!/usr/bin/env bash
# Apply manifests to k3s (namespace interview-ai). Run from repo root with kubeconfig set.
#
# Optional: point Deployments at Docker Hub (after CI built & pushed images):
#   export DOCKERHUB_USERNAME=youruser
#   ./scripts/deploy-k3s.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NS=interview-ai

kubectl apply -k "$ROOT/k8s"

if [[ -n "${DOCKERHUB_USERNAME:-}" ]]; then
  DH="$DOCKERHUB_USERNAME"
  kubectl set image deployment/api-service -n "$NS" "api-service=${DH}/interview-ai-api-service:latest"
  kubectl set image deployment/audio-service -n "$NS" "audio-service=${DH}/interview-ai-audio-service:latest"
  kubectl set image deployment/stt-service -n "$NS" "stt-service=${DH}/interview-ai-stt-service:latest"
  kubectl set image deployment/question-service -n "$NS" "question-service=${DH}/interview-ai-question-service:latest"
  kubectl set image deployment/llm-service -n "$NS" "llm-service=${DH}/interview-ai-llm-service:latest"
  kubectl set image deployment/formatter-service -n "$NS" "formatter-service=${DH}/interview-ai-formatter-service:latest"
  kubectl set image deployment/monitoring-service -n "$NS" "monitoring-service=${DH}/interview-ai-monitoring-service:latest"
  kubectl set image deployment/web -n "$NS" "web=${DH}/interview-ai-web:latest"
fi

kubectl rollout restart deployment/web -n "$NS" 2>/dev/null || true
kubectl rollout status deployment/web -n "$NS" --timeout=180s || true

echo "Pods: kubectl get pods -n $NS -l app=web"
