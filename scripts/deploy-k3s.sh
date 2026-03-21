#!/usr/bin/env bash
# Local / VM: same steps as CI (Traefik + kustomize + set image + rollouts + Ollama pull).
# From repo root, with kubeconfig pointing at your k3s cluster:
#   export DOCKERHUB_USERNAME=youruser   # optional
#   ./scripts/deploy-k3s.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"
chmod +x "$ROOT/scripts/ci/k8s-apply.sh"
exec "$ROOT/scripts/ci/k8s-apply.sh"
