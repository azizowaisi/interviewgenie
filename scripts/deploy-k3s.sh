#!/usr/bin/env bash
# Apply manifests to k3s / kubectl current context (namespace: interview-ai).
# Run from repo root on a machine with a working kubeconfig (e.g. your k3s VM).
#
# If images live on Docker Hub (after CI push), set DOCKERHUB_USERNAME first:
#   export DOCKERHUB_USERNAME=youruser
#   ./scripts/deploy-k3s.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/k8s"

if [[ -n "${DOCKERHUB_USERNAME:-}" ]]; then
  DH="$DOCKERHUB_USERNAME"
  for s in api-service audio-service stt-service question-service llm-service formatter-service monitoring-service; do
    kustomize edit set image "interview-ai/${s}:latest=${DH}/interview-ai-${s}:latest"
  done
  kustomize edit set image "interview-ai/web:latest=${DH}/interview-ai-web:latest"
fi

kubectl apply -k .

echo "Rollout web (new deployment)…"
kubectl rollout restart deployment/web -n interview-ai 2>/dev/null || true
kubectl rollout status deployment/web -n interview-ai --timeout=180s || true

echo "Done. Check: kubectl get pods -n interview-ai -l app=web"
