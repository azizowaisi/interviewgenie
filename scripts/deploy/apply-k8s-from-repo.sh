#!/usr/bin/env bash
# Apply k8s/ from your machine (uses KUBECONFIG or ~/.kube/config).
# Use this to fix production immediately: merge latest manifests + rollouts without waiting for CI.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found" >&2
  exit 1
fi
echo "Applying k8s/ (context: $(kubectl config current-context 2>/dev/null || echo '?'))"
kubectl apply -k k8s/
echo "Done. Check: kubectl get pods -n interview-ai"
