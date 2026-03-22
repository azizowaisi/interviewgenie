#!/usr/bin/env bash
# Build all Kubernetes app images locally (same Dockerfiles/contexts as GitHub Actions).
# Run from the repository root.
#
# Local load (default): images tagged for your Docker engine only — good to verify builds before git push.
#   ./scripts/build-all-images-local.sh
#
# Push to Docker Hub (optional — same tags CI uses; run `docker login` first):
#   PUSH=1 DOCKERHUB_USERNAME=youruser ./scripts/build-all-images-local.sh
#
# Env:
#   DOCKERHUB_USERNAME or DH_USER — image prefix (default: interview-ai-local for offline tags)
#   IMAGE_TAG — tag (default: latest)
#   PLATFORMS — default linux/arm64 when PUSH=1 (M1 + Ampere); override linux/amd64 or multi-arch if needed
#   PUSH=1 — buildx --push instead of --load
#   WEB_* — same NEXT_PUBLIC_* overrides as CI (see gha-build-single-image.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DH_USER="${DOCKERHUB_USERNAME:-${DH_USER:-interview-ai-local}}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PUSH="${PUSH:-0}"

# Single-platform for --load; multi-arch only with --push
if [[ "${PUSH}" == "1" ]]; then
  PLATFORMS="${PLATFORMS:-linux/arm64}"
  OUTPUT=(--push)
else
  if [[ -z "${PLATFORMS:-}" ]]; then
    case "$(uname -m)" in
      aarch64 | arm64) PLATFORMS=linux/arm64 ;;
      x86_64 | amd64) PLATFORMS=linux/amd64 ;;
      *) PLATFORMS=linux/amd64 ;;
    esac
  fi
  if echo "${PLATFORMS}" | grep -q ','; then
    echo "Local --load supports one platform only. Unset PLATFORMS to auto-detect, or set e.g. PLATFORMS=linux/arm64" >&2
    echo "For multi-arch push from this machine: PUSH=1 DOCKERHUB_USERNAME=... ./scripts/build-all-images-local.sh" >&2
    exit 1
  fi
  OUTPUT=(--load)
fi

PUB="${WEB_PUBLIC_APP_URL:-https://interviewgenie.teckiz.com}"
ADM_SITE="${WEB_ADMIN_SITE_URL:-https://admin.interviewgenie.teckiz.com}"
ADM_HOSTS="${WEB_ADMIN_HOSTS:-admin.interviewgenie.teckiz.com}"
MAIN_HOSTS="${WEB_MAIN_APP_HOSTS:-interviewgenie.teckiz.com,www.interviewgenie.teckiz.com}"

need_docker() {
  command -v docker >/dev/null 2>&1 || {
    echo "docker not found" >&2
    exit 1
  }
}

need_docker
docker buildx version >/dev/null 2>&1 || {
  echo "docker buildx required" >&2
  exit 1
}

echo "=== Build all app images ==="
echo "DH_USER=${DH_USER} IMAGE_TAG=${IMAGE_TAG} PLATFORMS=${PLATFORMS} PUSH=${PUSH}"

build_backend() {
  local slug="$1"
  local context="$2"
  echo "---- ${slug} ----"
  docker buildx build \
    --platform "${PLATFORMS}" \
    --provenance=false \
    "${OUTPUT[@]}" \
    -t "${DH_USER}/interview-ai-${slug}:${IMAGE_TAG}" \
    -t "${DH_USER}/interview-ai-${slug}:latest" \
    "${context}"
}

build_backend api-service ./backend/api-service
build_backend audio-service ./backend/audio-service
build_backend stt-service ./backend/stt-service
build_backend question-service ./backend/question-service
build_backend llm-service ./backend/llm-service
build_backend formatter-service ./backend/formatter-service
build_backend monitoring-service ./backend/monitoring-service

echo "---- web ----"
docker buildx build \
  --platform "${PLATFORMS}" \
  --provenance=false \
  "${OUTPUT[@]}" \
  -t "${DH_USER}/interview-ai-web:${IMAGE_TAG}" \
  -t "${DH_USER}/interview-ai-web:latest" \
  --build-arg "NEXT_PUBLIC_PUBLIC_APP_URL=${PUB}" \
  --build-arg "NEXT_PUBLIC_ADMIN_SITE_URL=${ADM_SITE}" \
  --build-arg "NEXT_PUBLIC_ADMIN_HOSTS=${ADM_HOSTS}" \
  --build-arg "NEXT_PUBLIC_MAIN_APP_HOSTS=${MAIN_HOSTS}" \
  ./web

echo ""
echo "=== Done: 8 images (${DH_USER}/interview-ai-*:${IMAGE_TAG}) ==="
if [[ "${PUSH}" != "1" ]]; then
  echo "Images are in your local Docker only. Next: commit/push to git and let CI deploy, or:"
  echo "  PUSH=1 DOCKERHUB_USERNAME=${DH_USER} ./scripts/build-all-images-local.sh"
else
  echo "Pushed to Docker Hub. Ensure cluster uses: ${DH_USER}/interview-ai-<service>:${IMAGE_TAG}"
fi
