#!/usr/bin/env bash
# Build & push one image (used by parallel matrix jobs in GitHub Actions).
# Caching: GHA cache (per service scope) + optional Docker registry :cache tag.
#
# Required env: IMAGE_SLUG — api-service | audio-service | stt-service | question-service |
#                          llm-service | formatter-service | monitoring-service | web
# Required env: DH_USER, IMAGE_TAG (e.g. sha-abc123def456)
# Optional: PLATFORMS (default linux/amd64), ENABLE_REGISTRY_CACHE (default true)
# Optional web build-args: WEB_PUBLIC_APP_URL, WEB_ADMIN_SITE_URL, WEB_ADMIN_HOSTS, WEB_MAIN_APP_HOSTS
set -euo pipefail

SLUG="${IMAGE_SLUG:?IMAGE_SLUG is required}"
PLATFORMS="${PLATFORMS:-linux/amd64}"
ENABLE_REGISTRY_CACHE="${ENABLE_REGISTRY_CACHE:-true}"

case "${SLUG}" in
  api-service) CONTEXT_DIR="./backend/api-service" ;;
  audio-service) CONTEXT_DIR="./backend/audio-service" ;;
  stt-service) CONTEXT_DIR="./backend/stt-service" ;;
  question-service) CONTEXT_DIR="./backend/question-service" ;;
  llm-service) CONTEXT_DIR="./backend/llm-service" ;;
  formatter-service) CONTEXT_DIR="./backend/formatter-service" ;;
  monitoring-service) CONTEXT_DIR="./backend/monitoring-service" ;;
  web) CONTEXT_DIR="./web" ;;
  *)
    echo "Unknown IMAGE_SLUG=${SLUG}" >&2
    exit 1
    ;;
esac

scope="${SLUG}"
cache_args=()
cache_args+=(--cache-from "type=gha,scope=${scope}")
cache_args+=(--cache-to "type=gha,mode=max,scope=${scope}")
if [[ "${ENABLE_REGISTRY_CACHE}" == "true" ]] && [[ -n "${DH_USER:-}" ]]; then
  cref="${DH_USER}/interview-ai-${SLUG}:cache"
  cache_args+=(--cache-from "type=registry,ref=${cref}")
  cache_args+=(--cache-to "type=registry,ref=${cref},mode=max")
fi

echo "---- build & push interview-ai-${SLUG} (platforms=${PLATFORMS}) ----"

if [[ "${SLUG}" == "web" ]]; then
  PUB="${WEB_PUBLIC_APP_URL:-https://interviewgenie.teckiz.com}"
  ADM_SITE="${WEB_ADMIN_SITE_URL:-https://admin.interviewgenie.teckiz.com}"
  ADM_HOSTS="${WEB_ADMIN_HOSTS:-admin.interviewgenie.teckiz.com}"
  MAIN_HOSTS="${WEB_MAIN_APP_HOSTS:-interviewgenie.teckiz.com,www.interviewgenie.teckiz.com}"
  echo "Web NEXT_PUBLIC_* PUB=$PUB ADM_SITE=$ADM_SITE"
  docker buildx build \
    --platform "${PLATFORMS}" \
    --push \
    "${cache_args[@]}" \
    -t "${DH_USER}/interview-ai-${SLUG}:${IMAGE_TAG}" \
    -t "${DH_USER}/interview-ai-${SLUG}:latest" \
    --build-arg "NEXT_PUBLIC_PUBLIC_APP_URL=${PUB}" \
    --build-arg "NEXT_PUBLIC_ADMIN_SITE_URL=${ADM_SITE}" \
    --build-arg "NEXT_PUBLIC_ADMIN_HOSTS=${ADM_HOSTS}" \
    --build-arg "NEXT_PUBLIC_MAIN_APP_HOSTS=${MAIN_HOSTS}" \
    "${CONTEXT_DIR}"
else
  docker buildx build \
    --platform "${PLATFORMS}" \
    --push \
    "${cache_args[@]}" \
    -t "${DH_USER}/interview-ai-${SLUG}:${IMAGE_TAG}" \
    -t "${DH_USER}/interview-ai-${SLUG}:latest" \
    "${CONTEXT_DIR}"
fi

echo "=== Done interview-ai-${SLUG} (tag ${IMAGE_TAG} + latest) ==="
