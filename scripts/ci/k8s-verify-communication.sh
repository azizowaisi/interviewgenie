#!/usr/bin/env bash
# Verify post-deploy service communication in Kubernetes.
# Fails fast if deployments are not ready, service endpoints are empty,
# or api-service cannot open TCP connections to internal services.
set -euo pipefail

NS="${K8S_NAMESPACE:-interview-ai}"
ROLLOUT_TIMEOUT="${K8S_VERIFY_ROLLOUT_TIMEOUT:-60s}"
INCLUDE_ROLLOUT_CHECKS="${K8S_VERIFY_INCLUDE_ROLLOUT:-0}"
ENDPOINT_WAIT_SECONDS="${K8S_VERIFY_ENDPOINT_WAIT_SECONDS:-180}"
POLL_INTERVAL_SECONDS="${K8S_VERIFY_POLL_INTERVAL_SECONDS:-5}"

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

if [[ "${INCLUDE_ROLLOUT_CHECKS}" == "1" ]]; then
  echo "=== Verify rollouts (${NS}) ==="
  pids=()
  for d in "${DEPLOYS[@]}"; do
    (
      kubectl rollout status "deployment/${d}" -n "${NS}" --timeout="${ROLLOUT_TIMEOUT}"
    ) &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid"
  done
else
  echo "=== Verify rollouts skipped (K8S_VERIFY_INCLUDE_ROLLOUT=${INCLUDE_ROLLOUT_CHECKS}) ==="
  echo "=== Waiting for endpoints up to ${ENDPOINT_WAIT_SECONDS}s (poll ${POLL_INTERVAL_SECONDS}s) ==="
fi

echo "=== Verify service endpoints (${NS}) ==="
deadline=$(( $(date +%s) + ENDPOINT_WAIT_SECONDS ))
while true; do
  missing=()
  for svc_port in "${SERVICE_PORTS[@]}"; do
    svc="${svc_port%%:*}"
    eps="$(kubectl get endpoints "${svc}" -n "${NS}" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
    if [[ -z "${eps}" ]]; then
      missing+=("${svc}")
    fi
  done

  if [[ ${#missing[@]} -eq 0 ]]; then
    break
  fi

  now="$(date +%s)"
  if (( now >= deadline )); then
    echo "ERROR: Timed out waiting for ready service endpoints (${ENDPOINT_WAIT_SECONDS}s). Missing: ${missing[*]}"
    exit 1
  fi
  echo "WAIT: endpoints not ready yet -> ${missing[*]}"
  sleep "${POLL_INTERVAL_SECONDS}"
done

for svc_port in "${SERVICE_PORTS[@]}"; do
  svc="${svc_port%%:*}"
  eps="$(kubectl get endpoints "${svc}" -n "${NS}" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
  echo "OK: svc/${svc} endpoints=${eps}"
done

echo "=== Verify in-cluster connectivity from api-service pod (${NS}) ==="
api_deadline=$(( $(date +%s) + ENDPOINT_WAIT_SECONDS ))
API_POD=""
while true; do
  API_POD="$(kubectl get pods -n "${NS}" -l app=api-service --field-selector=status.phase=Running -o name 2>/dev/null | head -n1 | sed 's|^pod/||' || true)"
  if [[ -n "${API_POD}" ]]; then
    break
  fi
  now="$(date +%s)"
  if (( now >= api_deadline )); then
    echo "ERROR: Timed out waiting for a running api-service pod (${ENDPOINT_WAIT_SECONDS}s)"
    exit 1
  fi
  echo "WAIT: api-service pod not running yet"
  sleep "${POLL_INTERVAL_SECONDS}"
done

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
