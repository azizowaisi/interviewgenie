#!/usr/bin/env bash
# Verify post-deploy service communication in Kubernetes.
# Fails fast if deployments are not ready, service endpoints are empty,
# or api-service cannot open TCP connections to internal services.
set -euo pipefail

NS="${K8S_NAMESPACE:-interview-ai}"
ROLLOUT_TIMEOUT="${K8S_VERIFY_ROLLOUT_TIMEOUT:-420s}"

DEPLOYS=(
  api-service
  audio-service
  stt-service
  question-service
  llm-service
  formatter-service
  cv-parser-service
  monitoring-service
  web
)

SERVICE_PORTS=(
  api-service:8001
  audio-service:8000
  stt-service:8000
  question-service:8000
  llm-service:8000
  formatter-service:8000
  cv-parser-service:8000
  monitoring-service:3001
  web:3002
)

echo "=== Verify rollouts (${NS}) ==="
for d in "${DEPLOYS[@]}"; do
  kubectl rollout status "deployment/${d}" -n "${NS}" --timeout="${ROLLOUT_TIMEOUT}"
done

echo "=== Verify service endpoints (${NS}) ==="
for svc_port in "${SERVICE_PORTS[@]}"; do
  svc="${svc_port%%:*}"
  eps="$(kubectl get endpoints "${svc}" -n "${NS}" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
  if [[ -z "${eps}" ]]; then
    echo "ERROR: svc/${svc} has no ready endpoints"
    exit 1
  fi
  echo "OK: svc/${svc} endpoints=${eps}"
done

echo "=== Verify in-cluster connectivity from api-service pod (${NS}) ==="
API_POD="$(kubectl get pods -n "${NS}" -l app=api-service -o jsonpath='{.items[0].metadata.name}')"
if [[ -z "${API_POD}" ]]; then
  echo "ERROR: api-service pod not found"
  exit 1
fi

echo "Using api pod: ${API_POD}"

kubectl exec -n "${NS}" "${API_POD}" -- python - <<'PY'
import socket
import sys

checks = [
    ("audio-service", 8000),
    ("stt-service", 8000),
    ("question-service", 8000),
    ("llm-service", 8000),
    ("formatter-service", 8000),
    ("cv-parser-service", 8000),
    ("monitoring-service", 3001),
    ("web", 3002),
]

failed = []
for host, port in checks:
    try:
        with socket.create_connection((host, port), timeout=4):
            print(f"OK   tcp://{host}:{port}")
    except Exception as exc:
        print(f"FAIL tcp://{host}:{port} -> {exc}")
        failed.append((host, port))

if failed:
    sys.exit(1)
PY

echo "=== Communication checks passed ==="
