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
OPTIONAL_SERVICES_RAW="${K8S_VERIFY_OPTIONAL_SERVICES:-llm-service}"

contains_word() {
  local needle="$1"
  shift || true
  for w in "$@"; do
    [[ "$w" == "$needle" ]] && return 0
  done
  return 1
}

IFS=' ' read -r -a OPTIONAL_SERVICES <<< "${OPTIONAL_SERVICES_RAW}"

DEPLOYS=(
  api-service
  audio-service
  stt-service
  question-service
  llm-service
  cv-renderer-service
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
  cv-renderer-service:8000
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
  missing_required=()
  missing_optional=()
  for svc_port in "${SERVICE_PORTS[@]}"; do
    svc="${svc_port%%:*}"
    eps="$(kubectl get endpoints "${svc}" -n "${NS}" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
    if [[ -z "${eps}" ]]; then
      if contains_word "${svc}" "${OPTIONAL_SERVICES[@]}"; then
        missing_optional+=("${svc}")
      else
        missing_required+=("${svc}")
      fi
    fi
  done

  if [[ ${#missing_required[@]} -eq 0 && ${#missing_optional[@]} -eq 0 ]]; then
    break
  fi

  if [[ ${#missing_required[@]} -eq 0 && ${#missing_optional[@]} -gt 0 ]]; then
    now="$(date +%s)"
    if (( now >= deadline )); then
      echo "WARN: Optional service endpoints still not ready after ${ENDPOINT_WAIT_SECONDS}s: ${missing_optional[*]}"
      break
    fi
    echo "WAIT: optional endpoints not ready yet -> ${missing_optional[*]}"
    sleep "${POLL_INTERVAL_SECONDS}"
    continue
  fi

  now="$(date +%s)"
  if (( now >= deadline )); then
    echo "ERROR: Timed out waiting for required service endpoints (${ENDPOINT_WAIT_SECONDS}s). Missing: ${missing_required[*]}"
    exit 1
  fi
  echo "WAIT: required endpoints not ready yet -> ${missing_required[*]}"
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

export OPTIONAL_SERVICES_CSV="$(IFS=,; echo "${OPTIONAL_SERVICES[*]}")"

kubectl exec -n "${NS}" "${API_POD}" -- env OPTIONAL_SERVICES_CSV="${OPTIONAL_SERVICES_CSV}" python - <<'PY'
import socket
import sys
import os

checks = [
    ("audio-service", 8000),
    ("stt-service", 8000),
    ("question-service", 8000),
    ("llm-service", 8000),
    ("cv-renderer-service", 8000),
    ("formatter-service", 8000),
    ("cv-parser-service", 8000),
    ("monitoring-service", 3001),
    ("web", 3002),
]

optional = {s.strip() for s in os.environ.get("OPTIONAL_SERVICES_CSV", "").split(",") if s.strip()}
failed_required = []
failed_optional = []
for host, port in checks:
    try:
        with socket.create_connection((host, port), timeout=4):
            print(f"OK   tcp://{host}:{port}")
    except Exception as exc:
        if host in optional:
            print(f"WARN tcp://{host}:{port} -> {exc} (optional)")
            failed_optional.append((host, port))
        else:
            print(f"FAIL tcp://{host}:{port} -> {exc}")
            failed_required.append((host, port))

if failed_required:
    sys.exit(1)

if failed_optional:
    print("WARN optional connectivity failures:", ", ".join(f"{h}:{p}" for h, p in failed_optional))
PY

echo "=== Communication checks passed ==="
