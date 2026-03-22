#!/usr/bin/env bash
# One-shot diagnostics for Traefik 502 / no upstream (interview-ai namespace).
# Run on the k3s node or anywhere with a working kubeconfig:
#   ./scripts/k8s-diagnose-interview-ai.sh
# Optional: K8S_NAMESPACE=interview-ai (default)
set -euo pipefail
NS="${K8S_NAMESPACE:-interview-ai}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1"; exit 1; }; }
need kubectl

echo "=== Context / cluster ==="
kubectl config current-context 2>/dev/null || true
kubectl cluster-info 2>/dev/null | head -3 || true

echo ""
echo "=== Nodes ==="
kubectl get nodes -o wide 2>/dev/null || true

echo ""
echo "=== Pods ($NS) ==="
kubectl get pods -n "$NS" -o wide 2>&1 || { echo "Namespace missing or no access: $NS"; exit 1; }

echo ""
echo "=== Pod issues (non-Running) ==="
kubectl get pods -n "$NS" --field-selector=status.phase!=Running,status.phase!=Succeeded -o wide 2>/dev/null || true

echo ""
echo "=== Recent events ($NS, last 25) ==="
kubectl get events -n "$NS" --sort-by='.lastTimestamp' 2>/dev/null | tail -25

echo ""
echo "=== Endpoints (ingress backends) ==="
for s in web api-service audio-service; do
  echo "--- svc/$s ---"
  kubectl get endpoints -n "$NS" "svc/$s" -o wide 2>/dev/null || echo "(missing)"
done

echo ""
echo "=== Deployment images (expect user/interview-ai-* if using Docker Hub) ==="
for d in web api-service audio-service; do
  echo "--- deployment/$d ---"
  kubectl get deployment -n "$NS" "$d" -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}' 2>/dev/null || echo "(missing)"
done

echo ""
echo "=== Describe web (first failing hint) ==="
kubectl describe deployment -n "$NS" web 2>/dev/null | tail -40 || true

echo ""
echo "=== Traefik pods (kube-system) ==="
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik -o wide 2>/dev/null || \
  kubectl get pods -n kube-system | grep -i traefik || true

echo ""
echo "Done. Fix patterns:"
echo "  ImagePullBackOff / ErrImagePull → set GitHub secrets DOCKERHUB_USERNAME + DOCKERHUB_TOKEN; re-run deploy, or kubectl set image to your Hub repo."
echo "  exec format error → rebuild with DOCKER_BUILD_PLATFORMS matching node arch (e.g. linux/arm64 for Ampere)."
echo "  0 endpoints for svc/web → pods not Ready; check logs: kubectl logs -n $NS deploy/web --tail=80"
