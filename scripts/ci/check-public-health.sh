#!/usr/bin/env bash
# Public URL health check for production availability.
set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-https://interviewgenie.example.com}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-8}"
SLEEP_SECONDS="${SLEEP_SECONDS:-10}"
CURL_TIMEOUT="${CURL_TIMEOUT:-12}"

check_url() {
  local url="$1"
  local label="$2"

  local code
  local total
  code="$(curl -sS -L -o /tmp/public_health_resp.$$ -w "%{http_code}" --max-time "${CURL_TIMEOUT}" "$url" || true)"
  total="$(curl -sS -L -o /dev/null -w "%{time_total}" --max-time "${CURL_TIMEOUT}" "$url" || true)"

  if [[ "$code" =~ ^2[0-9][0-9]$ || "$code" =~ ^3[0-9][0-9]$ ]]; then
    echo "OK   ${label}: ${url} (HTTP ${code}, ${total}s)"
    return 0
  fi

  echo "FAIL ${label}: ${url} (HTTP ${code:-n/a}, ${total:-n/a}s)"
  return 1
}

attempt=1
while (( attempt <= MAX_ATTEMPTS )); do
  echo "Attempt ${attempt}/${MAX_ATTEMPTS}"
  ok=1

  check_url "${PUBLIC_URL}/" "home" || ok=0
  check_url "${PUBLIC_URL}/robots.txt" "robots" || ok=0

  if [[ "$ok" -eq 1 ]]; then
    echo "Public health check passed"
    exit 0
  fi

  if (( attempt < MAX_ATTEMPTS )); then
    sleep "${SLEEP_SECONDS}"
  fi
  attempt=$((attempt + 1))
done

echo "Public health check failed after ${MAX_ATTEMPTS} attempts"
exit 1
