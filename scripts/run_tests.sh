#!/usr/bin/env bash
# Run unit/mock tests for all backend services.
# From repo root. Requires: pip install -r backend/<service>/requirements.txt for each, or run inside Docker.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

run_service_tests() {
  local name="$1"
  local dir="$2"
  echo "---- $name ----"
  if [ ! -d "$dir/tests" ]; then
    echo "  (no tests)"
    return 0
  fi
  (cd "$dir" && python3 -m pytest tests/ -v --tb=short) || return 1
}

run_service_tests "question-service" "backend/question-service"
run_service_tests "formatter-service" "backend/formatter-service"
run_service_tests "llm-service" "backend/llm-service"
run_service_tests "stt-service" "backend/stt-service"
run_service_tests "audio-service" "backend/audio-service"
echo "---- All backend tests passed ----"
